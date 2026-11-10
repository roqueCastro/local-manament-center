import { useState } from 'react'
import { useTasks } from '../store'
import type { Task } from '../../../shared/types'

const priorityColors = ['', 'bg-sky-500', 'bg-amber-500', 'bg-red-500']

function formatDue(due: string | null): string | null {
  if (!due) return null
  const d = new Date(due)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

export function TaskItem({ task }: { task: Task }): JSX.Element {
  const toggle = useTasks((s) => s.toggle)
  const edit = useTasks((s) => s.edit)
  const remove = useTasks((s) => s.remove)
  const projects = useTasks((s) => s.projects)
  const moveTask = useTasks((s) => s.moveTask)

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
    <div className="group flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
      <button
        onClick={() => toggle(task.id)}
        aria-label={done ? 'Marcar pendiente' : 'Completar'}
        className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 transition-colors
          ${done ? 'border-indigo-600 bg-indigo-600' : 'border-gray-400 hover:border-indigo-500'}`}
      >
        {done && (
          <svg viewBox="0 0 24 24" className="h-full w-full text-white" fill="none">
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
            className="w-full bg-transparent text-sm outline-none border-b border-indigo-500 text-gray-900 dark:text-gray-100"
          />
        ) : (
          <div
            onDoubleClick={() => setEditing(true)}
            className={`text-sm leading-snug break-words ${
              done ? 'text-gray-400 line-through' : 'text-gray-900 dark:text-gray-100'
            }`}
          >
            {task.priority > 0 && (
              <span
                className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${priorityColors[task.priority]}`}
                title={`Prioridad ${task.priority}`}
              />
            )}
            {task.title}
          </div>
        )}

        {(due || task.tags.length > 0 || task.project) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {task.project && (
              <span className="rounded bg-violet-100 dark:bg-violet-900/40 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
                📁 {task.project}
              </span>
            )}
            {due && (
              <span className="text-[11px] text-gray-500 dark:text-gray-400">📅 {due}</span>
            )}
            {task.tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-indigo-100 dark:bg-indigo-900/40 px-1.5 py-0.5 text-[11px] text-indigo-700 dark:text-indigo-300"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        {/* Mover de proyecto (aparece al pasar el ratón) */}
        {projects.length > 0 && (
          <select
            value={task.project ?? ''}
            onChange={(e) => moveTask(task.id, e.target.value || null)}
            aria-label="Mover a proyecto"
            title="Mover a proyecto"
            className="opacity-0 group-hover:opacity-100 transition-opacity max-w-[88px] rounded bg-gray-100 dark:bg-gray-800 text-[11px] text-gray-600 dark:text-gray-300 outline-none"
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
          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 7h12M9 7V5h6v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
