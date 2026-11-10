import type { AiStatus, ParseVoiceResult } from '../shared/types'
import { getProjects } from './sync'
import { GroqError, parseTasksFromText, transcribeAudio } from './groq'
import {
  clearGroqKey,
  encryptionAvailable,
  getGroqKey,
  hasGroqKey,
  saveGroqKey
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

// Transcribe el audio con Whisper y lo convierte en tareas propuestas (sin crearlas).
export async function voiceFromAudio(
  audio: ArrayBuffer,
  mimeType: string
): Promise<ParseVoiceResult> {
  const key = getGroqKey()
  if (!key) return { ok: false, error: 'No hay API key de Groq configurada.' }
  try {
    const buffer = Buffer.from(audio)
    if (buffer.length < 1000) return { ok: false, error: 'La grabación es demasiado corta.' }
    const transcript = await transcribeAudio(key, buffer, filenameFor(mimeType))
    if (!transcript) return { ok: false, error: 'No se entendió el audio. Probá de nuevo.' }
    // Fecha local (toISOString daría mañana por la noche, al estar en UTC)
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const tasks = await parseTasksFromText(key, transcript, {
      today,
      projects: getProjects()
    })
    if (tasks.length === 0) {
      return { ok: false, error: 'No pude extraer tareas de lo dictado.', transcript }
    }
    return { ok: true, tasks, transcript }
  } catch (e) {
    return { ok: false, error: e instanceof GroqError ? e.message : 'Error al procesar con la IA.' }
  }
}
