import { useState } from 'react'
import { NEW_PROP_TYPES, type NewPropType, type NotionDatabaseSummary, type PropSchema } from '../../../shared/types'
import { useTasks } from '../store'
import { Chip, OptionMenu } from '../ui/OptionMenu'
import { OPTION_PROP_TYPES, useOptionManager } from './OptionField'
import { chipOptions } from './PropEditor'

// Menús para administrar las columnas (propiedades) de una database de Notion:
// crear una columna nueva y renombrar / editar opciones / eliminar una existente.

const TYPE_LABEL: Record<string, string> = Object.fromEntries(NEW_PROP_TYPES.map((t) => [t.type, t.label]))
TYPE_LABEL.status = 'Estado'
TYPE_LABEL.title = 'Título'

function useRun(): {
  busy: boolean
  error: string | null
  run: (fn: () => Promise<string | null>) => Promise<boolean>
  setError: (e: string | null) => void
} {
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
  return { busy, error, run, setError }
}

function Status({ busy, error }: { busy: boolean; error: string | null }): JSX.Element | null {
  if (busy) {
    return (
      <p className="flex items-center gap-2 px-2 pt-2 text-xs text-ink-2">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Guardando en Notion…
      </p>
    )
  }
  return error ? <p className="px-2 pt-2 text-xs text-danger">{error}</p> : null
}

const inputCls = 'h-9 w-full rounded-xl bg-surface-2 px-3 text-sm outline-none focus:ring-2 focus:ring-primary'

// ---- Columna nueva ----

