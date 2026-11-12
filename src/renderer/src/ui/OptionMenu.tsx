import { useRef, useState } from 'react'
import { NOTION_COLORS } from '../../../shared/types'
import type { ChipOption } from './ChipSelect'
import { chipClass, dotClass } from './colors'

// Gestión de las opciones de una columna de Notion (select / status / multi_select).
// Cada función devuelve el mensaje de error, o null si salió bien.
export interface OptionManager {
  kind: string
  groups?: Record<string, string> // status: grupo de cada opción
  groupNames?: string[] // status: grupos disponibles
  create: (name: string, group?: string) => Promise<string | null>
  update: (option: string, change: { name?: string; color?: string }) => Promise<string | null>
  remove: (option: string) => Promise<string | null>
}

export const COLOR_LABELS: Record<string, string> = {
  default: 'Predeterminado',
  gray: 'Gris',
  brown: 'Marrón',
  orange: 'Naranja',
  yellow: 'Amarillo',
  green: 'Verde',
  blue: 'Azul',
  purple: 'Morado',
  pink: 'Rosa',
  red: 'Rojo'
}

// Nombres de los grupos de estado de Notion
export function groupLabel(g: string): string {
  if (/^to-?do$/i.test(g)) return 'Por hacer'
  if (/^in progress$/i.test(g)) return 'En curso'
  if (/^complete$/i.test(g)) return 'Completado'
  return g
}

const ICON_MORE = 'M12 8a2 2 0 100-4 2 2 0 000 4zm0 2a2 2 0 100 4 2 2 0 000-4zm0 6a2 2 0 100 4 2 2 0 000-4z'

export function Chip({ label, color }: { label: string; color?: string }): JSX.Element {
  return (
    <span
      className={`inline-flex h-6 max-w-full items-center gap-1.5 truncate rounded-full px-2.5 text-xs font-medium ${chipClass(color)}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(color)}`} />
      <span className="truncate">{label}</span>
    </span>
  )
}

