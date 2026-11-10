import { useState } from 'react'
import { useTasks } from '../store'
import type { Task } from '../../../shared/types'

import { chipClass, dotClass, PRIORITY_LEVELS } from '../ui/colors'

function formatDue(due: string | null): string | null {
  if (!due) return null
  const d = /^\d{4}-\d{2}-\d{2}$/.test(due) ? new Date(`${due}T00:00:00`) : new Date(due)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

export function TaskItem({ task }: { task: Task }): JSX.Element {
  const toggle = useTasks((s) => s.toggle)
  const edit = useTasks((s) => s.edit)
  const remove = useTasks((s) => s.remove)
  const projects = useTasks((s) => s.projects)
  const moveTask = useTasks((s) => s.moveTask)
  const notion = useTasks((s) => s.notion)

  // Estado de Notion (ej. "En curso") con su color, si la database lo tiene
  const db = notion?.databases.find((d) => d.id === task.notionDb)
  const statusName = db?.mapping.statusProp ? task.props[db.mapping.statusProp] : null
  const statusColor =
    typeof statusName === 'string'
      ? db?.schema.find((p) => p.name === db.mapping.statusProp)?.colors?.[statusName]
      : undefined

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.title)

  const done = task.status === 'done'
  const due = formatDue(task.dueDate)

  async function commit(): Promise<void> {
    const t = draft.trim()
    if (t && t !== task.title) await edit(task.id, { title: t })
    else setDraft(task.title)
    setEditing(false)
  }

  return (
    <div className="group mx-2 flex items-start gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-ink/5">
      <button
        onClick={() => toggle(task.id)}
        aria-label={done ? 'Marcar pendiente' : 'Completar'}
        className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 p-0.5 transition-colors
          ${done ? 'border-primary bg-primary text-on-primary' : 'border-ink-2/60 hover:border-primary'}`}
      >
        {done && (
          <svg viewBox="0 0 24 24" className="h-full w-full" fill="none">
            <path d="M5 12l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(task.title)
                setEditing(false)
              }
            }}
            className="w-full rounded-md bg-card px-1 text-sm text-ink outline-none ring-2 ring-primary"
          />
        ) : (
          <div
            onDoubleClick={() => setEditing(true)}
            className={`text-sm leading-snug break-words ${
              done ? 'text-ink-2/70 line-through' : 'text-ink'
            }`}
          >
            {task.priority > 0 && (
              <span
                className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${dotClass(PRIORITY_LEVELS[task.priority]?.color)}`}
                title={`Prioridad ${PRIORITY_LEVELS[task.priority]?.label ?? ''}`}
              />
            )}
            {task.title}
          </div>
        )}

        {(due || task.tags.length > 0 || task.project || statusName) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {typeof statusName === 'string' && statusName && (
              <span
                className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium ${chipClass(statusColor)}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${dotClass(statusColor)}`} />
                {statusName}
              </span>
            )}
            {task.project && (
              <span className={`inline-flex h-5 max-w-[160px] items-center truncate rounded-full px-2 text-[11px] font-medium ${chipClass('purple')}`}>
                {task.project}
              </span>
            )}
            {due && (
              <span className="inline-flex h-5 items-center gap-1 rounded-full bg-surface-2 px-2 text-[11px] text-ink-2">
                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
                  <path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V9h14v11z" />
                </svg>
                {due}
              </span>
            )}
            {task.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex h-5 items-center rounded-full bg-primary-soft px-2 text-[11px] text-on-primary-soft"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Acciones: solo al pasar el ratón, para que el título use todo el ancho */}
      <div className="hidden items-center gap-1 group-hover:flex">
        {/* Mover de proyecto */}
        {projects.length > 0 && (
          <select
            value={task.project ?? ''}
            onChange={(e) => moveTask(task.id, e.target.value || null)}
            aria-label="Mover a proyecto"
            title="Mover a proyecto"
            className="max-w-[96px] rounded-full bg-surface-2 px-2 py-1 text-[11px] text-ink-2 outline-none"
          >
            <option value="">(sin proyecto)</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => remove(task.id)}
          aria-label="Borrar"
          className="icon-btn h-8 w-8 hover:text-danger"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 7h12M9 7V5h6v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
