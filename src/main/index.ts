import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { SunoClient, SunoError } from './suno/client'
import { solveTurnstile } from './suno/turnstile'
import { getSettings, saveSettings, getCookie } from './store'
import { IpcChannels } from '../shared/ipc'
import type { AppSettings, Clip, GenerateRequest, IpcResult } from '../shared/types'

let sunoClient: SunoClient | null = null

function getClient(): SunoClient {
  const cookie = getCookie()
  if (!sunoClient) {
    sunoClient = new SunoClient(cookie)
  } else {
    sunoClient.setCookie(cookie)
  }
  if (!sunoClient.hasCookie()) {
    throw new SunoError('No Suno session cookie set. Open Settings and paste your cookie.')
  }
  return sunoClient
}

async function ok<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unexpected error talking to Suno.'
    return { ok: false, error: message }
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9\-_ ]/gi, '_').slice(0, 120) || 'track'
}

async function downloadClip(clip: Clip, format: 'mp3' | 'wav'): Promise<string> {
  const settings = getSettings()
  await fs.mkdir(settings.downloadDir, { recursive: true })
  let url = clip.audioUrl
  if (format === 'wav') {
    // Suno serves wav at the same CDN path with a .wav extension once rendered.
    url = clip.audioUrl.replace(/\.mp3(\?|$)/, '.wav$1')
  }
  if (!url) throw new SunoError('This clip has no downloadable audio yet.')
  const res = await fetch(url)
  if (!res.ok) {
    throw new SunoError(`Download failed (HTTP ${res.status}).`, res.status)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const filename = `${sanitizeFilename(clip.title)}-${clip.id.slice(0, 8)}.${format}`
  const dest = join(settings.downloadDir, filename)
  await fs.writeFile(dest, buf)
  return dest
}

function registerIpc(): void {
  ipcMain.handle(IpcChannels.getSettings, () => ok(async () => getSettings()))

  ipcMain.handle(IpcChannels.saveSettings, (_e, settings: AppSettings) =>
    ok(async () => {
      const saved = saveSettings(settings)
      if (sunoClient) sunoClient.setCookie(saved.sunoCookie)
      return saved
    })
  )

  ipcMain.handle(IpcChannels.checkConnection, () =>
    ok(() => getClient().checkConnection())
  )

  ipcMain.handle(IpcChannels.getBilling, () => ok(() => getClient().getBilling()))

  ipcMain.handle(IpcChannels.listPersonas, () => ok(() => getClient().listPersonas()))

  ipcMain.handle(IpcChannels.generate, (e, req: GenerateRequest) =>
    ok(async () => {
      const client = getClient()
      const parent = BrowserWindow.fromWebContents(e.sender) ?? undefined
      const turnstileToken = await solveTurnstile(parent)
      return client.generate({ ...req, turnstileToken })
    })
  )

  ipcMain.handle(IpcChannels.getClips, (_e, ids: string[]) =>
    ok(() => getClient().getClips(ids))
  )

  ipcMain.handle(IpcChannels.getLibrary, (_e, page: number) =>
    ok(() => getClient().getLibrary(page))
  )

  ipcMain.handle(IpcChannels.download, (_e, clip: Clip, format: 'mp3' | 'wav') =>
    ok(() => downloadClip(clip, format))
  )

  ipcMain.handle(IpcChannels.pickDownloadDir, () =>
    ok(async () => {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    })
  )

  ipcMain.handle(IpcChannels.openDownloadDir, () =>
    ok(async () => {
      await shell.openPath(getSettings().downloadDir)
      return null
    })
  )
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'Suno Studio',
    backgroundColor: '#0b0b10',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.marpogiii.sunostudio')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
