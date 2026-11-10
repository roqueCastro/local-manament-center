import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiStatus,
  ConnectResult,
  NewTaskInput,
  NotionConnection,
  ParseVoiceResult,
  SyncState,
  Task,
  TaskPatch,
  WindowApi
} from '../shared/types'

// API segura expuesta al renderer. El renderer NUNCA accede a Node ni a las
// APIs externas directamente: todo pasa por aquí vía IPC.
const api: WindowApi = {
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list') as Promise<Task[]>,
    create: (input: NewTaskInput) => ipcRenderer.invoke('tasks:create', input) as Promise<Task>,
    update: (id: string, patch: TaskPatch) =>
      ipcRenderer.invoke('tasks:update', id, patch) as Promise<Task | null>,
    toggle: (id: string) => ipcRenderer.invoke('tasks:toggle', id) as Promise<Task | null>,
    remove: (id: string) => ipcRenderer.invoke('tasks:remove', id) as Promise<boolean>
  },
  notion: {
    getConnection: () =>
      ipcRenderer.invoke('notion:getConnection') as Promise<NotionConnection>,
    connect: (token: string, databaseId: string) =>
      ipcRenderer.invoke('notion:connect', token, databaseId) as Promise<ConnectResult>,
    disconnect: () => ipcRenderer.invoke('notion:disconnect') as Promise<void>
  },
  sync: {
    now: () => ipcRenderer.invoke('sync:now') as Promise<SyncState>,
    getState: () => ipcRenderer.invoke('sync:getState') as Promise<SyncState>
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list') as Promise<string[]>,
    create: (name: string) => ipcRenderer.invoke('projects:create', name) as Promise<string[]>
  },
  ai: {
    getStatus: () => ipcRenderer.invoke('ai:getStatus') as Promise<AiStatus>,
    setKey: (key: string) => ipcRenderer.invoke('ai:setKey', key) as Promise<AiStatus>,
    clearKey: () => ipcRenderer.invoke('ai:clearKey') as Promise<AiStatus>,
    voiceFromAudio: (audio: ArrayBuffer, mimeType: string) =>
      ipcRenderer.invoke('ai:voiceFromAudio', audio, mimeType) as Promise<ParseVoiceResult>
  },
  hidePanel: () => ipcRenderer.send('panel:hide'),
  setPinned: (pinned: boolean) => ipcRenderer.send('panel:setPinned', pinned),
  // Nota: no retornamos funciones a través de contextBridge (structured clone
  // no las soporta de forma fiable). Usamos on/off separados.
  onChanged: (cb: () => void) => {
    ipcRenderer.on('data:changed', () => cb())
  },
  offChanged: () => {
    ipcRenderer.removeAllListeners('data:changed')
  },
  onSyncState: (cb: (state: SyncState) => void) => {
    ipcRenderer.on('sync:state', (_e, state: SyncState) => cb(state))
  },
  offSyncState: () => {
    ipcRenderer.removeAllListeners('sync:state')
  }
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[preload] falló exposeInMainWorld:', e)
}
