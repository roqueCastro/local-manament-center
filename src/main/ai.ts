import type { AiStatus, ParseVoiceResult, PropSchema, PropValue, VoiceTask } from '../shared/types'
import { getProjects } from './sync'
import { GroqError, parseTasksFromText, transcribeAudio, type AiTask } from './groq'
import { optionFromPriority } from './notion'
import { fromLocalInput, isReminderName } from '../shared/dates'
import {
  clearGroqKey,
  encryptionAvailable,
  getActiveDatabases,
  getGroqKey,
  getNotionSettings,
  hasGroqKey,
  isNotionConnected,
  saveGroqKey,
  type NotionDatabase
} from './settings'

export function getAiStatus(): AiStatus {
  return { hasKey: hasGroqKey(), encryptionAvailable: encryptionAvailable() }
}

export function setAiKey(key: string): AiStatus {
  saveGroqKey(key.trim())
  return getAiStatus()
}

export function clearAiKey(): AiStatus {
  clearGroqKey()
  return getAiStatus()
}

function filenameFor(mimeType: string): string {
  if (mimeType.includes('webm')) return 'audio.webm'
  if (mimeType.includes('ogg')) return 'audio.ogg'
  if (mimeType.includes('wav')) return 'audio.wav'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'audio.m4a'
  return 'audio.webm'
}

// Fecha local (toISOString daría mañana por la noche, al estar en UTC)
function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

// ---- Columnas de cada proyecto para la IA ----

const MAX_OPTIONS = 60
const sameText = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

function describeColumn(p: PropSchema): string | null {
  if (p.type === 'date' && isReminderName(p.name)) {
    return 'recordatorio: fecha y hora "YYYY-MM-DDTHH:mm" en hora local; úsala cuando pida que le recuerden o avisen algo a cierta hora'
  }
  const opts = (p.options ?? []).slice(0, MAX_OPTIONS).map((o) => `"${o}"`).join(', ')
  switch (p.type) {
    case 'rich_text':
      return 'texto'
    case 'number':
      return 'número'
    case 'select':
      return `selección; opciones: ${opts || '(ninguna)'}`
    case 'status':
      return `estado; opciones: ${opts || '(ninguna)'}`
    case 'multi_select':
      return `selección múltiple (array); opciones: ${opts || '(ninguna)'}`
    case 'date':
      return 'fecha "YYYY-MM-DD"'
    case 'checkbox':
      return 'casilla true/false'
    case 'url':
      return 'URL'
    case 'email':
      return 'correo electrónico'
    case 'phone_number':
      return 'teléfono'
    default:
      return null
  }
}

function describeDatabase(d: NotionDatabase): string {
  const lines = (d.schema ?? [])
    // La fecha de creación la pone la app sola al crear la tarea
    .filter((p) => p.editable && p.type !== 'title' && !(p.type === 'date' && /creaci|created/i.test(p.name)))
    .map((p) => {
      const desc = describeColumn(p)
      return desc ? `  - "${p.name}" (${desc})` : null
    })
    .filter(Boolean)
  return `Proyecto "${d.title}":\n${lines.join('\n') || '  (sin columnas)'}`
}

// Proyectos y columnas que se le pasan a la IA. Con proyecto indicado: solo ese.
function aiContext(project: string | null): {
  projects: string[]
  dbs: NotionDatabase[]
  forced: NotionDatabase | null
  columns?: string
} {
  const dbs = isNotionConnected() ? getActiveDatabases() : []
  const forced = project ? (dbs.find((d) => sameText(d.title, project)) ?? null) : null
  const target = forced ? [forced] : dbs
  return {
    projects: forced ? [forced.title] : getProjects(),
    dbs,
    forced,
    columns: target.length ? target.map(describeDatabase).join('\n\n') : undefined
  }
}

// ---- Validación de lo que propone la IA contra el esquema real ----

