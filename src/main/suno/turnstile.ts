import { BrowserWindow } from 'electron'

/**
 * Cloudflare Turnstile sitekey Suno uses to gate the generate endpoint. The
 * token a widget with this key produces is only valid when minted from a
 * `suno.com` origin, so the verification window must load a real suno.com page.
 */
const GEN_SITEKEY = '0x4AAAAAABtnpJo7aKMs9JLQ'
const VERIFY_URL = 'https://suno.com/'
/** Turnstile tokens expire ~300s after issue; give the human plenty of time. */
const SOLVE_TIMEOUT_MS = 180_000
const POLL_MS = 400

/** Raised when the user closes the verification window without solving it. */
export class TurnstileCancelled extends Error {
  constructor() {
    super('Human verification was cancelled, so nothing was generated.')
    this.name = 'TurnstileCancelled'
  }
}

/** The script injected into the suno.com page to render the Turnstile widget. */
function injectionScript(): string {
  return `(() => {
    if (window.__sunoStudioTSInit) return;
    window.__sunoStudioTSInit = true;
    window.__sunoStudioToken = null;
    window.__sunoStudioError = null;
    const mount = () => {
      const overlay = document.createElement('div');
      overlay.id = '__sunoStudioTS';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#0b0b10;font-family:system-ui,sans-serif;color:#e7e7ee;text-align:center;padding:24px';
      overlay.innerHTML = '<div style="font-size:16px;font-weight:600">Verify you are human</div>' +
        '<div style="font-size:13px;opacity:.7;max-width:320px">Suno requires this check before generating. Solve it once and your track will start.</div>' +
        '<div id="__sunoStudioTSBox"></div>';
      document.body.appendChild(overlay);
      window.turnstile.render('#__sunoStudioTSBox', {
        sitekey: '${GEN_SITEKEY}',
        action: 'generate',
        callback: (t) => { window.__sunoStudioToken = t; },
        'error-callback': (e) => { window.__sunoStudioError = String(e); }
      });
    };
    const ready = () => window.turnstile && window.turnstile.render;
    if (ready()) { mount(); return; }
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.onload = () => { const i = setInterval(() => { if (ready()) { clearInterval(i); mount(); } }, 150); };
    document.head.appendChild(s);
  })();`
}

/**
 * Opens a small window on suno.com, renders Suno's real Turnstile widget, and
 * resolves with the token the human produces. This completes the same check the
 * website shows — it does not bypass or auto-solve it.
 */
export async function solveTurnstile(parent?: BrowserWindow): Promise<string> {
  const win = new BrowserWindow({
    width: 440,
    height: 600,
    parent,
    modal: Boolean(parent),
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Human verification',
    backgroundColor: '#0b0b10',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: false }
  })

  return new Promise<string>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const cleanup = (): void => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const succeed = (token: string): void => {
      if (settled) return
      settled = true
      cleanup()
      if (!win.isDestroyed()) win.close()
      resolve(token)
    }
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (!win.isDestroyed()) win.close()
      reject(err)
    }

    win.on('closed', () => {
      if (!settled) {
        settled = true
        cleanup()
        reject(new TurnstileCancelled())
      }
    })

    win.webContents.on('did-finish-load', () => {
      if (!win.webContents.getURL().startsWith('https://suno.com')) return
      win.webContents.executeJavaScript(injectionScript()).catch(() => undefined)
    })

    win.once('ready-to-show', () => win.show())

    timer = setInterval(() => {
      if (win.isDestroyed()) {
        cleanup()
        return
      }
      win.webContents
        .executeJavaScript(
          'window.__sunoStudioToken ? {t: window.__sunoStudioToken} : (window.__sunoStudioError ? {e: window.__sunoStudioError} : null)'
        )
        .then((r: { t?: string; e?: string } | null) => {
          if (r?.t) succeed(r.t)
        })
        .catch(() => undefined)
    }, POLL_MS)

    setTimeout(() => {
      fail(new Error('Human verification timed out. Please try generating again.'))
    }, SOLVE_TIMEOUT_MS)

    win.loadURL(VERIFY_URL).catch((err) => fail(err as Error))
  })
}
