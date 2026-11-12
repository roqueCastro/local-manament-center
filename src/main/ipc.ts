import { BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { NewTaskInput, SchemaChange, TaskPatch } from '../shared/types'
import { listTasks, removeTask } from './db'
import { createTaskSvc, toggleTaskSvc, updateTaskSvc } from './tasks'
import { getUiSettings, isDatabaseExcluded, saveUiSettings } from './settings'
import type { ManagerPrefs } from '../shared/types'
import { updateBubbleBadge } from './bubble'
import { updateSchema } from './schema'
import { refreshReminders } from './reminders'
import { clearAiKey, getAiStatus, setAiKey, tasksFromText, voiceFromAudio } from './ai'
import {
  connectNotion,
  createProject,
  disconnectNotion,
  getConnection,
  getProjects,
  getSyncState,
  requestSync,
  setDatabaseEnabled,
  syncNow
} from './sync'

// Tras un cambio local: sincronizar (con debounce), actualizar la burbuja y avisar a las
// demás ventanas (panel ↔ gestor) para que recarguen.
function afterMutation(e: IpcMainInvokeEvent): void {
  requestSync()
  updateBubbleBadge()
  refreshReminders()
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('data:changed')
  }
}

// Registra todos los handlers IPC que el renderer invoca vía window.api.
export function registerIpc(): void {
  // --- Tareas (tras cada mutación, agenda un sync con debounce) ---
  // Las tareas de proyectos desmarcados en Ajustes no se muestran (el sync las quita)
  ipcMain.handle('tasks:list', () =>
    listTasks().filter((t) => !t.notionDb || !isDatabaseExcluded(t.notionDb))
  )
  ipcMain.handle('tasks:create', (e, input: NewTaskInput) => {
    const t = createTaskSvc(input)
    afterMutation(e)
    return t
  })
  ipcMain.handle('tasks:update', (e, id: string, patch: TaskPatch) => {
    const t = updateTaskSvc(id, patch)
    afterMutation(e)
    return t
  })
  ipcMain.handle('tasks:toggle', (e, id: string) => {
    const t = toggleTaskSvc(id)
    afterMutation(e)
    return t
  })
  ipcMain.handle('tasks:remove', (e, id: string) => {
    const ok = removeTask(id)
    afterMutation(e)
    return ok
  })

  // --- Preferencias del gestor (se escriben al instante en settings.json) ---
  ipcMain.handle(
    'prefs:getManager',
    (): ManagerPrefs => getUiSettings().manager ?? { project: '', filter: 'pending', views: {} }
  )
  ipcMain.on('prefs:setManager', (_e, patch: Partial<ManagerPrefs>) => {
    const cur = getUiSettings().manager ?? { project: '', filter: 'pending', views: {} }
    saveUiSettings({ manager: { ...cur, ...patch } })
  })

  // --- Notion ---
  ipcMain.handle('notion:getConnection', () => getConnection())
  ipcMain.handle('notion:connect', (_e, token: string, databaseId: string) =>
    connectNotion(token, databaseId)
  )
  ipcMain.handle('notion:disconnect', () => disconnectNotion())
  ipcMain.handle('notion:setEnabled', (_e, id: string, enabled: boolean) =>
    setDatabaseEnabled(id, enabled)
  )
  // Columnas y opciones: se aplica en Notion y se avisa a todas las ventanas
  ipcMain.handle('notion:updateSchema', async (_e, id: string, change: SchemaChange) => {
    const res = await updateSchema(id, change)
    if (res.ok) {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('data:changed')
      }
    }
    return res
  })

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
  ipcMain.handle('ai:voiceFromAudio', (_e, audio: ArrayBuffer, mimeType: string, project: string | null) =>
    voiceFromAudio(audio, mimeType, project)
  )
  ipcMain.handle('ai:tasksFromText', (_e, text: string, project: string | null) =>
    tasksFromText(text, project)
  )
}
