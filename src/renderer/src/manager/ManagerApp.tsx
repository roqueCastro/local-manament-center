import { useEffect, useMemo, useRef, useState } from 'react'
import { useTasks } from '../store'
import type { NotionDatabaseSummary, PropSchema, Task, TaskPatch } from '../../../shared/types'
import { Settings } from '../components/Settings'
import { SyncIndicator } from '../components/SyncIndicator'
import { parseQuickInput } from '../components/QuickAdd'
import { VoiceButton } from '../components/VoiceButton'
import { VoiceReview } from '../components/VoiceReview'
import { ChipSelect } from '../ui/ChipSelect'
import { chipClass, dotClass, PRIORITY_LEVELS } from '../ui/colors'
import { TaskDetail } from './TaskDetail'
import { chipOptions, formatValue } from './PropEditor'
import { FilterBar } from './FilterBar'
import {
  EMPTY_VIEW,
  applyView,
  buildColumns,
  isActive,
  type TableView
} from './tableView'

const STATUS_FILTERS = [
  { key: 'pending', label: 'Pendientes' },
  { key: 'done', label: 'Hechas' },
  { key: 'all', label: 'Todas' }
] as const

const priorityOptions = PRIORITY_LEVELS.map((p) => ({
  value: String(p.value),
  label: p.label,
  color: p.color
}))

