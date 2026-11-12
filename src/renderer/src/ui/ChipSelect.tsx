import { useState } from 'react'
import { chipClass, dotClass } from './colors'
import { Popover } from './Popover'
import { Chip, OptionMenu, type OptionManager } from './OptionMenu'

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
  manage?: OptionManager // permite crear/editar/eliminar opciones (columnas de Notion)
}

const Caret = (): JSX.Element => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 opacity-70" fill="currentColor">
    <path d="M7 10l5 5 5-5z" />
  </svg>
)

// Selector en forma de chip de color con menú flotante redondeado (estilo Google).
// El menú usa position: fixed para no quedar recortado dentro de tablas con scroll.
export function ChipSelect({
  value,
  options,
  onChange,
  allowEmpty = false,
  placeholder = '—',
  full = false,
  manage
}: Props): JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const current = options.find((o) => o.value === value)
  const list = current || !value ? options : [{ value, label: value }, ...options]

  const pick = (v: string | null): void => {
    setAnchor(null)
    if (v !== value) onChange(v)
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setAnchor(anchor ? null : e.currentTarget)
        }}
        className={`inline-flex h-7 max-w-full items-center gap-1.5 rounded-full pl-2.5 pr-2 text-xs font-medium transition-shadow hover:shadow-elev-1 ${
          current ? chipClass(current.color) : 'border border-dashed border-line-strong text-ink-2'
        } ${full ? 'w-full justify-between' : ''}`}
      >
        {current && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(current.color)}`} />}
        <span className="truncate">{current?.label ?? value ?? placeholder}</span>
        <Caret />
      </button>

      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={manage ? 264 : 224}>
          <OptionMenu
            options={list}
            selected={value ? [value] : []}
            allowEmpty={allowEmpty}
            onPick={pick}
            manage={manage}
          />
        </Popover>
      )}
    </>
  )
}

// Selección múltiple (multi_select de Notion): chips seleccionados + menú con casillas.
export function MultiChipSelect({
  value,
  options,
  onChange,
  placeholder = '—',
  manage
}: {
  value: string[]
  options: ChipOption[]
  onChange: (value: string[]) => void
  placeholder?: string
  manage?: OptionManager
}): JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const extra = value.filter((v) => !options.some((o) => o.value === v)).map((v) => ({ value: v, label: v }))
  const list = [...options, ...extra]
  const colorOf = (v: string): string | undefined => options.find((o) => o.value === v)?.color

  const toggle = (v: string | null): void => {
    if (!v) return
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setAnchor(anchor ? null : e.currentTarget)
        }}
        className={`flex min-h-7 max-w-full flex-wrap items-center gap-1 rounded-2xl text-left text-xs transition-colors ${
          value.length ? 'p-0.5 hover:bg-ink/5' : 'h-7 border border-dashed border-line-strong px-2.5 text-ink-2'
        }`}
      >
        {value.length ? value.map((v) => <Chip key={v} label={v} color={colorOf(v)} />) : placeholder}
        {!value.length && <Caret />}
      </button>

      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={manage ? 264 : 224}>
          <OptionMenu options={list} selected={value} multiple onPick={toggle} manage={manage} />
        </Popover>
      )}
    </>
  )
}
