import { useState } from 'react'
import { moveColumn } from './tableView'

// Orden y visibilidad de las columnas de la tabla del gestor. Se arrastran las filas
// (o se usan las flechas) para cambiar la posición; el ojo oculta/muestra la columna.

export interface ColumnItem {
  key: string
  label: string
  lockedVisible?: boolean // no se puede ocultar (ej. el título de la tarea)
}

export function ColumnsPanel({
  items,
  hidden,
  customized,
  onChange,
  onReset
}: {
  items: ColumnItem[] // en el orden actual, incluidas las ocultas
  hidden: string[]
  customized: boolean // hay orden u ocultas guardadas (habilita "Restablecer")
  onChange: (order: string[], hidden: string[]) => void
  onReset: () => void
}): JSX.Element {
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const keys = items.map((c) => c.key)

  const move = (key: string, d: -1 | 1): void => {
    const i = keys.indexOf(key)
    const target = keys[i + d]
    if (target) onChange(moveColumn(keys, key, target), hidden)
  }
  const toggleHidden = (key: string): void =>
    onChange(keys, hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key])

  return (
    <div className="p-1">
      <p className="px-2 pb-2 text-xs text-ink-2">
        Arrastra para cambiar el orden. La primera queda a la izquierda.
      </p>
      <div className="scroll-thin max-h-[420px] overflow-y-auto">
        {items.map((c, i) => {
          const off = hidden.includes(c.key)
          const isOver = overKey === c.key && dragKey !== null && dragKey !== c.key
          const fromAbove = dragKey !== null && keys.indexOf(dragKey) < i
          return (
            <div
              key={c.key}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', c.key)
                setDragKey(c.key)
              }}
              onDragOver={(e) => {
                if (!dragKey) return
                e.preventDefault()
                setOverKey(c.key)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragKey) onChange(moveColumn(keys, dragKey, c.key), hidden)
                setDragKey(null)
                setOverKey(null)
              }}
              onDragEnd={() => {
                setDragKey(null)
                setOverKey(null)
              }}
              className={`flex h-10 cursor-grab items-center gap-1.5 rounded-xl border-y-2 border-transparent px-1.5 hover:bg-ink/[0.04] active:cursor-grabbing ${
                dragKey === c.key ? 'opacity-40' : ''
              } ${isOver ? (fromAbove ? 'border-b-primary' : 'border-t-primary') : ''}`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-2/70" fill="currentColor">
                <path d="M9 4a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zM9 10a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zm-6 6a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4z" />
              </svg>
              <span className="w-5 shrink-0 text-center text-xs font-medium text-ink-2">{i + 1}</span>
              <span className={`min-w-0 flex-1 truncate text-sm ${off ? 'text-ink-2/60 line-through' : ''}`}>
                {c.label}
              </span>
              <button
                onClick={() => move(c.key, -1)}
                disabled={i === 0}
                aria-label="Mover a la izquierda"
                title="Mover a la izquierda"
                className="icon-btn h-7 w-7 disabled:opacity-30"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                  <path d="M7 14l5-5 5 5z" />
                </svg>
              </button>
              <button
                onClick={() => move(c.key, 1)}
                disabled={i === items.length - 1}
                aria-label="Mover a la derecha"
                title="Mover a la derecha"
                className="icon-btn h-7 w-7 disabled:opacity-30"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                  <path d="M7 10l5 5 5-5z" />
                </svg>
              </button>
              <button
                onClick={() => toggleHidden(c.key)}
                disabled={c.lockedVisible}
                aria-label={off ? 'Mostrar columna' : 'Ocultar columna'}
                title={c.lockedVisible ? 'Esta columna siempre se muestra' : off ? 'Mostrar columna' : 'Ocultar columna'}
                className={`icon-btn h-7 w-7 disabled:opacity-30 ${off ? 'text-ink-2/60' : ''}`}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                  {off ? (
                    <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92A11.8 11.8 0 0022.99 12c-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55A2.8 2.8 0 009 12a3 3 0 003 3c.22 0 .44-.03.65-.08l1.55 1.55A5 5 0 017 12c0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16a3 3 0 00-3-3l-.17.01z" />
                  ) : (
                    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z" />
                  )}
                </svg>
              </button>
            </div>
          )
        })}
      </div>
      <div className="flex justify-end px-1 pt-1.5">
        <button onClick={onReset} disabled={!customized} className="btn btn-sm btn-text disabled:opacity-40">
          Restablecer
        </button>
      </div>
    </div>
  )
}
