import type { VoiceTask } from '../shared/types'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models'

// Groq retira modelos con el tiempo y no todas las cuentas tienen acceso a todos.
// En vez de un modelo fijo, se elige el primero de esta lista que la cuenta tenga disponible.
const PREFERRED_CHAT_MODELS = [
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'qwen/qwen3-32b',
  'openai/gpt-oss-20b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.1-8b-instant'
]
const PREFERRED_STT_MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3']
const MODELS_TTL_MS = 6 * 60 * 60 * 1000

export class GroqError extends Error {}

let modelCache: { key: string; chat: string; stt: string; at: number } | null = null

async function listModels(apiKey: string): Promise<string[]> {
  const res = await fetch(GROQ_MODELS_URL, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (res.status === 401) throw new GroqError('API key de Groq inválida (401).')
  if (!res.ok) throw new GroqError(`No se pudo consultar los modelos de Groq (${res.status}).`)
  const data = await res.json()
  return ((data?.data ?? []) as any[]).filter((m) => m.active !== false).map((m) => String(m.id))
}

// Modelos a usar con esta key (chat para estructurar tareas y Whisper para transcribir).
async function pickModels(apiKey: string, force = false): Promise<{ chat: string; stt: string }> {
  if (!force && modelCache && modelCache.key === apiKey && Date.now() - modelCache.at < MODELS_TTL_MS) {
    return modelCache
  }
  const ids = await listModels(apiKey)
  const chat =
    PREFERRED_CHAT_MODELS.find((m) => ids.includes(m)) ??
    // Cualquier otro modelo de chat (descarta audio, voz y moderación)
    ids.find(
      (m) =>
        /gpt|llama|qwen|mixtral|gemma|kimi|deepseek|mistral/i.test(m) &&
        !/whisper|guard|tts|orpheus|playai|safeguard/i.test(m)
    )
  const stt = PREFERRED_STT_MODELS.find((m) => ids.includes(m)) ?? ids.find((m) => /whisper/i.test(m))
  if (!chat) throw new GroqError('Tu cuenta de Groq no tiene ningún modelo de chat disponible.')
  if (!stt) throw new GroqError('Tu cuenta de Groq no tiene ningún modelo Whisper disponible.')
  modelCache = { key: apiKey, chat, stt, at: Date.now() }
  return modelCache
}

// ¿El error indica que el modelo no existe, fue retirado o no hay acceso?
function isModelUnavailable(status: number, message: string): boolean {
  return (
    status === 404 ||
    /model.*(not exist|does not exist|not found|decommission|deprecat|access)|model_not_found|model_decommissioned/i.test(
      message
    )
  )
}

// Extrae el JSON de la respuesta aunque venga envuelto en ```json … ``` o con texto alrededor.
function extractJson(content: string): any {
  const clean = content.replace(/```(?:json)?/gi, '').trim()
  try {
    return JSON.parse(clean)
  } catch {
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1))
    throw new Error('sin JSON')
  }
}

// Transcribe audio (webm/ogg/wav) a texto usando Whisper en Groq.
export async function transcribeAudio(
  apiKey: string,
  audio: Buffer,
  filename: string,
  retried = false
): Promise<string> {
  const { stt } = await pickModels(apiKey, retried)
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(audio)]), filename)
  form.append('model', stt)
  form.append('language', 'es')
  form.append('response_format', 'json')

  const res = await fetch(GROQ_TRANSCRIBE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` }, // sin Content-Type: FormData pone el boundary
    body: form
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const msg = data?.error?.message ?? res.statusText
    if (res.status === 401) throw new GroqError('API key de Groq inválida (401).')
    // Modelo retirado o sin acceso: volver a elegir modelo y reintentar una vez
    if (!retried && isModelUnavailable(res.status, msg)) {
      return transcribeAudio(apiKey, audio, filename, true)
    }
    throw new GroqError(`Error al transcribir (${res.status}): ${msg}`)
  }
  const data = await res.json()
  return (data?.text ?? '').trim()
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

// Calendario de HOY y los próximos 14 días con su nombre: los modelos calculan mal
// los días de la semana por su cuenta ("el viernes" → fecha equivocada).
function calendarFrom(today: string): string {
  const [y, m, d] = today.split('-').map(Number)
  const lines: string[] = []
  for (let i = 0; i <= 14; i++) {
    const dt = new Date(y, m - 1, d + i)
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    const tag = i === 0 ? ' (HOY)' : i === 1 ? ' (mañana)' : i === 2 ? ' (pasado mañana)' : ''
    lines.push(`${WEEKDAYS[dt.getDay()]} ${iso}${tag}`)
  }
  return lines.join('\n')
}

function buildSystemPrompt(today: string, projects: string[]): string {
  const projectList =
    projects.length > 0
      ? `Proyectos disponibles (usá EXACTAMENTE uno de estos nombres si el usuario menciona un proyecto): ${projects.join(', ')}.`
      : 'No hay proyectos definidos; dejá project en null.'

  return [
    'Sos un asistente que convierte lo que dicta el usuario (en español) en una lista de tareas estructuradas.',
    'Respondé ÚNICAMENTE con un JSON válido con esta forma exacta:',
    '{ "tasks": [ { "title": string, "due_date": string|null, "priority": number, "tags": string[], "project": string|null } ] }',
    'Reglas:',
    '- title: breve e imperativo, en español, sin la fecha ni la prioridad dentro del texto.',
    '- due_date: fecha ISO "YYYY-MM-DD" o null. Usá SIEMPRE este calendario para fechas relativas ' +
      '("mañana", "el viernes", "el lunes"…). Un nombre de día = su próxima ocurrencia DESPUÉS de hoy:\n' +
      calendarFrom(today),
    '- priority: 0 normal, 1 baja, 2 media, 3 alta/urgente. Si dice "urgente"/"importante" => 3.',
    '- tags: etiquetas cortas en minúscula si las menciona (ej. "casa", "trabajo"); si no, [].',
    '- project: ' + projectList,
    '- Si dicta varias tareas (separadas por "y", comas, etc.), devolvé una por cada una.',
    'No agregues texto fuera del JSON.'
  ].join('\n')
}

function normalizeTask(raw: any, projects: string[]): VoiceTask | null {
  if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) return null
  const priority = Math.max(0, Math.min(3, Math.round(Number(raw.priority) || 0)))
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((t: unknown) => typeof t === 'string').map((t: string) => t.toLowerCase())
    : []
  let project: string | null = typeof raw.project === 'string' ? raw.project : null
  // Validar que el proyecto exista en la lista (match case-insensitive)
  if (project) {
    const found = projects.find((p) => p.toLowerCase() === project!.toLowerCase())
    project = found ?? null
  }
  const dueDate =
    typeof raw.due_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw.due_date)
      ? raw.due_date.slice(0, 10)
      : null
  return { title: raw.title.trim(), dueDate, priority, tags, project }
}

