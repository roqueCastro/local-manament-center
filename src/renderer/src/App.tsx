import { useEffect, useMemo } from 'react'
import { useTasks } from './store'
import { TaskItem } from './components/TaskItem'
import { QuickAdd } from './components/QuickAdd'
import { Settings } from './components/Settings'
import { SyncIndicator } from './components/SyncIndicator'
import { ProjectBar } from './components/ProjectBar'
import { VoiceReview } from './components/VoiceReview'

const filters = [
  { key: 'pending', label: 'Pendientes' },
  { key: 'done', label: 'Hechas' },
  { key: 'all', label: 'Todas' }
] as const

export default function App(): JSX.Element {
  const {
    tasks,
    filter,
    loading,
    view,
    activeProject,
    voiceState,
    load,
    loadConnection,
    loadProjects,
    loadAiStatus,
    setFilter,
    setView,
    setSyncState
  } = useTasks()

  // Fijar el panel (no ocultar al perder foco) en Ajustes o durante el dictado por voz
  useEffect(() => {
    window.api?.setPinned?.(view === 'settings' || voiceState !== 'idle')
  }, [view, voiceState])

  useEffect(() => {
    if (!window.api) {
      // El preload no se inyectó: evita pantalla en blanco y lo deja visible.
      // eslint-disable-next-line no-console
      console.error('window.api no está disponible (preload no cargado)')
      return
    }
    void load()
    void loadConnection()
    void loadProjects()
    void loadAiStatus()
    // Suscripciones a eventos del main (sync)
    window.api.onChanged?.(() => {
      void load()
      void loadConnection()
      void loadProjects()
    })
    window.api.onSyncState?.((s) => setSyncState(s))
    return () => {
      window.api.offChanged?.()
      window.api.offSyncState?.()
    }
  }, [load, loadConnection, loadProjects, loadAiStatus, setSyncState])

  const visible = useMemo(() => {
    return tasks.filter((t) => {
      const statusOk = filter === 'all' || t.status === filter
      const projectOk = !activeProject || t.project === activeProject
      return statusOk && projectOk
    })
  }, [tasks, filter, activeProject])

  const pendingCount = tasks.filter(
    (t) => t.status === 'pending' && (!activeProject || t.project === activeProject)
  ).length

  if (view === 'settings') return <Settings />

  return (
    <div className="relative flex h-full flex-col bg-surface text-ink">
      {/* Cabecera (zona arrastrable del panel sin marco) */}
      <header
        className="flex items-center justify-between px-4 pb-2 pt-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div>
          <h1 className="text-[17px] font-normal">Centro de Tareas</h1>
          <p className="text-xs text-ink-2">
            {pendingCount} pendiente{pendingCount === 1 ? '' : 's'}
          </p>
        </div>
        <div
          className="flex items-center gap-0.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <SyncIndicator />
          <button
            onClick={() => window.api.openManager()}
            aria-label="Abrir gestor de tareas"
            title="Abrir gestor de tareas (vista ampliada)"
            className="icon-btn"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z" />
            </svg>
          </button>
          <button onClick={() => setView('settings')} aria-label="Ajustes" title="Ajustes" className="icon-btn">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M19.14 12.94a7.07 7.07 0 000-1.88l2.03-1.58a.48.48 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7 7 0 00-1.62-.94l-.36-2.54A.48.48 0 0013.93 2h-3.84a.48.48 0 00-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.48.48 0 00-.59.22L2.73 8.87a.47.47 0 00.12.61l2.03 1.58a7.4 7.4 0 000 1.88l-2.03 1.58a.48.48 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 00-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Filtros */}
      <div
        className="flex gap-2 px-4 pb-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`chip ${filter === f.key ? 'chip-on' : ''}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Barra de proyectos */}
      <ProjectBar />

      {/* Lista */}
      <div className="scroll-thin flex-1 overflow-y-auto pb-2 pt-1">
        {loading && visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-2">Cargando…</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-2">
            {filter === 'done' ? 'Aún no completaste tareas.' : 'Sin tareas. ¡Añadí una abajo!'}
          </p>
        ) : (
          visible.map((task) => <TaskItem key={task.id} task={task} />)
        )}
      </div>

      {/* Entrada rápida */}
      <QuickAdd />

      {/* Revisión de tareas dictadas por voz (overlay) */}
      <VoiceReview />
    </div>
  )
}
