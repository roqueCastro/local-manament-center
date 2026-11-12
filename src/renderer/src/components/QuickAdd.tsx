import { useRef, useState } from 'react'
import { useTasks } from '../store'
import type { NewTaskInput } from '../../../shared/types'
import { VoiceButton } from './VoiceButton'
import { AiToggle, useAiText } from './AiToggle'

// Parseo rápido: extrae #etiquetas y prioridad con "!" (!, !!, !!!) del texto.
export function parseQuickInput(raw: string): NewTaskInput | null {
  const tags: string[] = []
  let priority = 0

  let text = raw.replace(/#([\p{L}\p{N}_-]+)/gu, (_m, tag: string) => {
    tags.push(tag.toLowerCase())
    return ''
  })

  const bangMatch = text.match(/(!{1,3})(?=\s|$)/)
  if (bangMatch) {
    priority = bangMatch[1].length
    text = text.replace(bangMatch[1], '')
  }

  const title = text.replace(/\s+/g, ' ').trim()
  if (!title) return null
  return { title, tags, priority }
}

export function QuickAdd(): JSX.Element {
  const add = useTasks((s) => s.add)
  const processText = useTasks((s) => s.processText)
  const activeProject = useTasks((s) => s.activeProject)
  const aiText = useAiText()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit(): Promise<void> {
    // Con IA: reparte el texto en las columnas del proyecto y muestra la revisión
    if (aiText.on) {
      if (!value.trim()) return
      void processText(value, activeProject || null)
      setValue('')
      return
    }
    const parsed = parseQuickInput(value)
    if (!parsed) return
    await add(parsed)
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <div className="px-3 pb-3 pt-2">
      <div className="flex items-center gap-2">
        <VoiceButton />
        {aiText.available && <AiToggle on={aiText.on} onToggle={aiText.toggle} />}
        <input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') window.api.hidePanel()
          }}
          placeholder={
            aiText.on ? 'Tarea con sus datos (cliente, plan…)' : 'Nueva tarea…  (#etiqueta  ! prioridad)'
          }
          className="pill-input"
        />
        <button
          onClick={submit}
          aria-label="Añadir"
          title="Añadir"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-on-primary shadow-elev-1 transition-all hover:shadow-elev-2"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
