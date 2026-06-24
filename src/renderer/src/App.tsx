import { useCallback, useEffect, useState } from 'react'
import type {
  AppSettings,
  BillingInfo,
  Clip,
  Persona,
  StylePreset
} from '../../shared/types'
import { unwrap } from './lib/api'
import CreatePage from './components/CreatePage'
import Library from './components/Library'
import Settings from './components/Settings'

type Tab = 'create' | 'library' | 'settings'

interface Toast {
  msg: string
  kind: 'error' | 'success'
}

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('create')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [personas, setPersonas] = useState<Persona[]>([])
  const [billing, setBilling] = useState<BillingInfo | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [extendTarget, setExtendTarget] = useState<Clip | null>(null)

  const notify = useCallback((msg: string, kind: 'error' | 'success') => {
    setToast({ msg, kind })
    window.setTimeout(() => setToast(null), 4500)
  }, [])

  const refreshBilling = useCallback(async () => {
    try {
      setBilling(await unwrap(window.api.getBilling()))
    } catch {
      setBilling(null)
    }
  }, [])

  const loadConnected = useCallback(async () => {
    try {
      const [p] = await Promise.all([unwrap(window.api.listPersonas())])
      setPersonas(p)
    } catch {
      setPersonas([])
    }
    void refreshBilling()
  }, [refreshBilling])

  useEffect(() => {
    void (async () => {
      try {
        const s = await unwrap(window.api.getSettings())
        setSettings(s)
        if (s.sunoCookie) {
          void loadConnected()
        } else {
          setTab('settings')
        }
      } catch (err) {
        notify((err as Error).message, 'error')
      }
    })()
  }, [loadConnected, notify])

  const saveSettings = useCallback(
    async (next: AppSettings) => {
      const saved = await unwrap(window.api.saveSettings(next))
      setSettings(saved)
      if (saved.sunoCookie) void loadConnected()
    },
    [loadConnected]
  )

  const savePreset = useCallback(
    (preset: StylePreset) => {
      if (!settings) return
      const presets = [
        ...settings.presets.filter((p) => p.name !== preset.name),
        preset
      ]
      void saveSettings({ ...settings, presets })
    },
    [settings, saveSettings]
  )

  if (!settings) {
    return <div className="empty">Loading…</div>
  }

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">Suno Studio</span>
        <div className="tabs">
          {(['create', 'library', 'settings'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`tab ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className="billing">
          {billing ? (
            <>
              <span className="ok-dot">●</span> <b>{billing.creditsLeft}</b> credits
            </>
          ) : (
            <>
              <span className="bad-dot">●</span> not connected
            </>
          )}
        </div>
      </div>

      <div className="body">
        {tab === 'create' && (
          <CreatePage
            settings={settings}
            personas={personas}
            extendTarget={extendTarget}
            onClearExtend={() => setExtendTarget(null)}
            onSavePreset={savePreset}
            onNotify={notify}
            onCreditsChanged={refreshBilling}
          />
        )}
        {tab === 'library' && (
          <Library
            onNotify={notify}
            onExtend={(clip) => {
              setExtendTarget(clip)
              setTab('create')
            }}
          />
        )}
        {tab === 'settings' && (
          <Settings
            settings={settings}
            personas={personas}
            onSave={saveSettings}
            onNotify={notify}
          />
        )}
      </div>

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  )
}