// Ventana "Gestor de tareas": todas las tareas en tabla, filtradas por proyecto, con todas
// las columnas de Notion y un panel lateral para editar cada tarea.
export default function ManagerApp(): JSX.Element {
  const {
    tasks,
    filter,
    view,
    notion,
    projects,
    activeProject,
    load,
    loadConnection,
    loadProjects,
    loadAiStatus,
    setFilter,
    setView,
    setActiveProject,
    setSyncState,
    add,
    edit,
    toggle
  } = useTasks()

  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Preferencias guardadas en settings.json: proyecto, filtro y vista de tabla por proyecto
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [views, setViews] = useState<Record<string, TableView>>({})
  const viewKey = activeProject || '*'
  const tableView = views[viewKey] ?? EMPTY_VIEW
  const updateView = (v: TableView): void => {
    const next = { ...views, [viewKey]: v }
    setViews(next)
    window.api.managerPrefs.set({ views: next })
  }

  useEffect(() => {
    document.title = 'Gestor de tareas'
    if (!window.api) return
    // Restaurar el último proyecto, filtro y vistas de tabla usados en el gestor
    void window.api.managerPrefs.get().then((p) => {
      if (p.project) setActiveProject(p.project)
      if (p.filter === 'pending' || p.filter === 'done' || p.filter === 'all') setFilter(p.filter)
      setViews((p.views ?? {}) as Record<string, TableView>)
      setPrefsLoaded(true)
    })
    void load()
    void loadConnection()
    void loadProjects()
    void loadAiStatus()
    window.api.onChanged(() => {
      void load()
      void loadConnection()
      void loadProjects()
    })
    window.api.onSyncState((s) => setSyncState(s))
    return () => {
      window.api.offChanged()
      window.api.offSyncState()
    }
  }, [load, loadConnection, loadProjects, loadAiStatus, setSyncState, setActiveProject, setFilter])

  useEffect(() => {
    if (prefsLoaded) window.api.managerPrefs.set({ project: activeProject })
  }, [activeProject, prefsLoaded])
  useEffect(() => {
    if (prefsLoaded) window.api.managerPrefs.set({ filter })
  }, [filter, prefsLoaded])

  // Databases (proyectos) activas en Ajustes, con su esquema de columnas
  const dbs = useMemo(
    () => (notion?.connected ? notion.databases.filter((d) => d.enabled) : []),
    [notion]
  )
  const dbOf = (t: Task): NotionDatabaseSummary | undefined =>
    dbs.find((d) => d.id === t.notionDb) ?? dbs.find((d) => d.title === t.project)
  const activeDb = dbs.find((d) => d.title === activeProject)

  const pendingBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tasks) {
      if (t.status !== 'pending') continue
      m.set(t.project ?? '', (m.get(t.project ?? '') ?? 0) + 1)
    }
    return m
  }, [tasks])
  const totalPending = tasks.filter((t) => t.status === 'pending').length

  const baseVisible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter((t) => {
      if (filter !== 'all' && t.status !== filter) return false
      if (activeProject && t.project !== activeProject) return false
      if (!q) return true
      if (t.title.toLowerCase().includes(q)) return true
      return Object.values(t.props).some((v) =>
        (Array.isArray(v) ? v.join(' ') : String(v ?? '')).toLowerCase().includes(q)
      )
    })
  }, [tasks, filter, activeProject, search])

  // Columnas extra: todas las de Notion salvo las que ya tienen columna propia
  // (título, estado, prioridad, fecha límite). En "Todos" se unen las de cada proyecto.
  const extraColumns = useMemo(() => {
    const source = activeDb ? [activeDb] : dbs
    const cols: PropSchema[] = []
    const seen = new Set<string>()
    for (const d of source) {
      const core = new Set(
        [d.mapping.title, d.mapping.statusProp, d.mapping.priorityProp, d.mapping.dueProp].filter(
          Boolean
        ) as string[]
      )
      for (const p of d.schema) {
        if (core.has(p.name) || p.type === 'title' || seen.has(p.name)) continue
        seen.add(p.name)
        cols.push(p)
      }
    }
    return cols
  }, [activeDb, dbs])

  const dueLabel = activeDb?.mapping.dueProp ?? 'Fecha límite'

  const columns = useMemo(
    () =>
      buildColumns({
        dbs: activeDb ? [activeDb] : dbs,
        dbOf,
        showProject: !activeProject,
        projects,
        extraColumns,
        dueLabel
      }),
    // dbOf depende solo de dbs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeDb, dbs, activeProject, projects, extraColumns, dueLabel]
  )
  const visible = useMemo(
    () => applyView(baseVisible, tableView, columns),
    [baseVisible, tableView, columns]
  )
  const filtersOn = tableView.filters.some(isActive)

  // Click en un encabezado: ascendente → descendente → sin orden
  const sortBy = (col: string): void => {
    const cur = tableView.sort
    const sort =
      cur?.col !== col ? { col, dir: 'asc' as const } : cur.dir === 'asc' ? { col, dir: 'desc' as const } : null
    updateView({ ...tableView, sort })
  }
  const sortTh = (col: string, label: string, className: string): JSX.Element => (
    <Th key={col} className={className} sort={tableView.sort?.col === col ? tableView.sort.dir : null} onClick={() => sortBy(col)}>
      {label}
    </Th>
  )
  const selected = tasks.find((t) => t.id === selectedId) ?? null

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null)
  }, [selectedId, selected])

  if (view === 'settings') {
    return (
      <div className="h-full bg-surface-1">
        <div className="mx-auto h-full max-w-2xl">
          <Settings />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-surface-1 text-ink">
      {/* --- Proyectos --- */}
      <aside className="flex w-72 shrink-0 flex-col">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-on-primary shadow-elev-1">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h1 className="text-lg font-normal leading-tight">Gestor de tareas</h1>
            <p className="text-xs text-ink-2">
              {totalPending} pendiente{totalPending === 1 ? '' : 's'} en total
            </p>
          </div>
        </div>
        <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-3">
          <ProjectLink
            label="Todos los proyectos"
            count={totalPending}
            active={activeProject === ''}
            onClick={() => setActiveProject('')}
            icon={
              <path d="M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z" />
            }
          />
          {projects.length > 0 && (
            <p className="px-4 pb-1 pt-4 text-xs font-medium text-ink-2">Proyectos</p>
          )}
          {projects.map((p) => (
            <ProjectLink
              key={p}
              label={p}
              count={pendingBy.get(p) ?? 0}
              active={activeProject === p}
              onClick={() => setActiveProject(p)}
              icon={<path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />}
            />
          ))}
        </nav>
        <div className="flex items-center justify-between px-4 py-3">
          <SyncIndicator />
          <button onClick={() => setView('settings')} className="btn btn-sm btn-text">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M19.14 12.94a7.07 7.07 0 000-1.88l2.03-1.58a.48.48 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7 7 0 00-1.62-.94l-.36-2.54A.48.48 0 0013.93 2h-3.84a.48.48 0 00-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.48.48 0 00-.59.22L2.73 8.87a.47.47 0 00.12.61l2.03 1.58a7.4 7.4 0 000 1.88l-2.03 1.58a.48.48 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 00-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z" />
            </svg>
            Ajustes
          </button>
        </div>
      </aside>

      {/* --- Contenido --- */}
      <main className="flex min-w-0 flex-1 flex-col py-3 pr-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] bg-surface shadow-elev-1">
          <div className="flex flex-wrap items-center gap-3 px-6 pb-3 pt-5">
            <h2 className="mr-auto truncate text-2xl font-normal">
              {activeProject || 'Todos los proyectos'}
            </h2>
            <div className="relative w-80">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-2" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar tarea, cliente, contacto…"
                className="pill-input pl-12"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`chip ${filter === f.key ? 'chip-on' : ''}`}
              >
                {filter === f.key && (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {f.label}
              </button>
            ))}
            <span className="mx-1 h-6 w-px bg-line" />
            <FilterBar view={tableView} cols={columns} onChange={updateView} />
            <span className="ml-auto text-xs text-ink-2">
              {visible.length} tarea{visible.length === 1 ? '' : 's'}
              {filtersOn && ` de ${baseVisible.length}`}
            </span>
          </div>

          <NewTaskBar
            activeProject={activeProject}
            projects={projects}
            defaultProject={dbs.find((d) => d.isDefault)?.title ?? projects[0] ?? ''}
            onAdd={async (title, project) => {
              const parsed = parseQuickInput(title)
              if (parsed) await add({ ...parsed, project: project || null })
            }}
          />

          <div className="scroll-thin flex-1 overflow-auto px-3 pb-3">
            {visible.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-20 text-ink-2">
                <svg viewBox="0 0 24 24" className="h-12 w-12 opacity-40" fill="currentColor">
                  <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
                <p className="text-sm">
                  {search
                    ? 'Ninguna tarea coincide con la búsqueda.'
                    : filtersOn
                      ? 'Ninguna tarea coincide con los filtros.'
                      : 'Sin tareas en esta vista.'}
                </p>
                {filtersOn && (
                  <button onClick={() => updateView({ ...tableView, filters: [] })} className="btn btn-sm btn-tonal">
                    Quitar filtros
                  </button>
                )}
              </div>
            ) : (
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10 bg-surface text-left text-xs font-medium text-ink-2">
                  <tr>
                    <Th className="w-12" />
                    {sortTh('title', 'Tarea', 'min-w-[320px]')}
                    {!activeProject && sortTh('project', 'Proyecto', 'min-w-[170px]')}
                    {sortTh('status', 'Estado', 'min-w-[150px]')}
                    {sortTh('priority', 'Prioridad', 'min-w-[140px]')}
                    {sortTh('due', dueLabel, 'min-w-[160px]')}
                    {extraColumns.map((c) => sortTh(`prop:${c.name}`, c.name, 'min-w-[160px]'))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      db={dbOf(t)}
                      showProject={!activeProject}
                      extraColumns={extraColumns}
                      selected={t.id === selectedId}
                      onSelect={() => setSelectedId(t.id)}
                      onToggle={() => void toggle(t.id)}
                      onEdit={(patch) => void edit(t.id, patch)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {selected && (
        <TaskDetail task={selected} db={dbOf(selected)} onClose={() => setSelectedId(null)} />
      )}

      {/* Revisión de tareas dictadas por voz */}
      <VoiceReview variant="dialog" />
    </div>
  )
}

function TaskRow({
  task: t,
  db,
  showProject,
  extraColumns,
  selected,
  onSelect,
  onToggle,
  onEdit
}: {
  task: Task
  db: NotionDatabaseSummary | undefined
  showProject: boolean
  extraColumns: PropSchema[]
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onEdit: (patch: TaskPatch) => void
}): JSX.Element {
  const done = t.status === 'done'
  const statusSchema = db?.schema.find((p) => p.name === db.mapping.statusProp)
  const prioritySchema = db?.schema.find((p) => p.name === db.mapping.priorityProp)
  const statusValue = statusSchema ? t.props[statusSchema.name] : null
  const priorityValue = prioritySchema ? t.props[prioritySchema.name] : null

  const rowBg = selected ? 'bg-primary-soft/50' : 'hover:bg-ink/[0.04]'
  const cell = `border-b border-line px-3 py-2.5 align-middle ${rowBg}`
  const stop = (e: React.MouseEvent): void => e.stopPropagation()

  return (
    <tr onClick={onSelect} className="cursor-pointer">
      <td className={`${cell} rounded-l-2xl`}>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          title={done ? 'Marcar pendiente' : 'Marcar como hecha'}
          className={`ml-1 block h-5 w-5 rounded-full border-2 p-0.5 transition-colors ${
            done ? 'border-primary bg-primary text-on-primary' : 'border-ink-2/60 hover:border-primary'
          }`}
        >
          {done && (
            <svg viewBox="0 0 24 24" className="h-full w-full" fill="none">
              <path d="M5 12l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </td>
      <td className={cell}>
        <span className={`line-clamp-2 ${done ? 'text-ink-2/70 line-through' : ''}`}>{t.title}</span>
      </td>
      {showProject && (
        <td className={cell}>
          <span className="inline-flex h-6 max-w-[200px] items-center truncate rounded-full bg-[#e9ddff] px-2.5 text-xs font-medium text-[#5a2ca0] dark:bg-[#4a2580] dark:text-[#e9ddff]">
            {t.project ?? '—'}
          </span>
        </td>
      )}
      <td className={cell} onClick={stop}>
        {statusSchema?.options?.length ? (
          <ChipSelect
            value={typeof statusValue === 'string' && statusValue ? statusValue : null}
            options={chipOptions(statusSchema)}
            onChange={(v) => v && onEdit({ props: { [statusSchema.name]: v } })}
          />
        ) : (
          <ChipSelect
            value={t.status}
            options={[
              { value: 'pending', label: 'Pendiente', color: 'blue' },
              { value: 'done', label: 'Hecha', color: 'green' }
            ]}
            onChange={(v) => v && onEdit({ status: v as Task['status'] })}
          />
        )}
      </td>
      <td className={cell} onClick={stop}>
        {prioritySchema?.type === 'select' ? (
          <ChipSelect
            value={typeof priorityValue === 'string' && priorityValue ? priorityValue : null}
            options={chipOptions(prioritySchema)}
            allowEmpty
            onChange={(v) => onEdit({ props: { [prioritySchema.name]: v } })}
          />
        ) : (
          <ChipSelect
            value={String(t.priority)}
            options={priorityOptions}
            onChange={(v) => onEdit({ priority: Number(v ?? 0) })}
          />
        )}
      </td>
      <td className={cell} onClick={stop}>
        <input
          type="date"
          value={t.dueDate?.slice(0, 10) ?? ''}
          onChange={(e) => onEdit({ dueDate: e.target.value || null })}
          className={`h-7 rounded-full px-3 text-xs outline-none transition-colors focus:ring-2 focus:ring-primary ${
            t.dueDate ? 'bg-surface-2 text-ink' : 'bg-transparent text-ink-2/60 hover:bg-surface-2'
          }`}
        />
      </td>
      {extraColumns.map((c, i) => (
        <td key={c.name} className={`${cell} ${i === extraColumns.length - 1 ? 'rounded-r-2xl' : ''}`}>
          <ExtraCell schema={c} value={t.props[c.name]} />
        </td>
      ))}
    </tr>
  )
}

// Celda de solo lectura (se edita en el panel lateral). Selects con su color de Notion.
function ExtraCell({ schema, value }: { schema: PropSchema; value: Task['props'][string] }): JSX.Element {
  const text = formatValue(value, schema.type)
  if (!text) return <span className="text-ink-2/40">—</span>
  if ((schema.type === 'select' || schema.type === 'status') && typeof value === 'string') {
    const color = schema.colors?.[value]
    return (
      <span className="inline-flex">
        <ChipLabel label={value} color={color} />
      </span>
    )
  }
  if (schema.type === 'multi_select' && Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((v) => (
          <ChipLabel key={v} label={v} color={schema.colors?.[v]} />
        ))}
      </span>
    )
  }
  return <span className="line-clamp-2 max-w-[260px] text-ink">{text}</span>
}

// Chip estático (sin menú) con los mismos colores que ChipSelect
function ChipLabel({ label, color }: { label: string; color?: string }): JSX.Element {
  return (
    <span
      className={`inline-flex h-6 max-w-[200px] items-center gap-1.5 truncate rounded-full px-2.5 text-xs font-medium ${chipClass(color)}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(color)}`} />
      {label}
    </span>
  )
}

function ProjectLink({
  label,
  count,
  active,
  onClick,
  icon
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  icon: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex h-12 w-full items-center gap-3 rounded-full px-4 text-left text-sm transition-colors ${
        active ? 'bg-primary-soft font-medium text-on-primary-soft' : 'text-ink-2 hover:bg-ink/5'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="currentColor">
        {icon}
      </svg>
      <span className="flex-1 truncate">{label}</span>
      {count > 0 && <span className="text-xs font-medium">{count}</span>}
    </button>
  )
}

// Entrada para crear tareas: dentro de un proyecto se crean ahí; en "Todos" se elige destino.
// Incluye el micrófono para dictar (las tareas dictadas van al proyecto abierto).
function NewTaskBar({
  activeProject,
  projects,
  defaultProject,
  onAdd
}: {
  activeProject: string
  projects: string[]
  defaultProject: string
  onAdd: (title: string, project: string) => Promise<void>
}): JSX.Element {
  const [value, setValue] = useState('')
  const [target, setTarget] = useState(defaultProject)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!projects.includes(target)) setTarget(defaultProject)
  }, [projects, target, defaultProject])

  const project = activeProject || target

  async function submit(): Promise<void> {
    if (!value.trim()) return
    await onAdd(value, project)
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <div className="mx-6 mb-3 flex items-center gap-2 rounded-full bg-surface-2 p-1.5 pl-1.5">
      <VoiceButton />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
        }}
        placeholder={
          project ? `Nueva tarea en «${project}»…  (! prioridad)` : 'Nueva tarea…  (! prioridad)'
        }
        className="h-11 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-ink-2/80"
      />
      {!activeProject && projects.length > 0 && (
        <ChipSelect
          value={target}
          options={projects.map((p) => ({ value: p, label: p, color: 'purple' }))}
          onChange={(v) => v && setTarget(v)}
        />
      )}
      <button onClick={() => void submit()} className="btn btn-filled">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
        </svg>
        Añadir
      </button>
    </div>
  )
}

function Th({
  children,
  className = '',
  sort = null,
  onClick
}: {
  children?: React.ReactNode
  className?: string
  sort?: 'asc' | 'desc' | null
  onClick?: () => void
}): JSX.Element {
  return (
    <th className={`whitespace-nowrap border-b border-line px-1.5 py-2 font-medium ${className}`}>
      {onClick ? (
        <button
          onClick={onClick}
          title="Ordenar por esta columna"
          className={`group inline-flex h-8 items-center gap-1 rounded-full px-1.5 transition-colors hover:bg-ink/5 ${
            sort ? 'text-primary' : ''
          }`}
        >
          {children}
          <svg
            viewBox="0 0 24 24"
            className={`h-4 w-4 transition-all ${sort ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'} ${
              sort === 'desc' ? 'rotate-180' : ''
            }`}
            fill="currentColor"
          >
            <path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z" />
          </svg>
        </button>
      ) : (
        children
      )}
    </th>
  )
}
