// Tipos compartidos entre el main process y el renderer (React)

export type TaskStatus = 'pending' | 'done'

// Valor simplificado de una propiedad de Notion (texto, número, opción, lista, fecha ISO, check)
export type PropValue = string | number | boolean | string[] | null

// Tipos de propiedad de Notion que la app puede editar
export const EDITABLE_PROP_TYPES = [
  'title',
  'rich_text',
  'number',
  'select',
  'status',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'email',
  'phone_number'
] as const

// Columna de una database de Notion
export interface PropSchema {
  name: string
  type: string // tipo de Notion: rich_text, select, status, date, people, formula…
  options?: string[] // select / status / multi_select
  colors?: Record<string, string> // color de Notion de cada opción (blue, green, red…)
  editable: boolean
}

export interface Task {
  id: string
  notionId: string | null
  title: string
  status: TaskStatus
  dueDate: string | null // ISO 8601
  priority: number // 0-3
  tags: string[]
  project: string | null // nombre del proyecto (= título de la database de Notion)
  notionDb: string | null // id de la database de Notion donde vive la tarea
  props: Record<string, PropValue> // todas las propiedades de Notion (Cliente, Contacto, Estado…)
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
  props?: Record<string, PropValue>
}

// Campos editables de una tarea existente
export interface TaskPatch {
  title?: string
  status?: TaskStatus
  dueDate?: string | null
  priority?: number
  tags?: string[]
  project?: string | null
  props?: Record<string, PropValue> // cambios en propiedades de Notion (solo las indicadas)
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
}

// Database de Notion accesible por la integración (= un proyecto en la app)
export interface NotionDatabaseSummary {
  id: string
  title: string
  isDefault: boolean // recibe las tareas creadas sin proyecto
  enabled: boolean // el usuario eligió traer este proyecto
  mapping: NotionMappingSummary
  schema: PropSchema[]
}

export interface NotionConnection {
  connected: boolean
  databaseId: string | null
  databaseTitle: string | null
  lastSyncTime: string | null
  encryptionAvailable: boolean
  databases: NotionDatabaseSummary[]
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
  // Elegir qué proyectos (databases) traer a la app
  setEnabled: (databaseId: string, enabled: boolean) => Promise<NotionConnection>
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

// Burbuja flotante: el arrastre se calcula en el main con la posición real del cursor.
export interface BubbleApi {
  dragStart: () => void
  dragMove: () => void
  dragEnd: () => void // si no hubo movimiento, el main lo trata como click
  contextMenu: () => void
  onBadge: (cb: (pending: number) => void) => void
}

// Preferencias del gestor que se recuerdan entre aperturas y reinicios
export interface ManagerPrefs {
  project: string // proyecto seleccionado ('' = Todos)
  filter: 'pending' | 'done' | 'all'
  views: Record<string, unknown> // filtros y orden de la tabla por proyecto ('*' = Todos)
}

export interface WindowApi {
  tasks: TaskApi
  notion: NotionApi
  sync: SyncApi
  projects: ProjectsApi
  ai: AiApi
  bubble: BubbleApi
  hidePanel: () => void
  openManager: () => void // abre la ventana grande "Gestor de tareas"
  managerPrefs: {
    get: () => Promise<ManagerPrefs>
    set: (patch: Partial<ManagerPrefs>) => void
  }
  // Mientras esté "fijado", el panel no se oculta al perder el foco.
  setPinned: (pinned: boolean) => void
  // Suscripción a cambios en los datos (tras un sync).
  onChanged: (cb: () => void) => void
  offChanged: () => void
  // Suscripción al estado de sincronización.
  onSyncState: (cb: (state: SyncState) => void) => void
  offSyncState: () => void
}
