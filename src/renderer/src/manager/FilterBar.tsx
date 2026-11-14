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
  type SortRule,
  type TableView
} from './tableView'
import { ChipSelect } from '../ui/ChipSelect'

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
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null)

  const byKey = new Map(cols.map((c) => [c.key, c]))
  const filters = view.filters.filter((f) => byKey.has(f.col))
  const sorts = view.sorts.filter((r) => byKey.has(r.col))
  const available = cols.filter((c) => !filters.some((f) => f.col === c.key))

  const setFilter = (f: ColFilter): void =>
    onChange({ ...view, filters: view.filters.map((x) => (x.col === f.col ? f : x)) })
  const removeFilter = (col: string): void =>
    onChange({ ...view, filters: view.filters.filter((x) => x.col !== col) })

  const hasAnything = filters.length > 0 || sorts.length > 0

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

      {sorts.length > 0 && (
        <span className="inline-flex h-8 items-center rounded-full bg-surface-2 text-[13px] text-ink-2">
          <button
            onClick={(e) => setSortAnchor(e.currentTarget)}
            title="Editar el orden (varias columnas)"
            className="flex h-full max-w-[360px] items-center gap-1.5 truncate pl-3 pr-1"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor">
              <path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z" />
            </svg>
            <span className="truncate">
              {sorts.map((r) => `${byKey.get(r.col)!.label} ${r.dir === 'asc' ? '↑' : '↓'}`).join(' · ')}
            </span>
          </button>
          <button
            onClick={() => onChange({ ...view, sorts: [] })}
            aria-label="Quitar orden"
            className="mr-1 flex h-6 w-6 items-center justify-center rounded-full hover:bg-ink/10"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      )}
      {sorts.length === 0 && (
        <button onClick={(e) => setSortAnchor(e.currentTarget)} className="chip" title="Ordenar por una o varias columnas">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z" />
          </svg>
          Ordenar
        </button>
      )}

      {hasAnything && (
        <button onClick={() => onChange({ ...view, filters: [], sorts: [] })} className="btn btn-sm btn-text">
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

      {/* Editor del orden (varios niveles) */}
      {sortAnchor && (
        <Popover anchor={sortAnchor} onClose={() => setSortAnchor(null)} width={460}>
          <SortEditor sorts={sorts} cols={cols} onChange={(next) => onChange({ ...view, sorts: next })} />
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

const ARROW = 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z'

// Orden por varias columnas: la primera manda y las siguientes desempatan.
function SortEditor({
  sorts,
  cols,
  onChange
}: {
  sorts: SortRule[]
  cols: ColDef[]
  onChange: (s: SortRule[]) => void
}): JSX.Element {
  const unused = cols.filter((c) => !sorts.some((r) => r.col === c.key))
  const set = (i: number, r: SortRule): void => onChange(sorts.map((x, k) => (k === i ? r : x)))
  const move = (i: number, d: -1 | 1): void => {
    const next = sorts.slice()
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    onChange(next)
  }
  const options = (current: string): { value: string; label: string; color: string }[] =>
    cols
      .filter((c) => c.key === current || !sorts.some((r) => r.col === c.key))
      .map((c) => ({ value: c.key, label: c.label, color: 'default' }))

  return (
    <div className="p-1">
      <p className="px-2 pb-2 text-xs text-ink-2">
        Ordenar por… (el primero manda; los siguientes desempatan)
      </p>
      {sorts.length === 0 && <p className="px-2 pb-2 text-sm text-ink-2">Sin orden.</p>}
      {sorts.map((r, i) => (
        <div key={r.col} className="flex items-center gap-1.5 rounded-xl px-1 py-1 hover:bg-ink/[0.03]">
          <span className="w-5 shrink-0 text-center text-xs font-medium text-ink-2">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <ChipSelect
              value={r.col}
              options={options(r.col)}
              onChange={(v) => v && set(i, { ...r, col: v })}
            />
          </div>
          <button
            onClick={() => set(i, { ...r, dir: r.dir === 'asc' ? 'desc' : 'asc' })}
            title="Cambiar dirección"
            className="chip h-7 shrink-0 px-2.5 text-xs"
          >
            <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${r.dir === 'desc' ? 'rotate-180' : ''}`} fill="currentColor">
              <path d={ARROW} />
            </svg>
            {r.dir === 'asc' ? 'Ascendente' : 'Descendente'}
          </button>
          <button
            onClick={() => move(i, -1)}
            disabled={i === 0}
            aria-label="Subir"
            title="Subir prioridad"
            className="icon-btn h-7 w-7 disabled:opacity-30"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M7 14l5-5 5 5z" />
            </svg>
          </button>
          <button
            onClick={() => move(i, 1)}
            disabled={i === sorts.length - 1}
            aria-label="Bajar"
            title="Bajar prioridad"
            className="icon-btn h-7 w-7 disabled:opacity-30"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M7 10l5 5 5-5z" />
            </svg>
          </button>
          <button
            onClick={() => onChange(sorts.filter((_, k) => k !== i))}
            aria-label="Quitar"
            title="Quitar"
            className="icon-btn h-7 w-7 hover:text-danger"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between px-1 pt-1.5">
        {unused.length > 0 ? (
          <button
            onClick={() => onChange([...sorts, { col: unused[0].key, dir: 'asc' }])}
            className="btn btn-sm btn-text"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
            Agregar nivel
          </button>
        ) : (
          <span />
        )}
        {sorts.length > 0 && (
          <button onClick={() => onChange([])} className="btn btn-sm btn-text text-danger">
            Quitar orden
          </button>
        )}
      </div>
    </div>
  )
}
