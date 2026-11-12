import { create } from 'zustand'
import type {
  AiStatus,
  ConnectResult,
  NewTaskInput,
  NotionConnection,
  SchemaChange,
  SyncState,
  Task,
  TaskPatch,
  VoiceTask
} from '../../shared/types'

type Filter = 'pending' | 'done' | 'all'
type View = 'tasks' | 'settings'
type VoiceState = 'idle' | 'processing' | 'review' | 'error'

interface TasksState {
  tasks: Task[]
  filter: Filter
  loading: boolean
  view: View
  notion: NotionConnection | null
  syncState: SyncState | null
  projects: string[]
  activeProject: string // '' = Todos

  load: () => Promise<void>
  add: (input: NewTaskInput) => Promise<void>
  toggle: (id: string) => Promise<void>
  edit: (id: string, patch: TaskPatch) => Promise<void>
  remove: (id: string) => Promise<void>
  setFilter: (f: Filter) => void
  setView: (v: View) => void

  loadConnection: () => Promise<void>
  connectNotion: (token: string, databaseId: string) => Promise<ConnectResult>
  disconnectNotion: () => Promise<void>
  setProjectEnabled: (databaseId: string, enabled: boolean) => Promise<void>
  // Cambia columnas/opciones en Notion. Devuelve el mensaje de error, o null si salió bien.
  updateSchema: (databaseId: string, change: SchemaChange) => Promise<string | null>
  syncNow: () => Promise<void>
  setSyncState: (s: SyncState) => void

  loadProjects: () => Promise<void>
  newProject: (name: string) => Promise<void>
  setActiveProject: (p: string) => void
  moveTask: (id: string, project: string | null) => Promise<void>

  ai: AiStatus | null
  voiceState: VoiceState
  voiceTasks: VoiceTask[]
  voiceError: string | null
  loadAiStatus: () => Promise<void>
  setAiKey: (key: string) => Promise<void>
  clearAiKey: () => Promise<void>
  processVoiceAudio: (audio: ArrayBuffer, mimeType: string) => Promise<void>
  confirmVoice: (tasks: VoiceTask[]) => Promise<void>
  cancelVoice: () => void
}

export const useTasks = create<TasksState>((set, get) => ({
  tasks: [],
  filter: 'pending',
  loading: false,
  view: 'tasks',
  notion: null,
  syncState: null,
  projects: [],
  activeProject: '',
  ai: null,
  voiceState: 'idle',
  voiceTasks: [],
  voiceError: null,

  load: async () => {
    set({ loading: true })
    try {
      const tasks = await window.api.tasks.list()
      set({ tasks, loading: false })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error al cargar tareas:', e)
      set({ loading: false })
    }
  },

  add: async (input) => {
    // Al crear, asignar el proyecto activo (si hay uno seleccionado)
    const active = get().activeProject
    await window.api.tasks.create({ ...input, project: active || input.project || null })
    await get().load()
    await get().loadProjects()
  },

  toggle: async (id) => {
    await window.api.tasks.toggle(id)
    await get().load()
  },

  edit: async (id, patch) => {
    await window.api.tasks.update(id, patch)
    await get().load()
  },

  remove: async (id) => {
    await window.api.tasks.remove(id)
    await get().load()
  },

  setFilter: (filter) => set({ filter }),
  setView: (view) => set({ view }),

  loadConnection: async () => {
    try {
      const [notion, syncState] = await Promise.all([
        window.api.notion.getConnection(),
        window.api.sync.getState()
      ])
      set({ notion, syncState })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error al cargar conexión:', e)
    }
  },

  connectNotion: async (token, databaseId) => {
    const res = await window.api.notion.connect(token, databaseId)
    if (res.ok) {
      await get().loadConnection()
      await get().load()
    }
    return res
  },

  disconnectNotion: async () => {
    await window.api.notion.disconnect()
    await get().loadConnection()
  },

  setProjectEnabled: async (databaseId, enabled) => {
    const notion = await window.api.notion.setEnabled(databaseId, enabled)
    set({ notion })
    await get().loadProjects()
  },

  updateSchema: async (databaseId, change) => {
    try {
      const res = await window.api.notion.updateSchema(databaseId, change)
      if (!res.ok) return res.error ?? 'No se pudo aplicar el cambio.'
      if (res.connection) set({ notion: res.connection })
      await get().load()
      return null
    } catch (e) {
      return (e as Error)?.message ?? 'No se pudo aplicar el cambio.'
    }
  },

  syncNow: async () => {
    try {
      const state = await window.api.sync.now()
      set({ syncState: state })
      await get().load()
      await get().loadConnection()
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error al sincronizar:', e)
    }
  },

  setSyncState: (syncState) => set({ syncState }),

  loadProjects: async () => {
    try {
      const projects = await window.api.projects.list()
      // Si el proyecto activo se desmarcó en Ajustes, volver a "Todos"
      const active = get().activeProject
      set({ projects, activeProject: active && !projects.includes(active) ? '' : active })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error al cargar proyectos:', e)
    }
  },

  newProject: async (name) => {
    try {
      const projects = await window.api.projects.create(name)
      set({ projects, activeProject: name.trim() })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error al crear proyecto:', e)
    }
  },

  setActiveProject: (activeProject) => set({ activeProject }),

  moveTask: async (id, project) => {
    await window.api.tasks.update(id, { project })
    await get().load()
    await get().loadProjects()
  },

  loadAiStatus: async () => {
    try {
      const ai = await window.api.ai.getStatus()
      set({ ai })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error al cargar estado de IA:', e)
    }
  },

  setAiKey: async (key) => {
    const ai = await window.api.ai.setKey(key)
    set({ ai })
  },

  clearAiKey: async () => {
    const ai = await window.api.ai.clearKey()
    set({ ai })
  },

  processVoiceAudio: async (audio, mimeType) => {
    set({ voiceState: 'processing', voiceError: null, voiceTasks: [] })
    try {
      const res = await window.api.ai.voiceFromAudio(audio, mimeType)
      if (res.ok && res.tasks) {
        set({ voiceState: 'review', voiceTasks: res.tasks })
      } else {
        set({ voiceState: 'error', voiceError: res.error ?? 'No se pudieron interpretar las tareas.' })
      }
    } catch (e) {
      set({
        voiceState: 'error',
        voiceError: (e as Error)?.message ?? 'Error al procesar la voz.'
      })
    }
  },

  confirmVoice: async (tasks) => {
    const active = get().activeProject
    for (const t of tasks) {
      await window.api.tasks.create({
        title: t.title,
        dueDate: t.dueDate,
        priority: t.priority,
        tags: t.tags,
        project: t.project ?? (active || null)
      })
    }
    set({ voiceState: 'idle', voiceTasks: [], voiceError: null })
    await get().load()
    await get().loadProjects()
  },

  cancelVoice: () => set({ voiceState: 'idle', voiceTasks: [], voiceError: null })
}))
