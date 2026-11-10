import { useRef, useState } from 'react'
import { useTasks } from '../store'
import type { NewTaskInput } from '../../../shared/types'
import { VoiceButton } from './VoiceButton'

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
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit(): Promise<void> {
    const parsed = parseQuickInput(value)
    if (!parsed) return
    await add(parsed)
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 p-3">
      <div className="flex items-center gap-2">
        <VoiceButton />
        <input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') window.api.hidePanel()
          }}
          placeholder="Nueva tarea…  (#etiqueta  ! prioridad)"
          className="flex-1 rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm
                     text-gray-900 dark:text-gray-100 placeholder-gray-400
                     outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={submit}
          className="shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3 py-2
                     text-sm font-medium text-white transition-colors"
        >
          Añadir
        </button>
      </div>
    </div>
  )
}
