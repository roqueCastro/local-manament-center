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
  groups?: Record<string, string> // status: grupo de cada opción (To-do, In progress, Complete)
  groupNames?: string[] // status: grupos existentes, en orden
  editable: boolean
}

// ---- Edición del esquema de una database (columnas y opciones) ----

// Tipos de columna que se pueden crear desde la app
export const NEW_PROP_TYPES = [
  { type: 'select', label: 'Selección' },
  { type: 'multi_select', label: 'Selección múltiple' },
  { type: 'rich_text', label: 'Texto' },
  { type: 'number', label: 'Número' },
  { type: 'date', label: 'Fecha' },
  { type: 'checkbox', label: 'Casilla' },
  { type: 'url', label: 'URL' },
  { type: 'email', label: 'Correo' },
  { type: 'phone_number', label: 'Teléfono' }
] as const
export type NewPropType = (typeof NEW_PROP_TYPES)[number]['type']

// Colores de opción que acepta Notion
export const NOTION_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red'
] as const

export type SchemaChange =
  | { kind: 'addOption'; prop: string; name: string; color?: string; group?: string }
  | { kind: 'updateOption'; prop: string; option: string; name?: string; color?: string }
  | { kind: 'deleteOption'; prop: string; option: string }
  | {
      kind: 'addProperty'
      name: string
      type: NewPropType
      options?: { name: string; color?: string }[]
    }
  | { kind: 'renameProperty'; prop: string; name: string }
  | { kind: 'deleteProperty'; prop: string }

export interface SchemaResult {
  ok: boolean
  error?: string
  connection?: NotionConnection
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
  reminderProp?: string | null // columna "Recordatorio" (fecha y hora del aviso)
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
  // Crear/renombrar/eliminar columnas y opciones de una database (se aplica en Notion)
  updateSchema: (databaseId: string, change: SchemaChange) => Promise<SchemaResult>
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
  // Valores para las columnas del proyecto (Cliente, Plan, Estado…), ya validados
  props?: Record<string, PropValue>
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
  // `project`: proyecto destino (null = la IA lo elige entre los activos)
  voiceFromAudio: (audio: ArrayBuffer, mimeType: string, project?: string | null) => Promise<ParseVoiceResult>
  // Texto escrito → tareas con sus columnas llenas (para revisar antes de crear)
  tasksFromText: (text: string, project?: string | null) => Promise<ParseVoiceResult>
}

// Burbuja flotante: el arrastre se calcula en el main con la posición real del cursor.
export interface BubbleApi {
  dragStart: () => void
  dragMove: () => void
  dragEnd: () => void // si no hubo movimiento, el main lo trata como click
  contextMenu: () => void
  onBadge: (cb: (pending: number) => void) => void
}

// ---- Recordatorios ----

// Aviso activo en la ventana de recordatorios
export interface ReminderAlert {
  taskId: string
  title: string
  project: string | null
  at: string // ISO del momento programado (o del pospuesto)
  missed: boolean // la app estaba cerrada a esa hora
}

export type ReminderAction = 'dismiss' | 'done' | 'open' | 'snooze'

export interface RemindersApi {
  // Avisos activos; `sound` = hay avisos nuevos (suena una vez)
  get: () => Promise<{ alerts: ReminderAlert[]; sound: boolean }>
  act: (taskId: string, action: ReminderAction, minutes?: number) => Promise<void>
  onChanged: (cb: () => void) => void
  resize: (height: number) => void // la ventana se ajusta a su contenido
}

// Preferencias del gestor que se recuerdan entre aperturas y reinicios
export interface ManagerPrefs {
  project: string // proyecto seleccionado ('' = Todos)
  filter: 'pending' | 'done' | 'all'
  views: Record<string, unknown> // filtros y orden de la tabla por proyecto ('*' = Todos)
  aiText?: boolean // procesar con IA el texto de "Nueva tarea" (por defecto sí, si hay key)
  compact?: boolean // tabla compacta (textos recortados a 2 líneas); por defecto texto completo
}

export interface WindowApi {
  tasks: TaskApi
  notion: NotionApi
  sync: SyncApi
  projects: ProjectsApi
  ai: AiApi
  bubble: BubbleApi
  reminders: RemindersApi
  // Iniciar la app con el sistema (para no perder recordatorios)
  autostart: {
    get: () => Promise<boolean>
    set: (on: boolean) => Promise<boolean>
  }
  // El gestor recibe "abrir esta tarea" (desde un recordatorio)
  onSelectTask: (cb: (taskId: string) => void) => void
  takeSelectTask: () => Promise<string | null>
  hidePanel: () => void
  openManager: () => void // abre la ventana grande "Gestor de tareas"
  hideManager: () => void
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
