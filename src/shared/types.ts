// Tipos compartidos entre el main process y el renderer (React)

export type TaskStatus = 'pending' | 'done'

export interface Task {
  id: string
  notionId: string | null
  title: string
  status: TaskStatus
  dueDate: string | null // ISO 8601
  priority: number // 0-3
  tags: string[]
  project: string | null // nombre del proyecto (propiedad "Proyecto" en Notion)
  createdAt: string
  updatedAt: string
  synced: boolean
}

// Datos para crear una tarea (el resto se completa en el main)
export interface NewTaskInput {
  title: string
  dueDate?: string | null
  priority?: number
  tags?: string[]
  project?: string | null
}

// Campos editables de una tarea existente
export interface TaskPatch {
  title?: string
  status?: TaskStatus
  dueDate?: string | null
  priority?: number
  tags?: string[]
  project?: string | null
}

// ---- Notion ----

// Resumen del mapeo de propiedades auto-detectado en la database de Notion
export interface NotionMappingSummary {
  title: string
  statusProp: string | null
  statusKind: 'status' | 'checkbox' | 'select' | null
  dueProp: string | null
  priorityProp: string | null
  tagsProp: string | null
  projectProp: string | null
}

export interface NotionConnection {
  connected: boolean
  databaseId: string | null
  databaseTitle: string | null
  lastSyncTime: string | null
  encryptionAvailable: boolean
  mapping: NotionMappingSummary | null
}

export interface ConnectResult {
  ok: boolean
  error?: string
  databaseTitle?: string
  mapping?: NotionMappingSummary
}

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'disconnected'

export interface SyncState {
  status: SyncStatus
  lastSyncTime: string | null
  lastError: string | null
  pushed: number
  pulled: number
}

// ---- API expuesta al renderer (window.api) ----

export interface TaskApi {
  list: () => Promise<Task[]>
  create: (input: NewTaskInput) => Promise<Task>
  update: (id: string, patch: TaskPatch) => Promise<Task | null>
  toggle: (id: string) => Promise<Task | null>
  remove: (id: string) => Promise<boolean>
}

export interface NotionApi {
  getConnection: () => Promise<NotionConnection>
  connect: (token: string, databaseId: string) => Promise<ConnectResult>
  disconnect: () => Promise<void>
}

export interface SyncApi {
  now: () => Promise<SyncState>
  getState: () => Promise<SyncState>
}

export interface ProjectsApi {
  list: () => Promise<string[]>
  create: (name: string) => Promise<string[]>
}

// ---- IA / Voz (Groq) ----

// Tarea propuesta por la IA a partir de la voz (para revisar antes de crear)
export interface VoiceTask {
  title: string
  dueDate: string | null
  priority: number
  tags: string[]
  project: string | null
}

export interface AiStatus {
  hasKey: boolean
  encryptionAvailable: boolean
}

export interface ParseVoiceResult {
  ok: boolean
  error?: string
  tasks?: VoiceTask[]
  transcript?: string // lo que la IA entendió del audio
}

export interface AiApi {
  getStatus: () => Promise<AiStatus>
  setKey: (key: string) => Promise<AiStatus>
  clearKey: () => Promise<AiStatus>
  // Recibe el audio grabado (webm/ogg/wav); Groq lo transcribe y lo convierte en tareas.
  voiceFromAudio: (audio: ArrayBuffer, mimeType: string) => Promise<ParseVoiceResult>
}

export interface WindowApi {
  tasks: TaskApi
  notion: NotionApi
  sync: SyncApi
  projects: ProjectsApi
  ai: AiApi
  hidePanel: () => void
  // Mientras esté "fijado", el panel no se oculta al perder el foco.
  setPinned: (pinned: boolean) => void
  // Suscripción a cambios en los datos (tras un sync).
  onChanged: (cb: () => void) => void
  offChanged: () => void
  // Suscripción al estado de sincronización.
  onSyncState: (cb: (state: SyncState) => void) => void
  offSyncState: () => void
}
