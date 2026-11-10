import { useState } from 'react'
import { useTasks } from '../store'

export function ProjectBar(): JSX.Element | null {
  const projects = useTasks((s) => s.projects)
  const active = useTasks((s) => s.activeProject)
  const setActive = useTasks((s) => s.setActiveProject)
  const newProject = useTasks((s) => s.newProject)
  // Con Notion conectado, los proyectos son las databases compartidas: se crean en Notion.
  const notionConnected = useTasks((s) => s.notion?.connected ?? false)

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

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
      title={label}
      className={`chip max-w-[180px] ${active === value ? 'chip-on' : ''}`}
    >
      {active === value && (
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <span className="truncate">{label}</span>
    </button>
  )

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto scroll-thin px-4 pb-2"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {chip('Todos', '')}
      {projects.map((p) => chip(p, p))}

      {notionConnected ? null : creating ? (
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
          className="h-8 w-28 shrink-0 rounded-full bg-surface-2 px-3 text-[13px] outline-none focus:ring-2 focus:ring-primary"
        />
      ) : (
        <button onClick={() => setCreating(true)} aria-label="Nuevo proyecto" className="chip">
          + Proyecto
        </button>
      )}
    </div>
  )
}
