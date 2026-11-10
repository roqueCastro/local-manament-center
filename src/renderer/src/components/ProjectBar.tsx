import { useState } from 'react'
import { useTasks } from '../store'

export function ProjectBar(): JSX.Element | null {
  const projects = useTasks((s) => s.projects)
  const active = useTasks((s) => s.activeProject)
  const setActive = useTasks((s) => s.setActiveProject)
  const newProject = useTasks((s) => s.newProject)

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  // Si no hay proyectos todavía, mostrar solo el botón de crear
  async function create(): Promise<void> {
    const n = name.trim()
    if (n) await newProject(n)
    setName('')
    setCreating(false)
  }

  const chip = (label: string, value: string): JSX.Element => (
    <button
      key={value || '__all__'}
      onClick={() => setActive(value)}
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
        active === value
          ? 'bg-indigo-600 text-white'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div
      className="flex items-center gap-1.5 overflow-x-auto scroll-thin px-3 pb-1"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {chip('Todos', '')}
      {projects.map((p) => chip(p, p))}

      {creating ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={create}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create()
            if (e.key === 'Escape') {
              setName('')
              setCreating(false)
            }
          }}
          placeholder="Proyecto…"
          className="shrink-0 w-24 rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
        />
      ) : (
        <button
          onClick={() => setCreating(true)}
          aria-label="Nuevo proyecto"
          className="shrink-0 rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-1 text-xs text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          +
        </button>
      )}
    </div>
  )
}
