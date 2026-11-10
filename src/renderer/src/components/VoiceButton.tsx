import { useRef, useState } from 'react'
import { useTasks } from '../store'

export function VoiceButton(): JSX.Element {
  const ai = useTasks((s) => s.ai)
  const processVoiceAudio = useTasks((s) => s.processVoiceAudio)
  const setView = useTasks((s) => s.setView)
  const voiceState = useTasks((s) => s.voiceState)

  const [listening, setListening] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'

  async function start(): Promise<void> {
    if (!ai?.hasKey) {
      // Sin API key no se puede transcribir: llevar a Ajustes
      setView('settings')
      return
    }
    if (!supported) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e): void => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async (): Promise<void> => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const buf = await blob.arrayBuffer()
        void processVoiceAudio(buf, blob.type)
      }
      recorderRef.current = recorder
      recorder.start()
      setListening(true)
      // Evitar que el panel se oculte mientras grabamos
      window.api.setPinned?.(true)
    } catch {
      // permiso denegado o sin micrófono
      setListening(false)
    }
  }

  function stop(): void {
    recorderRef.current?.stop()
    setListening(false)
  }

  const busy = voiceState === 'processing'
  const disabled = busy || !supported

  return (
    <button
      onClick={() => (listening ? stop() : void start())}
      disabled={disabled}
      title={
        !supported
          ? 'Tu sistema no soporta grabación de audio'
          : !ai?.hasKey
            ? 'Configurá tu API key de Groq en Ajustes'
            : listening
              ? 'Detener y procesar'
              : 'Dictar tareas por voz'
      }
      className={`shrink-0 flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
        listening
          ? 'bg-red-500 text-white animate-pulse'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40'
      }`}
    >
      {busy ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 11-6.2-8.5" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
          <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" strokeLinecap="round" />
        </svg>
      )}
    </button>
  )
}