function Check({ on, round = false }: { on: boolean; round?: boolean }): JSX.Element {
  return (
    <span
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center border-2 ${round ? 'rounded-full' : 'rounded-[4px]'} ${
        on ? 'border-primary bg-primary text-on-primary' : 'border-ink-2/70'
      }`}
    >
      {on && (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3.5">
          <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

function Spinner(): JSX.Element {
  return <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
}

// Contenido del menú: buscar/crear, elegir (una o varias) y editar cada opción.
// Sin `onPick` funciona solo como administrador de opciones (desde el encabezado).
export function OptionMenu({
  options,
  selected = [],
  multiple = false,
  allowEmpty = false,
  onPick,
  manage
}: {
  options: ChipOption[]
  selected?: string[]
  multiple?: boolean
  allowEmpty?: boolean
  onPick?: (value: string | null) => void
  manage?: OptionManager
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<string | null>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    const err = await fn()
    setBusy(false)
    if (err) setError(err)
    return !err
  }

  // Mientras se renombra, la opción vieja desaparece antes de que llegue la nueva: se
  // conserva la última conocida para que el editor no parpadee.
  const lastOpt = useRef<ChipOption | null>(null)
  const found = editing ? options.find((o) => o.value === editing) : undefined
  if (found) lastOpt.current = found
  const editingOpt =
    found ?? (editing && lastOpt.current ? { ...lastOpt.current, value: editing, label: editing } : undefined)
  if (manage && editing && editingOpt) {
    return (
      <OptionEditor
        key={editingOpt.value}
        option={editingOpt}
        manage={manage}
        busy={busy}
        error={error}
        run={run}
        onRenamed={(n) => setEditing(n)}
        onBack={() => {
          setEditing(null)
          setError(null)
        }}
      />
    )
  }

  const q = query.trim()
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options
  const exact = options.some((o) => o.value.toLowerCase() === q.toLowerCase())
  const canCreate = !!manage && !!q && !exact
  const statusGroups = manage?.kind === 'status' ? (manage.groupNames ?? []) : []

  const create = async (group?: string): Promise<void> => {
    const name = q
    if (await run(() => manage!.create(name, group))) {
      setQuery('')
      onPick?.(name)
    }
  }

  // Estados: agrupados como en Notion (Por hacer / En curso / Completado)
  const sections: { title: string | null; items: ChipOption[] }[] =
    manage?.kind === 'status' && manage.groups && statusGroups.length
      ? statusGroups
          .map((g) => ({
            title: groupLabel(g) as string | null,
            items: filtered.filter((o) => manage.groups?.[o.value] === g)
          }))
          .concat([{ title: null, items: filtered.filter((o) => !manage.groups?.[o.value]) }])
          .filter((s) => s.items.length > 0)
      : [{ title: null, items: filtered }]

  return (
    <div className="min-w-0">
      {manage && (
        <div className="px-1 pb-1.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              if (canCreate) void create(statusGroups[0])
              else if (filtered.length === 1 && onPick) onPick(filtered[0].value)
            }}
            placeholder={onPick ? 'Buscar o crear opción…' : 'Nueva opción…'}
            className="h-9 w-full rounded-xl bg-surface-2 px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      )}

      {allowEmpty && onPick && !q && (
        <button
          type="button"
          onClick={() => onPick(null)}
          className={`flex h-10 w-full items-center gap-3 rounded-xl px-2 text-left text-xs text-ink-2 hover:bg-ink/5 ${
            selected.length === 0 ? 'bg-primary-soft/60' : ''
          }`}
        >
          Ninguno
        </button>
      )}

      {sections.map((sec, i) => (
        <div key={sec.title ?? `s${i}`}>
          {sec.title && <p className="px-2 pb-0.5 pt-2 text-[11px] font-medium text-ink-2">{sec.title}</p>}
          {sec.items.map((o) => {
            const on = selected.includes(o.value)
            return (
              <div
                key={o.value}
                className={`group flex items-center gap-1 rounded-xl pr-1 transition-colors ${
                  on && !multiple ? 'bg-primary-soft/60' : 'hover:bg-ink/5'
                }`}
              >
                <button
                  type="button"
                  onClick={() => (onPick ? onPick(o.value) : setEditing(o.value))}
                  className="flex h-10 min-w-0 flex-1 items-center gap-3 px-2 text-left"
                >
                  {multiple && <Check on={on} />}
                  <span className="min-w-0 flex-1">
                    <Chip label={o.label} color={o.color} />
                  </span>
                  {!multiple && on && (
                    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                {manage && (
                  <button
                    type="button"
                    onClick={() => setEditing(o.value)}
                    title="Editar opción"
                    aria-label={`Editar opción ${o.label}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-2 opacity-0 transition-opacity hover:bg-ink/10 focus:opacity-100 group-hover:opacity-100"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                      <path d={ICON_MORE} />
                    </svg>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {filtered.length === 0 && !canCreate && (
        <p className="px-3 py-2 text-xs text-ink-2">{q ? 'Sin coincidencias.' : 'Sin opciones todavía.'}</p>
      )}

      {canCreate &&
        (statusGroups.length > 0 ? (
          <div className="mt-1 rounded-xl bg-surface-2/60 p-2">
            <p className="flex items-center gap-1.5 px-1 pb-1.5 text-xs text-ink-2">
              Crear <Chip label={q} color="default" /> en:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {statusGroups.map((g) => (
                <button key={g} type="button" disabled={busy} onClick={() => void create(g)} className="chip h-7 text-xs">
                  {groupLabel(g)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void create()}
            className="mt-0.5 flex h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-sm hover:bg-ink/5"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-2" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
            <span className="shrink-0 text-ink-2">Crear</span>
            <span className="min-w-0">
              <Chip label={q} color="default" />
            </span>
          </button>
        ))}

      {busy && (
        <p className="flex items-center gap-2 px-2 pt-2 text-xs text-ink-2">
          <Spinner /> Guardando en Notion…
        </p>
      )}
      {error && <p className="px-2 pt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}

function OptionEditor({
  option,
  manage,
  busy,
  error,
  run,
  onRenamed,
  onBack
}: {
  option: ChipOption
  manage: OptionManager
  busy: boolean
  error: string | null
  run: (fn: () => Promise<string | null>) => Promise<boolean>
  onRenamed: (name: string) => void
  onBack: () => void
}): JSX.Element {
  const [name, setName] = useState(option.value)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const renamed = name.trim() !== '' && name.trim() !== option.value
  const color = option.color ?? 'default'

  const saveName = async (): Promise<void> => {
    if (!renamed || busy) return
    const n = name.trim()
    if (await run(() => manage.update(option.value, { name: n }))) onRenamed(n)
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 pb-2">
        <button type="button" onClick={onBack} aria-label="Volver" className="icon-btn h-8 w-8">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>
        <span className="text-sm font-medium">Editar opción</span>
      </div>

      <div className="space-y-1.5 px-1">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void saveName()
          }}
          className="h-9 w-full rounded-xl bg-surface-2 px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        {renamed && (
          <div className="flex items-center gap-2">
            <p className="flex-1 text-[11px] leading-tight text-ink-2">
              Se actualizarán todas las tareas que la usan.
            </p>
            <button type="button" disabled={busy} onClick={() => void saveName()} className="btn btn-sm btn-filled">
              Guardar
            </button>
          </div>
        )}
      </div>

      <p className="px-2 pb-1 pt-3 text-[11px] font-medium text-ink-2">Color</p>
      <div className="grid grid-cols-2 gap-0.5">
        {NOTION_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            disabled={busy}
            onClick={() => c !== color && void run(() => manage.update(option.value, { color: c }))}
            className={`flex h-9 items-center gap-2 rounded-xl px-2 text-left text-xs hover:bg-ink/5 ${
              c === color ? 'bg-primary-soft/60 font-medium' : ''
            }`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${chipClass(c)} ring-1 ring-inset ring-black/5`}
            >
              <span className={`h-2 w-2 rounded-full ${dotClass(c)}`} />
            </span>
            {COLOR_LABELS[c]}
          </button>
        ))}
      </div>

      <div className="mt-2 border-t border-line pt-2">
        {confirmDelete ? (
          <div className="rounded-xl bg-danger-soft/60 p-2.5">
            <p className="pb-2 text-xs text-ink">
              ¿Eliminar <b>{option.value}</b>? Se quitará de todas las tareas que la usan, también en Notion.
            </p>
            <div className="flex justify-end gap-1.5">
              <button type="button" onClick={() => setConfirmDelete(false)} className="btn btn-sm btn-text">
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => manage.remove(option.value)).then((ok) => ok && onBack())}
                className="btn btn-sm btn-danger"
              >
                Eliminar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="flex h-9 w-full items-center gap-2 rounded-xl px-2 text-left text-sm text-danger hover:bg-danger-soft/50"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
            </svg>
            Eliminar opción
          </button>
        )}
      </div>

      {busy && (
        <p className="flex items-center gap-2 px-2 pt-2 text-xs text-ink-2">
          <Spinner /> Guardando en Notion…
        </p>
      )}
      {error && <p className="px-2 pt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