export async function parseTasksFromText(
  apiKey: string,
  text: string,
  context: { today: string; projects: string[] },
  attempt: { refreshModels?: boolean; jsonMode?: boolean } = {}
): Promise<VoiceTask[]> {
  const { refreshModels = false, jsonMode = true } = attempt
  const { chat } = await pickModels(apiKey, refreshModels)
  const body: Record<string, unknown> = {
    model: chat,
    temperature: 0.2,
    messages: [
      { role: 'system', content: buildSystemPrompt(context.today, context.projects) },
      { role: 'user', content: text }
    ]
  }
  if (jsonMode) body.response_format = { type: 'json_object' }
  // Modelos de razonamiento (gpt-oss): razonar poco para responder rápido
  if (/gpt-oss/i.test(chat)) body.reasoning_effort = 'low'

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const msg: string = data?.error?.message ?? res.statusText
    if (res.status === 401) throw new GroqError('API key de Groq inválida (401).')
    // Modelo retirado o sin acceso → elegir otro disponible y reintentar
    if (!refreshModels && isModelUnavailable(res.status, msg)) {
      return parseTasksFromText(apiKey, text, context, { refreshModels: true, jsonMode })
    }
    // El modelo no soporta modo JSON → reintentar sin él (el JSON se extrae del texto)
    if (jsonMode && res.status === 400 && /response_format|json/i.test(msg)) {
      return parseTasksFromText(apiKey, text, context, { refreshModels, jsonMode: false })
    }
    throw new GroqError(`Error de Groq (${res.status}): ${msg}`)
  }

  const data = await res.json()
  const content: string = data?.choices?.[0]?.message?.content ?? '{}'
  let parsed: any
  try {
    parsed = extractJson(content)
  } catch {
    throw new GroqError('La IA devolvió una respuesta no válida.')
  }
  const rawTasks: any[] = Array.isArray(parsed?.tasks) ? parsed.tasks : []
  return rawTasks
    .map((t) => normalizeTask(t, context.projects))
    .filter((t): t is VoiceTask => t !== null)
}
