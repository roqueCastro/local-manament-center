import { useEffect, useMemo, useRef, useState } from 'react'
import { useTasks } from '../store'
import type { NotionDatabaseSummary, PropSchema, Task, TaskPatch } from '../../../shared/types'
import { Settings } from '../components/Settings'
import { SyncIndicator } from '../components/SyncIndicator'
import { parseQuickInput } from '../components/QuickAdd'
import { VoiceButton } from '../components/VoiceButton'
import { AiToggle, useAiText } from '../components/AiToggle'
import { VoiceReview } from '../components/VoiceReview'
import { ChipSelect } from '../ui/ChipSelect'
import { chipClass, dotClass, PRIORITY_LEVELS } from '../ui/colors'
import { TaskDetail } from './TaskDetail'
import { formatValue } from './PropEditor'
import { FilterBar } from './FilterBar'
import { Popover } from '../ui/Popover'
import { OPTION_PROP_TYPES, OptionField } from './OptionField'
import { ColumnMenu, NewPropertyForm } from './ColumnMenus'
import { formatReminder, fromLocalInput, reminderTime, toLocalInput } from '../../../shared/dates'
import { ColumnsPanel } from './ColumnsPanel'
import {
  EMPTY_VIEW,
  applyView,
  arrangeColumns,
  buildColumns,
  cycleSort,
  moveColumn,
  isActive,
  normalizeView,
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
    toggle,
    processText,
    updateSchema
  } = useTasks()

  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Menú de una columna (prop) o formulario de columna nueva (prop = null)
  const [colMenu, setColMenu] = useState<{ prop: string | null; anchor: HTMLElement } | null>(null)
  // Preferencias guardadas en settings.json: proyecto, filtro y vista de tabla por proyecto
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [views, setViews] = useState<Record<string, TableView>>({})
  // Tabla compacta (textos a 2 líneas) o texto completo (por defecto)
  const [compact, setCompact] = useState(false)
  const toggleCompact = (): void => {
    setCompact(!compact)
    window.api.managerPrefs.set({ compact: !compact })
  }
  // Procesar con IA el texto de "Nueva tarea" (preferencia compartida con el panel rápido)
  const aiText = useAiText()
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
      setCompact(p.compact === true)
      setViews(
        Object.fromEntries(Object.entries(p.views ?? {}).map(([k, v]) => [k, normalizeView(v)]))
      )
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

  // Esc: cierra el detalle abierto, sale de Ajustes o cierra el gestor (como un modal).
  // Los menús abiertos consumen su propio Esc (Popover) y no llega aquí.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const el = document.activeElement
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (view === 'settings') setView('tasks')
      else if (selectedId) setSelectedId(null)
      else window.api.hideManager()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, selectedId, setView])

  // Abrir el detalle de una tarea pedida desde un recordatorio
  useEffect(() => {
    if (!window.api) return
    const select = (id: string): void => {
      setView('tasks')
      setSelectedId(id)
    }
    window.api.onSelectTask(select)
    void window.api.takeSelectTask().then((id) => id && select(id))
  }, [setView])

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
  const statusLabel = activeDb?.mapping.statusProp ?? 'Estado'
  const priorityLabel = activeDb?.mapping.priorityProp ?? 'Prioridad'

  // Columna de Notion detrás de cada columna de la tabla (solo dentro de un proyecto:
  // en "Todos" las columnas mezclan varias databases)
  const colSchema = (key: string): PropSchema | undefined => {
    if (!activeDb) return undefined
    const m = activeDb.mapping
    const name =
      key === 'title'
        ? m.title
        : key === 'status'
          ? m.statusProp
          : key === 'priority'
            ? m.priorityProp
            : key === 'due'
              ? m.dueProp
              : key.startsWith('prop:')
                ? key.slice(5)
                : null
    return name ? activeDb.schema.find((p) => p.name === name) : undefined
  }

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

  // ---- Posición y visibilidad de las columnas (se guardan por proyecto en la vista) ----
  const defaultKeys = useMemo(
    () => [
      'title',
      ...(activeProject ? [] : ['project']),
      'status',
      'priority',
      'due',
      ...extraColumns.map((c) => `prop:${c.name}`)
    ],
    [activeProject, extraColumns]
  )
  const orderedKeys = arrangeColumns(defaultKeys, tableView.order)
  // El título siempre se ve (tiene el botón para abrir el detalle)
  const hiddenKeys = (tableView.hidden ?? []).filter((k) => k !== 'title' && defaultKeys.includes(k))
  const shownKeys = orderedKeys.filter((k) => !hiddenKeys.includes(k))
  const labelOf = (key: string): string =>
    key === 'title'
      ? 'Tarea'
      : key === 'project'
        ? 'Proyecto'
        : key === 'status'
          ? statusLabel
          : key === 'priority'
            ? priorityLabel
            : key === 'due'
              ? dueLabel
              : key.slice(5)
  const widthOf = (key: string): string =>
    key === 'title'
      ? compact
        ? 'min-w-[320px]'
        : 'min-w-[440px]'
      : key === 'project'
        ? 'min-w-[170px]'
        : key === 'status'
          ? 'min-w-[150px]'
          : key === 'priority'
            ? 'min-w-[140px]'
            : 'min-w-[160px]'
  const setColumnLayout = (order: string[], hidden: string[]): void =>
    updateView({ ...tableView, order, hidden })
  const columnsCustomized = !!(tableView.order?.length || tableView.hidden?.length)
  const [colsAnchor, setColsAnchor] = useState<HTMLElement | null>(null)
  // Arrastrar un encabezado sobre otro para moverlo
  const [dragCol, setDragCol] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const dropColumn = (target: string): void => {
    if (dragCol && dragCol !== target) setColumnLayout(moveColumn(orderedKeys, dragCol, target), hiddenKeys)
    setDragCol(null)
    setOverCol(null)
  }

  // Click en un encabezado: agrega la columna como siguiente nivel de orden
  // (ascendente → descendente → se quita). Así se arma un orden de varias columnas.
  const sortBy = (col: string): void => updateView({ ...tableView, sorts: cycleSort(tableView.sorts, col) })
  const sortState = (col: string): { dir: 'asc' | 'desc'; level: number } | null => {
    const i = tableView.sorts.findIndex((r) => r.col === col)
    return i < 0 ? null : { dir: tableView.sorts[i].dir, level: tableView.sorts.length > 1 ? i + 1 : 0 }
  }
  const sortTh = (col: string, label: string, className: string): JSX.Element => {
    const sc = colSchema(col)
    const over = overCol === col && dragCol !== null && dragCol !== col
    const fromLeft = dragCol !== null && orderedKeys.indexOf(dragCol) < orderedKeys.indexOf(col)
    return (
      <Th
        key={col}
        className={className}
        sort={sortState(col)}
        onClick={() => sortBy(col)}
        onMenu={sc ? (anchor) => setColMenu({ prop: sc.name, anchor }) : undefined}
        drag={{
          dragging: dragCol === col,
          dropSide: over ? (fromLeft ? 'right' : 'left') : null,
          onStart: () => setDragCol(col),
          onOver: () => dragCol && setOverCol(col),
          onDrop: () => dropColumn(col),
          onEnd: () => {
            setDragCol(null)
            setOverCol(null)
          }
        }}
      >
        {label}
      </Th>
    )
  }
  const selected = tasks.find((t) => t.id === selectedId) ?? null

  useEffect(() => {
    // (esperar a que carguen las tareas: puede venir de un recordatorio al abrir el gestor)
    if (selectedId && !selected && tasks.length > 0) setSelectedId(null)
  }, [selectedId, selected, tasks.length])

  // Proyecto sin columna "Recordatorio": botón para crearla en Notion
  const [reminderBusy, setReminderBusy] = useState(false)
  const [reminderError, setReminderError] = useState<string | null>(null)
  const enableReminders = async (): Promise<void> => {
    if (!activeDb) return
    setReminderBusy(true)
    setReminderError(null)
    const err = await updateSchema(activeDb.id, { kind: 'addProperty', name: 'Recordatorio', type: 'date' })
    setReminderBusy(false)
    if (err) setReminderError(err)
  }

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
        {/* Zona para arrastrar la ventana (no tiene marco) */}
        <div className="flex items-center gap-3 px-5 pb-4 pt-5 [-webkit-app-region:drag]">
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
            {activeDb && !activeDb.mapping.reminderProp && (
              <button
                onClick={() => void enableReminders()}
                disabled={reminderBusy}
                title={
                  reminderError ??
                  'Crea en Notion la columna «Recordatorio» (fecha y hora) para que la app te avise a la hora exacta'
                }
                className={`chip ${reminderError ? 'border-danger text-danger' : ''}`}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                  <path d="M12 22a2 2 0 002-2h-4a2 2 0 002 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 00-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
                </svg>
                {reminderBusy ? 'Creando…' : reminderError ? 'Reintentar recordatorios' : 'Activar recordatorios'}
              </button>
            )}
            <span className="ml-auto text-xs text-ink-2">
              {visible.length} tarea{visible.length === 1 ? '' : 's'}
              {filtersOn && ` de ${baseVisible.length}`}
            </span>
            <button
              onClick={(e) => setColsAnchor(e.currentTarget)}
              title="Ordenar, mostrar u ocultar las columnas de la tabla"
              className={`btn btn-sm btn-text ${columnsCustomized ? 'text-primary' : ''}`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                <path d="M3 5v14h18V5H3zm5 12H5V7h3v10zm5 0h-3V7h3v10zm6 0h-4V7h4v10z" />
              </svg>
              Columnas
              {hiddenKeys.length > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-on-primary">
                  {hiddenKeys.length}
                </span>
              )}
            </button>
            <button
              onClick={toggleCompact}
              title={compact ? 'Mostrar el texto completo de cada tarea' : 'Recortar los textos largos a 2 líneas'}
              className="btn btn-sm btn-text"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                {compact ? (
                  <path d="M4 19h6v-2H4v2zM20 5H4v2h16V5zm-3 6H4v2h13.25c1.1 0 2 .9 2 2s-.9 2-2 2H15v-2l-3 3 3 3v-2h2c2.21 0 4-1.79 4-4s-1.79-4-4-4z" />
                ) : (
                  <path d="M4 15h16v-2H4v2zm0 4h16v-2H4v2zm0-8h16V9H4v2zm0-6v2h16V5H4z" />
                )}
              </svg>
              {compact ? 'Texto completo' : 'Compacto'}
            </button>
          </div>

          <NewTaskBar
            activeProject={activeProject}
            projects={projects}
            defaultProject={dbs.find((d) => d.isDefault)?.title ?? projects[0] ?? ''}
            aiAvailable={aiText.available}
            aiOn={aiText.on}
            onToggleAi={aiText.toggle}
            onAdd={async (title, project) => {
              // Con IA: llena las columnas del proyecto y muestra la revisión antes de crear
              if (aiText.on) {
                void processText(title, project || null)
                return
              }
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
                    {shownKeys.map((k) => sortTh(k, labelOf(k), widthOf(k)))}
                    {activeDb && (
                      <th className="w-12 border-b border-line px-1.5 py-2">
                        <button
                          onClick={(e) => setColMenu({ prop: null, anchor: e.currentTarget })}
                          title="Agregar columna"
                          aria-label="Agregar columna"
                          className="icon-btn h-8 w-8"
                        >
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                          </svg>
                        </button>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      db={dbOf(t)}
                      cols={shownKeys}
                      extraColumns={extraColumns}
                      trailing={!!activeDb}
                      compact={compact}
                      selected={t.id === selectedId}
                      onSelect={() => setSelectedId(t.id === selectedId ? null : t.id)}
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

      {colMenu && activeDb && (
        <Popover anchor={colMenu.anchor} onClose={() => setColMenu(null)} width={colMenu.prop ? 280 : 320}>
          {colMenu.prop ? (
            (() => {
              const sc = activeDb.schema.find((p) => p.name === colMenu.prop)
              return sc ? <ColumnMenu db={activeDb} schema={sc} onDone={() => setColMenu(null)} /> : null
            })()
          ) : (
            <NewPropertyForm db={activeDb} onDone={() => setColMenu(null)} />
          )}
        </Popover>
      )}

      {colsAnchor && (
        <Popover anchor={colsAnchor} onClose={() => setColsAnchor(null)} width={340}>
          <ColumnsPanel
            items={orderedKeys.map((k) => ({ key: k, label: labelOf(k), lockedVisible: k === 'title' }))}
            hidden={hiddenKeys}
            customized={columnsCustomized}
            onChange={setColumnLayout}
            onReset={() => updateView({ ...tableView, order: undefined, hidden: undefined })}
          />
        </Popover>
      )}

      {/* Revisión de tareas dictadas por voz */}
      <VoiceReview variant="dialog" />
    </div>
  )
}

function TaskRow({
  task: t,
  db,
  cols,
  extraColumns,
  trailing,
  compact,
  selected,
  onSelect,
  onToggle,
  onEdit
}: {
  task: Task
  db: NotionDatabaseSummary | undefined
  cols: string[] // columnas visibles, en el orden elegido
  extraColumns: PropSchema[]
  trailing: boolean // celda vacía bajo la columna "+"
  compact: boolean // textos recortados a 2 líneas (si no, se ven completos)
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

  const rowBg = selected ? 'bg-primary-soft/50' : 'group-hover/row:bg-ink/[0.04]'
  const cell = `border-b border-line px-3 py-2.5 ${compact ? 'align-middle' : 'align-top'} ${rowBg}`
  // Texto completo: respeta saltos de línea y parte palabras muy largas (URLs, correos)
  const textCls = compact ? 'line-clamp-2' : 'whitespace-pre-wrap break-words'
  const stop = (e: React.MouseEvent): void => e.stopPropagation()

  // La fila no abre el detalle al hacer clic (así se puede seleccionar y copiar texto):
  // se abre con el botón junto al título.
  return (
    <tr className="group/row">
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
      {cols.map((key, i) => renderCell(key, !trailing && i === cols.length - 1))}
      {trailing && <td className={`${cell} rounded-r-2xl`} />}
    </tr>
  )

  // Celda de cada columna (en el orden que eligió el usuario)
  function renderCell(key: string, last: boolean): JSX.Element | null {
    const cls = `${cell} ${last ? 'rounded-r-2xl' : ''}`
    switch (key) {
      case 'title':
        return (
          <td key={key} className={cls}>
            <div className={`flex gap-2 ${compact ? 'items-center' : 'items-start'}`}>
              <span
                className={`min-w-0 flex-1 cursor-text select-text ${textCls} ${compact ? '' : 'max-w-[560px] pt-1'} ${
                  done ? 'text-ink-2/70 line-through' : ''
                }`}
              >
                {t.title}
              </span>
              <button
                onClick={onSelect}
                title={selected ? 'Cerrar el detalle' : 'Abrir el detalle de la tarea'}
                aria-label={selected ? 'Cerrar el detalle' : 'Abrir el detalle de la tarea'}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
                  selected
                    ? 'bg-primary text-on-primary'
                    : 'text-ink-2 opacity-50 hover:bg-ink/10 hover:opacity-100 group-hover/row:opacity-100'
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor">
                  <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-4 16H5V5h10v14z" />
                </svg>
              </button>
            </div>
          </td>
        )
      case 'project':
        return (
          <td key={key} className={cls}>
            <span className="inline-flex h-6 max-w-[200px] select-text items-center truncate rounded-full bg-[#e9ddff] px-2.5 text-xs font-medium text-[#5a2ca0] dark:bg-[#4a2580] dark:text-[#e9ddff]">
              {t.project ?? '—'}
            </span>
          </td>
        )
      case 'status':
        return (
          <td key={key} className={cls} onClick={stop}>
            {statusSchema && (statusSchema.type === 'status' || statusSchema.type === 'select') ? (
              <OptionField
                db={db}
                schema={statusSchema}
                value={statusValue}
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
        )
      case 'priority':
        return (
          <td key={key} className={cls} onClick={stop}>
            {prioritySchema?.type === 'select' ? (
              <OptionField
                db={db}
                schema={prioritySchema}
                value={priorityValue}
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
        )
      case 'due':
        return (
          <td key={key} className={cls} onClick={stop}>
            <input
              type="date"
              value={t.dueDate?.slice(0, 10) ?? ''}
              onChange={(e) => onEdit({ dueDate: e.target.value || null })}
              className={`h-7 rounded-full px-3 text-xs outline-none transition-colors focus:ring-2 focus:ring-primary ${
                t.dueDate ? 'bg-surface-2 text-ink' : 'bg-transparent text-ink-2/60 hover:bg-surface-2'
              }`}
            />
          </td>
        )
    }
    const c = key.startsWith('prop:') ? extraColumns.find((x) => x.name === key.slice(5)) : undefined
    if (!c) return null
    // Selecciones editables directamente en la tabla (con su propia database)
    const sc = db?.schema.find((p) => p.name === c.name)
    const isReminder = !!sc && sc.type === 'date' && db?.mapping.reminderProp === c.name
    const editable = !!sc && sc.editable && (OPTION_PROP_TYPES.includes(sc.type) || isReminder)
    return (
      <td key={key} className={cls} onClick={editable ? stop : undefined}>
        {isReminder ? (
          <ReminderCell value={t.props[c.name]} done={done} onChange={(v) => onEdit({ props: { [c.name]: v } })} />
        ) : editable ? (
          <OptionField db={db} schema={sc} value={t.props[c.name]} onChange={(v) => onEdit({ props: { [c.name]: v } })} />
        ) : (
          <ExtraCell schema={c} value={t.props[c.name]} compact={compact} />
        )}
      </td>
    )
  }
}

// Recordatorio: fecha y hora exactas del aviso, editable en la tabla
function ReminderCell({
  value,
  done,
  onChange
}: {
  value: Task['props'][string]
  done: boolean
  onChange: (v: string | null) => void
}): JSX.Element {
  const at = reminderTime(value)
  const past = at !== null && at <= Date.now()
  const local = toLocalInput(typeof value === 'string' ? value : null)
  const color = !at ? 'text-ink-2/40' : past || done ? 'text-ink-2/60' : 'text-primary'
  return (
    <div
      className="flex items-center gap-1"
      title={at ? `${past ? 'Sonó' : 'Sonará'} ${formatReminder(at)}` : 'Sin recordatorio'}
    >
      <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 ${color}`} fill="currentColor">
        <path d="M12 22a2 2 0 002-2h-4a2 2 0 002 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 00-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
      </svg>
      <input
        type="datetime-local"
        value={local}
        onChange={(e) => onChange(e.target.value ? fromLocalInput(e.target.value) : null)}
        className={`h-7 rounded-full px-2.5 text-xs outline-none transition-colors focus:ring-2 focus:ring-primary ${
          local ? `bg-surface-2 ${past ? 'text-ink-2 line-through decoration-ink-2/40' : 'text-ink'}` : 'bg-transparent text-ink-2/60 hover:bg-surface-2'
        }`}
      />
    </div>
  )
}

// Celda de solo lectura (se edita en el panel lateral). Selects con su color de Notion.
function ExtraCell({
  schema,
  value,
  compact
}: {
  schema: PropSchema
  value: Task['props'][string]
  compact: boolean
}): JSX.Element {
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
  return (
    <span
      className={`block cursor-text select-text text-ink ${
        compact ? 'line-clamp-2 max-w-[260px]' : 'min-w-[160px] max-w-[360px] whitespace-pre-wrap break-words pt-1'
      }`}
    >
      {text}
    </span>
  )
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
  aiAvailable,
  aiOn,
  onToggleAi,
  onAdd
}: {
  activeProject: string
  projects: string[]
  defaultProject: string
  aiAvailable: boolean
  aiOn: boolean
  onToggleAi: () => void
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
      {aiAvailable && <AiToggle on={aiOn} onToggle={onToggleAi} />}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
        }}
        placeholder={
          aiOn
            ? `Describe la tarea con sus datos (cliente, contacto, plan, prioridad…)${project ? ` · «${project}»` : ''}`
            : project
              ? `Nueva tarea en «${project}»…  (! prioridad)`
              : 'Nueva tarea…  (! prioridad)'
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
  onClick,
  onMenu,
  drag
}: {
  children?: React.ReactNode
  className?: string
  sort?: { dir: 'asc' | 'desc'; level: number } | null // level > 0 = posición en un orden múltiple
  onClick?: () => void
  onMenu?: (anchor: HTMLElement) => void // renombrar / opciones / eliminar la columna
  // Arrastrar el encabezado sobre otro para mover la columna
  drag?: {
    dragging: boolean
    dropSide: 'left' | 'right' | null // dónde quedará la columna arrastrada
    onStart: () => void
    onOver: () => void
    onDrop: () => void
    onEnd: () => void
  }
}): JSX.Element {
  const dropCls =
    drag?.dropSide === 'left'
      ? 'shadow-[inset_2px_0_0_rgb(var(--md-primary))]'
      : drag?.dropSide === 'right'
        ? 'shadow-[inset_-2px_0_0_rgb(var(--md-primary))]'
        : ''
  return (
    <th
      draggable={!!drag}
      onDragStart={
        drag
          ? (e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', '')
              drag.onStart()
            }
          : undefined
      }
      onDragOver={
        drag
          ? (e) => {
              e.preventDefault()
              drag.onOver()
            }
          : undefined
      }
      onDrop={
        drag
          ? (e) => {
              e.preventDefault()
              drag.onDrop()
            }
          : undefined
      }
      onDragEnd={drag?.onEnd}
      title={drag ? 'Arrastra para mover la columna' : undefined}
      className={`group/th whitespace-nowrap border-b border-line px-1.5 py-2 font-medium ${
        drag ? 'cursor-grab active:cursor-grabbing' : ''
      } ${drag?.dragging ? 'opacity-40' : ''} ${dropCls} ${className}`}
    >
      <span className="inline-flex items-center">
        {onClick ? (
          <button
            onClick={onClick}
            title={sort ? 'Clic: cambiar dirección o quitar del orden' : 'Ordenar también por esta columna'}
            className={`group inline-flex h-8 items-center gap-1 rounded-full px-1.5 transition-colors hover:bg-ink/5 ${
              sort ? 'text-primary' : ''
            }`}
          >
            {children}
            <svg
              viewBox="0 0 24 24"
              className={`h-4 w-4 transition-all ${sort ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'} ${
                sort?.dir === 'desc' ? 'rotate-180' : ''
              }`}
              fill="currentColor"
            >
              <path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z" />
            </svg>
            {!!sort?.level && (
              <span className="-ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-on-primary">
                {sort.level}
              </span>
            )}
          </button>
        ) : (
          children
        )}
        {onMenu && (
          <button
            onClick={(e) => onMenu(e.currentTarget)}
            title="Opciones de la columna"
            aria-label="Opciones de la columna"
            className="flex h-7 w-7 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-ink/10 focus:opacity-100 group-hover/th:opacity-100"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 2a2 2 0 100 4 2 2 0 000-4zm0 6a2 2 0 100 4 2 2 0 000-4z" />
            </svg>
          </button>
        )}
      </span>
    </th>
  )
}
