import { useState } from 'react'
import { Popover } from '../ui/Popover'
import { chipClass, dotClass } from '../ui/colors'
import {
  DATE_PRESETS,
  EMPTY_VALUE,
  describeFilter,
  isActive,
  type ColDef,
  type ColFilter,
  type TableView
} from './tableView'

const ICON_FILTER = 'M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z'

// Barra de filtros de la tabla: "+ Filtro", un chip por filtro (editable) y el orden actual.
export function FilterBar({
  view,
  cols,
  onChange
}: {
  view: TableView
  cols: ColDef[]
  onChange: (v: TableView) => void
}): JSX.Element {
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null)
  const [editing, setEditing] = useState<{ col: string; anchor: HTMLElement } | null>(null)

  const byKey = new Map(cols.map((c) => [c.key, c]))
  const filters = view.filters.filter((f) => byKey.has(f.col))
  const sortCol = view.sort ? byKey.get(view.sort.col) : undefined
  const available = cols.filter((c) => !filters.some((f) => f.col === c.key))

  const setFilter = (f: ColFilter): void =>
    onChange({ ...view, filters: view.filters.map((x) => (x.col === f.col ? f : x)) })
  const removeFilter = (col: string): void =>
    onChange({ ...view, filters: view.filters.filter((x) => x.col !== col) })

  const hasAnything = filters.length > 0 || !!sortCol

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={(e) => setAddAnchor(e.currentTarget)}
        className="chip"
        title="Filtrar la tabla por una columna"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d={ICON_FILTER} />
        </svg>
        Filtro
      </button>

      {filters.map((f) => {
        const col = byKey.get(f.col)!
        const active = isActive(f)
        return (
          <span
            key={f.col}
            className={`inline-flex h-8 items-center rounded-full text-[13px] ${
              active ? 'bg-primary-soft text-on-primary-soft' : 'border border-dashed border-line-strong text-ink-2'
            }`}
          >
            <button
              onClick={(e) => setEditing({ col: f.col, anchor: e.currentTarget })}
              className="flex h-full max-w-[280px] items-center gap-1 truncate pl-3.5 pr-1"
            >
              <span className="font-medium">{col.label}:</span>
              <span className="truncate">{describeFilter(f, col)}</span>
            </button>
            <button
              onClick={() => removeFilter(f.col)}
              aria-label={`Quitar filtro ${col.label}`}
              className="mr-1 flex h-6 w-6 items-center justify-center rounded-full hover:bg-ink/10"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        )
      })}

      {sortCol && view.sort && (
        <span className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-2 pl-3 pr-1 text-[13px] text-ink-2">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z" />
          </svg>
          {sortCol.label} {view.sort.dir === 'asc' ? '↑' : '↓'}
          <button
            onClick={() => onChange({ ...view, sort: null })}
            aria-label="Quitar orden"
            className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-ink/10"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      )}

      {hasAnything && (
        <button onClick={() => onChange({ filters: [], sort: null })} className="btn btn-sm btn-text">
          Limpiar
        </button>
      )}

      {/* Elegir columna para un filtro nuevo */}
      {addAnchor && (
        <Popover anchor={addAnchor} onClose={() => setAddAnchor(null)} width={240}>
          <p className="px-3 pb-1 pt-1 text-xs font-medium text-ink-2">Filtrar por</p>
          {available.map((c) => (
            <button
              key={c.key}
              onClick={() => {
                const anchor = addAnchor
                setAddAnchor(null)
                onChange({ ...view, filters: [...view.filters, { col: c.key }] })
                // Abrir el editor del filtro recién creado
                setTimeout(() => setEditing({ col: c.key, anchor }), 0)
              }}
              className="flex h-10 w-full items-center rounded-xl px-3 text-left text-sm hover:bg-ink/5"
            >
              {c.label}
            </button>
          ))}
          {available.length === 0 && <p className="px-3 py-2 text-xs text-ink-2">Ya filtrás por todas las columnas.</p>}
        </Popover>
      )}

      {/* Editor del filtro */}
      {editing && byKey.get(editing.col) && (
        <Popover anchor={editing.anchor} onClose={() => setEditing(null)}>
          <FilterEditor
            col={byKey.get(editing.col)!}
            filter={view.filters.find((f) => f.col === editing.col) ?? { col: editing.col }}
            onChange={setFilter}
          />
        </Popover>
      )}
    </div>
  )
}

function FilterEditor({
  col,
  filter,
  onChange
}: {
  col: ColDef
  filter: ColFilter
  onChange: (f: ColFilter) => void
}): JSX.Element {
  const title = <p className="px-3 pb-1.5 pt-1 text-xs font-medium text-ink-2">{col.label}</p>

  if (col.kind === 'options') {
    const values = filter.values ?? []
    const toggle = (v: string): void =>
      onChange({ ...filter, values: values.includes(v) ? values.filter((x) => x !== v) : [...values, v] })
    const opts = [...(col.options ?? []), { value: EMPTY_VALUE, label: 'Vacío', color: 'default' }]
    return (
      <>
        {title}
        {opts.map((o) => {
          const on = values.includes(o.value)
          return (
            <button
              key={o.value}
              onClick={() => toggle(o.value)}
              className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-ink/5"
            >
              <span
                className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border-2 ${
                  on ? 'border-primary bg-primary text-on-primary' : 'border-ink-2'
                }`}
              >
                {on && (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3.5">
                    <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              {o.value === EMPTY_VALUE ? (
                <span className="text-sm text-ink-2">Vacío</span>
              ) : (
                <span
                  className={`inline-flex h-6 max-w-full items-center gap-1.5 truncate rounded-full px-2.5 text-xs font-medium ${chipClass(o.color)}`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(o.color)}`} />
                  {o.label}
                </span>
              )}
            </button>
          )
        })}
      </>
    )
  }

  if (col.kind === 'date') {
    return (
      <>
        {title}
        {DATE_PRESETS.map((d) => (
          <button
            key={d.value}
            onClick={() => onChange({ ...filter, date: filter.date === d.value ? undefined : d.value })}
            className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm hover:bg-ink/5"
          >
            <span
              className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${
                filter.date === d.value ? 'border-primary' : 'border-ink-2'
              }`}
            >
              {filter.date === d.value && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            {d.label}
          </button>
        ))}
      </>
    )
  }

  if (col.kind === 'checkbox') {
    return (
      <>
        {title}
        <div className="flex gap-2 px-2 pb-1">
          {[
            { v: true, l: 'Sí' },
            { v: false, l: 'No' }
          ].map((o) => (
            <button
              key={o.l}
              onClick={() => onChange({ ...filter, bool: filter.bool === o.v ? undefined : o.v })}
              className={`chip flex-1 justify-center ${filter.bool === o.v ? 'chip-on' : ''}`}
            >
              {o.l}
            </button>
          ))}
        </div>
      </>
    )
  }

  return (
    <>
      {title}
      <div className="px-2 pb-1">
        <input
          autoFocus
          value={filter.text ?? ''}
          onChange={(e) => onChange({ ...filter, text: e.target.value })}
          placeholder="Contiene…"
          className="field"
        />
      </div>
    </>
  )
}
