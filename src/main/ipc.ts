import { ipcMain } from 'electron'
import type { NewTaskInput, TaskPatch } from '../shared/types'
import { createTask, listTasks, removeTask, toggleTask, updateTask } from './db'
import { clearAiKey, getAiStatus, setAiKey, voiceFromAudio } from './ai'
import {
  connectNotion,
  createProject,
  disconnectNotion,
  getConnection,
  getProjects,
  getSyncState,
  requestSync,
  syncNow
} from './sync'

// Registra todos los handlers IPC que el renderer invoca vía window.api.
export function registerIpc(): void {
  // --- Tareas (tras cada mutación, agenda un sync con debounce) ---
  ipcMain.handle('tasks:list', () => listTasks())
  ipcMain.handle('tasks:create', (_e, input: NewTaskInput) => {
    const t = createTask(input)
    requestSync()
    return t
  })
  ipcMain.handle('tasks:update', (_e, id: string, patch: TaskPatch) => {
    const t = updateTask(id, patch)
    requestSync()
    return t
  })
  ipcMain.handle('tasks:toggle', (_e, id: string) => {
    const t = toggleTask(id)
    requestSync()
    return t
  })
  ipcMain.handle('tasks:remove', (_e, id: string) => {
    const ok = removeTask(id)
    requestSync()
    return ok
  })

  // --- Notion ---
  ipcMain.handle('notion:getConnection', () => getConnection())
  ipcMain.handle('notion:connect', (_e, token: string, databaseId: string) =>
    connectNotion(token, databaseId)
  )
  ipcMain.handle('notion:disconnect', () => disconnectNotion())

  // --- Sync ---
  ipcMain.handle('sync:now', () => syncNow())
  ipcMain.handle('sync:getState', () => getSyncState())

  // --- Proyectos ---
  ipcMain.handle('projects:list', () => getProjects())
  ipcMain.handle('projects:create', (_e, name: string) => createProject(name))

  // --- IA / Voz (Groq) ---
  ipcMain.handle('ai:getStatus', () => getAiStatus())
  ipcMain.handle('ai:setKey', (_e, key: string) => setAiKey(key))
  ipcMain.handle('ai:clearKey', () => clearAiKey())
  ipcMain.handle('ai:voiceFromAudio', (_e, audio: ArrayBuffer, mimeType: string) =>
    voiceFromAudio(audio, mimeType)
  )
}