export function NewPropertyForm({
  db,
  onDone
}: {
  db: NotionDatabaseSummary
  onDone: () => void
}): JSX.Element {
  const updateSchema = useTasks((s) => s.updateSchema)
  const [name, setName] = useState('')
  const [type, setType] = useState<NewPropType>('select')
  const [options, setOptions] = useState<string[]>([])
  const [optDraft, setOptDraft] = useState('')
  const { busy, error, run, setError } = useRun()
  const withOptions = type === 'select' || type === 'multi_select'

  const addOpt = (): void => {
    const v = optDraft.trim()
    if (!v) return
    if (v.includes(',')) return setError('El nombre de una opción no puede llevar comas.')
    if (!options.some((o) => o.toLowerCase() === v.toLowerCase())) setOptions([...options, v])
    setOptDraft('')
    setError(null)
  }

  const submit = async (): Promise<void> => {
    if (!name.trim()) return setError('Escribe un nombre para la columna.')
    const pending = optDraft.trim()
    const opts = withOptions ? [...options, ...(pending && !options.includes(pending) ? [pending] : [])] : []
    const ok = await run(() =>
      updateSchema(db.id, {
        kind: 'addProperty',
        name: name.trim(),
        type,
        options: opts.map((o) => ({ name: o }))
      })
    )
    if (ok) onDone()
  }

  return (
    <div className="space-y-2 p-1">
      <p className="px-1 text-sm font-medium">Nueva columna en «{db.title}»</p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !withOptions) void submit()
        }}
        placeholder="Nombre (ej. Módulo, Canal, Ciudad…)"
        className={inputCls}
      />
      <p className="px-1 pt-1 text-[11px] font-medium text-ink-2">Tipo</p>
      <div className="flex flex-wrap gap-1.5">
        {NEW_PROP_TYPES.map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => setType(t.type)}
            className={`chip h-7 text-xs ${type === t.type ? 'chip-on' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {withOptions && (
        <>
          <p className="px-1 pt-1 text-[11px] font-medium text-ink-2">Opciones (puedes agregar más después)</p>
          {options.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {options.map((o) => (
                <button
                  key={o}
                  type="button"
                  title="Quitar"
                  onClick={() => setOptions(options.filter((x) => x !== o))}
                  className="rounded-full hover:opacity-70"
                >
                  <Chip label={`${o}  ✕`} color="default" />
                </button>
              ))}
            </div>
          )}
          <input
            value={optDraft}
            onChange={(e) => setOptDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addOpt()
              }
            }}
            placeholder="Escribe una opción y pulsa Enter"
            className={inputCls}
          />
        </>
      )}
      <div className="flex justify-end gap-1.5 pt-1">
        <button type="button" onClick={onDone} className="btn btn-sm btn-text">
          Cancelar
        </button>
        <button type="button" disabled={busy} onClick={() => void submit()} className="btn btn-sm btn-filled">
          Crear columna
        </button>
      </div>
      <Status busy={busy} error={error} />
    </div>
  )
}

// ---- Columna existente ----

const MenuRow = ({
  icon,
  label,
  danger = false,
  onClick
}: {
  icon: string
  label: string
  danger?: boolean
  onClick: () => void
}): JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    className={`flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm ${
      danger ? 'text-danger hover:bg-danger-soft/50' : 'hover:bg-ink/5'
    }`}
  >
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="currentColor">
      <path d={icon} />
    </svg>
    {label}
  </button>
)

const ICON_EDIT =
  'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z'
const ICON_LIST = 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z'
const ICON_DELETE = 'M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'

export function ColumnMenu({
  db,
  schema,
  onDone
}: {
  db: NotionDatabaseSummary
  schema: PropSchema
  onDone: () => void
}): JSX.Element {
  const updateSchema = useTasks((s) => s.updateSchema)
  const manage = useOptionManager(db, schema)
  const [mode, setMode] = useState<'menu' | 'rename' | 'options' | 'delete'>('menu')
  const [name, setName] = useState(schema.name)
  const { busy, error, run } = useRun()
  const hasOptions = OPTION_PROP_TYPES.includes(schema.type) && !!manage
  const isTitle = schema.type === 'title'

  const back = (
    <button type="button" onClick={() => setMode('menu')} aria-label="Volver" className="icon-btn h-8 w-8">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
      </svg>
    </button>
  )

  if (mode === 'rename') {
    const save = async (): Promise<void> => {
      if (await run(() => updateSchema(db.id, { kind: 'renameProperty', prop: schema.name, name }))) onDone()
    }
    return (
      <div className="space-y-2 p-1">
        <div className="flex items-center gap-1">
          {back}
          <span className="text-sm font-medium">Renombrar columna</span>
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
          }}
          className={inputCls}
        />
        <div className="flex justify-end">
          <button type="button" disabled={busy || !name.trim()} onClick={() => void save()} className="btn btn-sm btn-filled">
            Guardar
          </button>
        </div>
        <Status busy={busy} error={error} />
      </div>
    )
  }

  if (mode === 'options' && manage) {
    return (
      <div>
        <div className="flex items-center gap-1 pb-1">
          {back}
          <span className="text-sm font-medium">Opciones de «{schema.name}»</span>
        </div>
        <OptionMenu options={chipOptions(schema)} manage={manage} />
      </div>
    )
  }

  if (mode === 'delete') {
    const del = async (): Promise<void> => {
      if (await run(() => updateSchema(db.id, { kind: 'deleteProperty', prop: schema.name }))) onDone()
    }
    return (
      <div className="space-y-2 p-1">
        <div className="flex items-center gap-1">
          {back}
          <span className="text-sm font-medium">Eliminar columna</span>
        </div>
        <div className="rounded-xl bg-danger-soft/60 p-3 text-xs leading-relaxed">
          Se eliminará <b>{schema.name}</b> de la database «{db.title}» en Notion, con los datos que tenga en
          todas sus tareas.
        </div>
        <div className="flex justify-end gap-1.5">
          <button type="button" onClick={() => setMode('menu')} className="btn btn-sm btn-text">
            Cancelar
          </button>
          <button type="button" disabled={busy} onClick={() => void del()} className="btn btn-sm btn-danger">
            Eliminar columna
          </button>
        </div>
        <Status busy={busy} error={error} />
      </div>
    )
  }

  return (
    <div>
      <p className="truncate px-3 pb-1 pt-1 text-xs text-ink-2">
        {schema.name} · {TYPE_LABEL[schema.type] ?? schema.type}
      </p>
      <MenuRow icon={ICON_EDIT} label="Renombrar" onClick={() => setMode('rename')} />
      {hasOptions && <MenuRow icon={ICON_LIST} label="Editar opciones" onClick={() => setMode('options')} />}
      {!isTitle && <MenuRow icon={ICON_DELETE} label="Eliminar columna" danger onClick={() => setMode('delete')} />}
    </div>
  )
}
