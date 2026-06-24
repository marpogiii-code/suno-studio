import { app, safeStorage } from 'electron'
import Store from 'electron-store'
import { join } from 'path'
import type { AppSettings, StylePreset } from '../shared/types'

interface PersistedShape {
  /** Encrypted (base64) Suno cookie when OS encryption is available, else plain. */
  sunoCookieEnc: string
  cookieEncrypted: boolean
  defaultModelVersion: string
  defaultPersonaId?: string
  downloadDir: string
  presets: StylePreset[]
}

const DEFAULT_MODEL = 'chirp-v3-5'

function defaultDownloadDir(): string {
  return join(app.getPath('music'), 'SunoStudio')
}

const store = new Store<PersistedShape>({
  name: 'suno-studio-settings',
  defaults: {
    sunoCookieEnc: '',
    cookieEncrypted: false,
    defaultModelVersion: DEFAULT_MODEL,
    defaultPersonaId: undefined,
    downloadDir: '',
    presets: []
  }
})

function encryptCookie(raw: string): { value: string; encrypted: boolean } {
  if (!raw) return { value: '', encrypted: false }
  if (safeStorage.isEncryptionAvailable()) {
    return { value: safeStorage.encryptString(raw).toString('base64'), encrypted: true }
  }
  return { value: raw, encrypted: false }
}

function decryptCookie(value: string, encrypted: boolean): string {
  if (!value) return ''
  if (encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    } catch {
      return ''
    }
  }
  return value
}

export function getSettings(): AppSettings {
  return {
    sunoCookie: decryptCookie(store.get('sunoCookieEnc'), store.get('cookieEncrypted')),
    defaultModelVersion: store.get('defaultModelVersion') || DEFAULT_MODEL,
    defaultPersonaId: store.get('defaultPersonaId'),
    downloadDir: store.get('downloadDir') || defaultDownloadDir(),
    presets: store.get('presets') ?? []
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  const { value, encrypted } = encryptCookie(settings.sunoCookie ?? '')
  store.set('sunoCookieEnc', value)
  store.set('cookieEncrypted', encrypted)
  store.set('defaultModelVersion', settings.defaultModelVersion || DEFAULT_MODEL)
  store.set('defaultPersonaId', settings.defaultPersonaId)
  store.set('downloadDir', settings.downloadDir || defaultDownloadDir())
  store.set('presets', settings.presets ?? [])
  return getSettings()
}

export function getCookie(): string {
  return decryptCookie(store.get('sunoCookieEnc'), store.get('cookieEncrypted'))
}
