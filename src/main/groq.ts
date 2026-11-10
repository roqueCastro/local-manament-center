import type { VoiceTask } from '../shared/types'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'llama-3.3-70b-versatile'
const WHISPER_MODEL = 'whisper-large-v3-turbo'

export class GroqError extends Error {}

// Transcribe audio (webm/ogg/wav) a texto usando Whisper en Groq.
export async function transcribeAudio(
  apiKey: string,
  audio: Buffer,
  filename: string
): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(audio)]), filename)
  form.append('model', WHISPER_MODEL)
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
    throw new GroqError(`Error al transcribir (${res.status}): ${msg}`)
  }
  const data = await res.json()
  return (data?.text ?? '').trim()
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
    '- due_date: fecha ISO "YYYY-MM-DD" o null. Interpretá fechas relativas respecto a HOY = ' +
      today +
      '. "mañana" = HOY+1, "pasado mañana" = HOY+2, nombres de días = la próxima ocurrencia.',
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
  context: { today: string; projects: string[] }
): Promise<VoiceTask[]> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt(context.today, context.projects) },
        { role: 'user', content: text }
      ]
    })
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const msg = data?.error?.message ?? res.statusText
    if (res.status === 401) throw new GroqError('API key de Groq inválida (401).')
    throw new GroqError(`Error de Groq (${res.status}): ${msg}`)
  }

  const data = await res.json()
  const content: string = data?.choices?.[0]?.message?.content ?? '{}'
  let parsed: any
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new GroqError('La IA devolvió una respuesta no válida.')
  }
  const rawTasks: any[] = Array.isArray(parsed?.tasks) ? parsed.tasks : []
  return rawTasks
    .map((t) => normalizeTask(t, context.projects))
    .filter((t): t is VoiceTask => t !== null)
}
