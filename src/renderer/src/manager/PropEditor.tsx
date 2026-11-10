import { useEffect, useState } from 'react'
import type { PropSchema, PropValue } from '../../../shared/types'
import { ChipSelect, type ChipOption } from '../ui/ChipSelect'
import { chipClass } from '../ui/colors'

// Opciones de un select/status de Notion con su color, para ChipSelect.
export function chipOptions(schema: PropSchema | undefined): ChipOption[] {
  return (schema?.options ?? []).map((o) => ({ value: o, label: o, color: schema?.colors?.[o] }))
}

// Formatea un valor de propiedad para mostrarlo en la tabla.
export function formatValue(value: PropValue | undefined, type: string): string {
  if (value === null || value === undefined || value === '') return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? '✓' : ''
  if (type === 'date' || type === 'created_time' || type === 'last_edited_time') {
    return formatDate(String(value))
  }
  return String(value)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  // Fechas sin hora: interpretarlas como locales (evita que "2026-11-10" se vea como el 9)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

const inputCls = 'field'

interface Props {
  schema: PropSchema
  value: PropValue | undefined
  onChange: (value: PropValue) => void
}

// Editor de una propiedad de Notion según su tipo.
export function PropEditor({ schema, value, onChange }: Props): JSX.Element {
  if (!schema.editable) {
    const text = formatValue(value, schema.type)
    return (
      <p className="px-1 py-1.5 text-sm text-ink-2" title="Solo lectura (se edita en Notion)">
        {text || '—'}
      </p>
    )
  }

  switch (schema.type) {
    case 'select':
    case 'status':
      return (
        <ChipSelect
          value={typeof value === 'string' && value ? value : null}
          options={chipOptions(schema)}
          allowEmpty={schema.type === 'select'}
          placeholder="Elegir…"
          onChange={(v) => onChange(v)}
        />
      )
    case 'multi_select':
      return (
        <MultiSelect
          options={schema.options ?? []}
          colors={schema.colors}
          value={value}
          onChange={onChange}
        />
      )
    case 'date': {
      const current = typeof value === 'string' ? value.slice(0, 10) : ''
      return (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={current}
            onChange={(e) => onChange(e.target.value || null)}
            className={inputCls}
          />
          {current && (
            <button
              onClick={() => onChange(null)}
              className="icon-btn h-8 w-8 hover:text-danger"
              title="Quitar fecha"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      )
    }
    case 'checkbox':
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-5 w-5 rounded accent-[rgb(var(--md-primary))]"
        />
      )
    case 'number':
      return (
        <TextField
          value={value === null || value === undefined ? '' : String(value)}
          type="number"
          onCommit={(v) => onChange(v === '' ? null : Number(v))}
        />
      )
    case 'rich_text':
      return (
        <TextField
          value={typeof value === 'string' ? value : ''}
          multiline
          onCommit={(v) => onChange(v)}
        />
      )
    default:
      // title, url, email, phone_number
      return (
        <TextField
          value={typeof value === 'string' ? value : ''}
          type={schema.type === 'email' ? 'email' : schema.type === 'url' ? 'url' : 'text'}
          onCommit={(v) => onChange(v || null)}
        />
      )
  }
}

// Campo de texto con borrador local: guarda al salir o con Enter (Esc descarta).
function TextField({
  value,
  type = 'text',
  multiline = false,
  onCommit
}: {
  value: string
  type?: string
  multiline?: boolean
  onCommit: (v: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const commit = (): void => {
    if (draft !== value) onCommit(draft.trim())
  }

  if (multiline) {
    return (
      <textarea
        value={draft}
        rows={Math.min(5, Math.max(1, draft.split('\n').length))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            ;(e.target as HTMLTextAreaElement).blur()
          }
          if (e.key === 'Escape') setDraft(value)
        }}
        className={`${inputCls} resize-none`}
      />
    )
  }
  return (
    <input
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setDraft(value)
      }}
      className={inputCls}
    />
  )
}

function MultiSelect({
  options,
  colors,
  value,
  onChange
}: {
  options: string[]
  colors?: Record<string, string>
  value: PropValue | undefined
  onChange: (v: PropValue) => void
}): JSX.Element {
  const selected = Array.isArray(value) ? value : []
  const [adding, setAdding] = useState('')
  const all = [...options, ...selected.filter((s) => !options.includes(s))]

  const toggle = (o: string): void =>
    onChange(selected.includes(o) ? selected.filter((s) => s !== o) : [...selected, o])

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {all.map((o) => (
        <button
          key={o}
          onClick={() => toggle(o)}
          className={`inline-flex h-7 items-center gap-1 rounded-full px-3 text-xs font-medium transition-all ${
            selected.includes(o)
              ? chipClass(colors?.[o] ?? 'blue')
              : 'border border-line-strong text-ink-2 hover:bg-ink/5'
          }`}
        >
          {selected.includes(o) && (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {o}
        </button>
      ))}
      <input
        value={adding}
        onChange={(e) => setAdding(e.target.value)}
        onKeyDown={(e) => {
          const v = adding.trim()
          if (e.key === 'Enter' && v) {
            if (!selected.includes(v)) onChange([...selected, v])
            setAdding('')
          }
        }}
        placeholder="+ nueva"
        className="h-7 w-24 rounded-full bg-surface-2 px-3 text-xs outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  )
}
