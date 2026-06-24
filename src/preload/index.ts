import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type RendererApi } from '../shared/ipc'
import type { AppSettings, Clip, GenerateRequest } from '../shared/types'

const api: RendererApi = {
  getSettings: () => ipcRenderer.invoke(IpcChannels.getSettings),
  saveSettings: (settings: AppSettings) =>
    ipcRenderer.invoke(IpcChannels.saveSettings, settings),
  checkConnection: () => ipcRenderer.invoke(IpcChannels.checkConnection),
  getBilling: () => ipcRenderer.invoke(IpcChannels.getBilling),
  listPersonas: () => ipcRenderer.invoke(IpcChannels.listPersonas),
  generate: (req: GenerateRequest) => ipcRenderer.invoke(IpcChannels.generate, req),
  getClips: (ids: string[]) => ipcRenderer.invoke(IpcChannels.getClips, ids),
  getLibrary: (page: number) => ipcRenderer.invoke(IpcChannels.getLibrary, page),
  download: (clip: Clip, format: 'mp3' | 'wav') =>
    ipcRenderer.invoke(IpcChannels.download, clip, format),
  pickDownloadDir: () => ipcRenderer.invoke(IpcChannels.pickDownloadDir),
  openDownloadDir: () => ipcRenderer.invoke(IpcChannels.openDownloadDir)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define on window when context isolation is off)
  window.api = api
}