function coerce(p: PropSchema, v: unknown): PropValue | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const asStr = (x: unknown): string => (typeof x === 'string' ? x : String(x)).trim()
  const matchOption = (x: unknown): string | undefined =>
    (p.options ?? []).find((o) => sameText(o, asStr(x)))
  switch (p.type) {
    case 'select':
    case 'status':
      return matchOption(v)
    case 'multi_select': {
      const arr = Array.isArray(v) ? v : asStr(v).split(',')
      const out = [...new Set(arr.map(matchOption).filter((x): x is string => !!x))]
      return out.length ? out : undefined
    }
    case 'date': {
      const s = asStr(v)
      // Recordatorio con hora → ISO con el desfase local (la hora no se corre por UTC)
      const dt = s.match(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/)
      if (dt && isReminderName(p.name)) return fromLocalInput(dt[0].replace(' ', 'T')) ?? undefined
      const m = s.match(/^\d{4}-\d{2}-\d{2}/)
      return m ? m[0] : undefined
    }
    case 'number': {
      const n = typeof v === 'number' ? v : Number(asStr(v).replace(',', '.'))
      return Number.isFinite(n) ? n : undefined
    }
    case 'checkbox':
      if (typeof v === 'boolean') return v
      return /^(true|s[ií]|yes|1)$/i.test(asStr(v)) ? true : /^(false|no|0)$/i.test(asStr(v)) ? false : undefined
    case 'rich_text':
    case 'url':
    case 'email':
    case 'phone_number': {
      const s = Array.isArray(v) ? v.join(', ') : asStr(v)
      return s || undefined
    }
    default:
      return undefined
  }
}

function sanitize(t: AiTask, ctx: ReturnType<typeof aiContext>): VoiceTask {
  const { fields, ...base } = t
  const defaultDb = ctx.dbs.find((d) => d.id === getNotionSettings().databaseId) ?? ctx.dbs[0]
  const db =
    ctx.forced ??
    (t.project ? ctx.dbs.find((d) => sameText(d.title, t.project!)) : undefined) ??
    (ctx.dbs.length ? defaultDb : undefined)
  if (!db) return base

  const schema = db.schema ?? []
  const props: Record<string, PropValue> = {}
  for (const [name, value] of Object.entries(fields)) {
    const p = schema.find((x) => x.name === name) ?? schema.find((x) => sameText(x.name, name))
    if (!p || !p.editable || p.type === 'title') continue
    const v = coerce(p, value)
    if (v !== undefined) props[p.name] = v
  }

  // Campos "clásicos" de la IA → su columna, si no vinieron ya en fields
  const m = db.mapping
  if (base.dueDate && m.dueProp && props[m.dueProp] === undefined) props[m.dueProp] = base.dueDate
  if (base.priority > 0 && m.priorityProp && props[m.priorityProp] === undefined) {
    const pv = m.priorityKind === 'select' ? optionFromPriority(base.priority, m) : base.priority
    if (pv !== null) props[m.priorityProp] = pv
  }
  if (base.tags.length && m.tagsProp && props[m.tagsProp] === undefined) {
    const p = schema.find((x) => x.name === m.tagsProp)
    const tags = p ? coerce(p, base.tags) : undefined
    if (tags !== undefined) props[m.tagsProp] = tags
  }
  return { ...base, project: db.title, props }
}

async function structure(key: string, text: string, project: string | null): Promise<VoiceTask[]> {
  const ctx = aiContext(project)
  const tasks = await parseTasksFromText(key, text, {
    today: localToday(),
    projects: ctx.projects,
    columns: ctx.columns
  })
  return tasks.map((t) => sanitize(t, ctx))
}

function failure(e: unknown): ParseVoiceResult {
  return { ok: false, error: e instanceof GroqError ? e.message : 'Error al procesar con la IA.' }
}

// Transcribe el audio con Whisper y lo convierte en tareas propuestas (sin crearlas).
export async function voiceFromAudio(
  audio: ArrayBuffer,
  mimeType: string,
  project: string | null = null
): Promise<ParseVoiceResult> {
  const key = getGroqKey()
  if (!key) return { ok: false, error: 'No hay API key de Groq configurada.' }
  try {
    const buffer = Buffer.from(audio)
    if (buffer.length < 1000) return { ok: false, error: 'La grabación es demasiado corta.' }
    const transcript = await transcribeAudio(key, buffer, filenameFor(mimeType))
    if (!transcript) return { ok: false, error: 'No se entendió el audio. Probá de nuevo.' }
    const tasks = await structure(key, transcript, project)
    if (tasks.length === 0) {
      return { ok: false, error: 'No pude extraer tareas de lo dictado.', transcript }
    }
    return { ok: true, tasks, transcript }
  } catch (e) {
    return failure(e)
  }
}

// Texto escrito en "Nueva tarea" → tareas con sus columnas llenas (sin crearlas).
export async function tasksFromText(text: string, project: string | null = null): Promise<ParseVoiceResult> {
  const key = getGroqKey()
  if (!key) return { ok: false, error: 'No hay API key de Groq configurada.' }
  const clean = text.trim()
  if (!clean) return { ok: false, error: 'Escribe la tarea.' }
  try {
    const tasks = await structure(key, clean, project)
    if (tasks.length === 0) return { ok: false, error: 'La IA no encontró ninguna tarea en el texto.', transcript: clean }
    return { ok: true, tasks, transcript: clean }
  } catch (e) {
    return failure(e)
  }
}
