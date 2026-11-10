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
      type="button"
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
      className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all disabled:opacity-40 ${
        listening
          ? 'bg-[#d93025] text-white shadow-elev-2'
          : 'bg-primary-soft text-on-primary-soft hover:shadow-elev-1'
      }`}
    >
      {/* Anillo pulsante mientras graba (como el micrófono de Google) */}
      {listening && (
        <span className="absolute inset-0 animate-ping rounded-full bg-[#d93025]/40" />
      )}
      {busy ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5 animate-spin" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M21 12a9 9 0 11-6.2-8.5" strokeLinecap="round" />
        </svg>
      ) : listening ? (
        <svg viewBox="0 0 24 24" className="relative h-5 w-5" fill="currentColor">
          <rect x="7" y="7" width="10" height="10" rx="2" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
          <path d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z" />
        </svg>
      )}
    </button>
  )
}
