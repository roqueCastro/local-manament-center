import { useEffect, useState } from 'react'
import { useTasks } from '../store'

// Preferencia "procesar con IA el texto de nueva tarea", compartida entre el panel rápido y
// el gestor (settings.json → ui.manager.aiText). Se relee al enfocar la ventana para que un
// cambio en una ventana se refleje en la otra. `on` solo es true si hay key de Groq.
export function useAiText(): { available: boolean; on: boolean; toggle: () => void } {
  const ai = useTasks((s) => s.ai)
  const [pref, setPref] = useState(true)

  useEffect(() => {
    const read = (): void => {
      void window.api.managerPrefs.get().then((p) => setPref(p.aiText !== false))
    }
    read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [])

  const available = !!ai?.hasKey
  return {
    available,
    on: available && pref,
    toggle: () => {
      setPref(!pref)
      window.api.managerPrefs.set({ aiText: !pref })
    }
  }
}

export function AiToggle({ on, onToggle }: { on: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={
        on
          ? 'IA activada: la IA reparte lo que escribas en las columnas del proyecto (clic para desactivar)'
          : 'IA desactivada: el texto se guarda tal cual como título (clic para activar)'
      }
      aria-pressed={on}
      className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors ${
        on ? 'bg-primary-soft text-on-primary-soft' : 'text-ink-2 hover:bg-ink/5'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z" />
      </svg>
      IA
    </button>
  )
}
