import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { chipClass, dotClass } from './colors'

export interface ChipOption {
  value: string
  label: string
  color?: string
}

interface Props {
  value: string | null
  options: ChipOption[]
  onChange: (value: string | null) => void
  allowEmpty?: boolean // ofrece "Ninguno"
  placeholder?: string
  full?: boolean // ocupa todo el ancho (en formularios)
}

// Selector en forma de chip de color con menú flotante redondeado (estilo Google).
// El menú usa position: fixed para no quedar recortado dentro de tablas con scroll.
export function ChipSelect({
  value,
  options,
  onChange,
  allowEmpty = false,
  placeholder = '—',
  full = false
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean }>({
    left: 0,
    top: 0,
    up: false
  })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const current = options.find((o) => o.value === value)
  const list = current || !value ? options : [{ value, label: value }, ...options]

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const menuH = Math.min(320, (list.length + (allowEmpty ? 1 : 0)) * 40 + 16)
    const up = r.bottom + menuH + 8 > window.innerHeight && r.top > menuH
    setPos({
      left: Math.min(r.left, window.innerWidth - 232),
      top: up ? r.top - menuH - 4 : r.bottom + 4,
      up
    })
  }, [open, list.length, allowEmpty])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onScroll = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onScroll)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onScroll)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const pick = (v: string | null): void => {
    setOpen(false)
    if (v !== value) onChange(v)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className={`inline-flex h-7 max-w-full items-center gap-1.5 rounded-full pl-2.5 pr-2 text-xs font-medium transition-shadow hover:shadow-elev-1 ${
          current ? chipClass(current.color) : 'border border-dashed border-line-strong text-ink-2'
        } ${full ? 'w-full justify-between' : ''}`}
      >
        {current && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(current.color)}`} />}
        <span className="truncate">{current?.label ?? value ?? placeholder}</span>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 opacity-70" fill="currentColor">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{ left: pos.left, top: pos.top }}
          className="scroll-thin fixed z-50 max-h-80 w-56 overflow-y-auto rounded-2xl bg-surface-1 p-2 shadow-elev-3"
        >
          {allowEmpty && (
            <MenuItem selected={!value} onClick={() => pick(null)}>
              <span className="px-1 text-xs text-ink-2">Ninguno</span>
            </MenuItem>
          )}
          {list.map((o) => (
            <MenuItem key={o.value} selected={o.value === value} onClick={() => pick(o.value)}>
              <span
                className={`inline-flex h-6 max-w-full items-center gap-1.5 truncate rounded-full px-2.5 text-xs font-medium ${chipClass(o.color)}`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(o.color)}`} />
                {o.label}
              </span>
            </MenuItem>
          ))}
        </div>
      )}
    </>
  )
}

function MenuItem({
  selected,
  onClick,
  children
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-10 w-full items-center justify-between gap-2 rounded-xl px-2 text-left transition-colors ${
        selected ? 'bg-primary-soft/60' : 'hover:bg-ink/5'
      }`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {selected && (
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
