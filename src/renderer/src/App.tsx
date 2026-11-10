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
    <div className="relative flex h-full flex-col bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Cabecera (zona arrastrable del panel sin marco) */}
      <header
        className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div>
          <h1 className="text-sm font-semibold">Centro de Tareas</h1>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {pendingCount} pendiente{pendingCount === 1 ? '' : 's'}
          </p>
        </div>
        <div
          className="flex items-center gap-3"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <SyncIndicator />
          <button
            onClick={() => setView('settings')}
            aria-label="Ajustes"
            className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </header>

      {/* Filtros */}
      <div
        className="flex gap-1 px-3 py-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              filter === f.key
                ? 'bg-indigo-600 text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Barra de proyectos */}
      <ProjectBar />

      {/* Lista */}
      <div className="scroll-thin flex-1 overflow-y-auto px-1 pb-2">
        {loading && visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400">Cargando…</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400">
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
