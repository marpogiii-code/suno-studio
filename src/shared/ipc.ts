import type {
  AppSettings,
  BillingInfo,
  Clip,
  GenerateRequest,
  IpcResult,
  Persona
} from './types'

export const IpcChannels = {
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  checkConnection: 'suno:check',
  getBilling: 'suno:billing',
  listPersonas: 'suno:personas',
  generate: 'suno:generate',
  getClips: 'suno:clips',
  getLibrary: 'suno:library',
  download: 'suno:download',
  pickDownloadDir: 'dialog:pickDir',
  openDownloadDir: 'shell:openDir'
} as const

/** The typed surface exposed to the renderer via contextBridge as `window.api`. */
export interface RendererApi {
  getSettings(): Promise<IpcResult<AppSettings>>
  saveSettings(settings: AppSettings): Promise<IpcResult<AppSettings>>
  checkConnection(): Promise<IpcResult<BillingInfo>>
  getBilling(): Promise<IpcResult<BillingInfo>>
  listPersonas(): Promise<IpcResult<Persona[]>>
  generate(req: GenerateRequest): Promise<IpcResult<Clip[]>>
  getClips(ids: string[]): Promise<IpcResult<Clip[]>>
  getLibrary(page: number): Promise<IpcResult<Clip[]>>
  download(clip: Clip, format: 'mp3' | 'wav'): Promise<IpcResult<string>>
  pickDownloadDir(): Promise<IpcResult<string | null>>
  openDownloadDir(): Promise<IpcResult<null>>
}
