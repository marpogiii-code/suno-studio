import { useState } from 'react'
import type { AppSettings, Persona } from '../../../shared/types'
import { MODEL_VERSIONS } from '../lib/options'
import { unwrap } from '../lib/api'

interface Props {
  settings: AppSettings
  personas: Persona[]
  onSave: (s: AppSettings) => Promise<void>
  onNotify: (msg: string, kind: 'error' | 'success') => void
}

export default function Settings({
  settings,
  personas,
  onSave,
  onNotify
}: Props): JSX.Element {
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [testing, setTesting] = useState(false)

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function save(): Promise<void> {
    await onSave(draft)
    onNotify('Settings saved.', 'success')
  }

  async function test(): Promise<void> {
    setTesting(true)
    try {
      await onSave(draft)
      const billing = await unwrap(window.api.checkConnection())
      onNotify(
        `Connected. ${billing.creditsLeft} credits left.`,
        'success'
      )
    } catch (err) {
      onNotify((err as Error).message, 'error')
    } finally {
      setTesting(false)
    }
  }

  async function pickDir(): Promise<void> {
    const dir = await unwrap(window.api.pickDownloadDir())
    if (dir) update('downloadDir', dir)
  }

  return (
    <div className="settings scroll">
      <h2>Settings</h2>

      <label className="field">
        <span>Suno session cookie</span>
        <textarea
          value={draft.sunoCookie}
          onChange={(e) => update('sunoCookie', e.target.value)}
          placeholder="Paste the full Cookie header from a logged-in suno.com request"
        />
      </label>
      <p className="hint">
        How to get it: open suno.com while logged in → DevTools (F12) → Network tab →
        click any request to <code>studio-api.prod.suno.com</code> or{' '}
        <code>clerk.suno.com</code> → copy the entire <code>cookie</code> request
        header and paste it above. The cookie is stored encrypted on this machine and
        only sent to Suno. It expires periodically — re-paste when generation stops
        working.
      </p>

      <div className="row">
        <label className="field">
          <span>Default model version</span>
          <select
            value={draft.defaultModelVersion}
            onChange={(e) => update('defaultModelVersion', e.target.value)}
          >
            {MODEL_VERSIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Default persona</span>
          <select
            value={draft.defaultPersonaId ?? ''}
            onChange={(e) =>
              update('defaultPersonaId', e.target.value || undefined)
            }
          >
            <option value="">None</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>Download folder</span>
        <div className="inline">
          <input
            type="text"
            value={draft.downloadDir}
            onChange={(e) => update('downloadDir', e.target.value)}
          />
          <button className="btn" type="button" onClick={pickDir}>
            Browse…
          </button>
        </div>
      </label>

      <div className="inline" style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={save}>
          Save
        </button>
        <button className="btn" onClick={test} disabled={testing}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
      </div>
    </div>
  )
}
