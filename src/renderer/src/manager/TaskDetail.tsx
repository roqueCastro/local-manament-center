import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTasks } from '../store'
import type { NotionDatabaseSummary, PropSchema, PropValue, Task } from '../../../shared/types'
import { PropEditor, formatDate } from './PropEditor'
import { ChipSelect } from '../ui/ChipSelect'
import { PRIORITY_LEVELS } from '../ui/colors'
import { Popover } from '../ui/Popover'
import { ColumnMenu, NewPropertyForm } from './ColumnMenus'

interface Props {
  task: Task
  db: NotionDatabaseSummary | undefined
  onClose: () => void
}

// Panel lateral con TODAS las propiedades de la tarea, editables según su tipo.
export function TaskDetail({ task, db, onClose }: Props): JSX.Element {
  const edit = useTasks((s) => s.edit)
  const remove = useTasks((s) => s.remove)
  const moveTask = useTasks((s) => s.moveTask)
  const projects = useTasks((s) => s.projects)

  const [title, setTitle] = useState(task.title)
  useEffect(() => setTitle(task.title), [task.id, task.title])
  // El título crece con su contenido (sin cortar textos largos)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [title])
  // Menú de una columna (al pulsar su nombre) o formulario de columna nueva
  const [colMenu, setColMenu] = useState<{ prop: string | null; anchor: HTMLElement } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => setConfirmDelete(false), [task.id])

  const commitTitle = (): void => {
    const t = title.trim()
    if (t && t !== task.title) void edit(task.id, { title: t })
    else setTitle(task.title)
  }

  const setProp = (name: string, value: PropValue): void => {
    void edit(task.id, { props: { [name]: value } })
  }

  // Todas las columnas menos el título (que va arriba)
  const fields: PropSchema[] = (db?.schema ?? []).filter((p) => p.type !== 'title')
  const done = task.status === 'done'

  return (
    <aside className="m-3 ml-0 flex w-[440px] shrink-0 flex-col overflow-hidden rounded-[28px] bg-card shadow-elev-1">
      <div className="flex items-start gap-3 px-5 pb-3 pt-5">
        <button
          onClick={() => edit(task.id, { status: done ? 'pending' : 'done' })}
          title={done ? 'Marcar pendiente' : 'Marcar como hecha'}
          className={`mt-1 h-6 w-6 shrink-0 rounded-full border-2 p-0.5 transition-colors ${
            done ? 'border-primary bg-primary text-on-primary' : 'border-ink-2/60 hover:border-primary'
          }`}
        >
          {done && (
            <svg viewBox="0 0 24 24" className="h-full w-full" fill="none">
              <path d="M5 12l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
        </button>
        <textarea
          ref={titleRef}
          value={title}
          rows={1}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLTextAreaElement).blur()
            }
            if (e.key === 'Escape') setTitle(task.title)
          }}
          className="scroll-thin max-h-[40vh] flex-1 resize-none overflow-y-auto rounded-lg bg-transparent px-1 text-xl font-normal leading-snug text-ink outline-none focus:bg-surface-1"
        />
        <button onClick={onClose} aria-label="Cerrar" className="icon-btn -mr-2 -mt-1">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="scroll-thin flex-1 space-y-1 overflow-y-auto px-5 pb-4 select-text">
        {projects.length > 0 && (
          <Field label="Proyecto">
            <ChipSelect
              value={task.project}
              placeholder="Sin proyecto"
              options={projects.map((p) => ({ value: p, label: p, color: 'purple' }))}
              onChange={(v) => v && moveTask(task.id, v)}
            />
          </Field>
        )}

        {fields.length > 0 ? (
          fields.map((f) => (
            <Field
              key={f.name}
              label={f.name}
              hint={f.editable ? undefined : 'solo lectura'}
              onLabelClick={db ? (anchor) => setColMenu({ prop: f.name, anchor }) : undefined}
            >
              <PropEditor
                schema={f}
                db={db}
                value={task.props[f.name]}
                onChange={(v) => setProp(f.name, v)}
              />
            </Field>
          ))
        ) : (
          // Sin Notion: campos básicos
          <>
            <Field label="Fecha límite">
              <input
                type="date"
                value={task.dueDate?.slice(0, 10) ?? ''}
                onChange={(e) => edit(task.id, { dueDate: e.target.value || null })}
                className="field"
              />
            </Field>
            <Field label="Prioridad">
              <ChipSelect
                value={String(task.priority)}
                options={PRIORITY_LEVELS.map((p) => ({
                  value: String(p.value),
                  label: p.label,
                  color: p.color
                }))}
                onChange={(v) => edit(task.id, { priority: Number(v ?? 0) })}
              />
            </Field>
          </>
        )}

        {db && (
          <button
            onClick={(e) => setColMenu({ prop: null, anchor: e.currentTarget })}
            className="btn btn-sm btn-text -ml-2 mt-1"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
            Agregar columna
          </button>
        )}

        <p className="pt-3 text-xs text-ink-2">
          Creada {formatDate(task.createdAt)} ·{' '}
          {task.synced ? 'sincronizada con Notion' : 'pendiente de sincronizar'}
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 px-4 pb-4 pt-2">
        {confirmDelete ? (
          <>
            <span className="mr-auto pl-1 text-xs text-ink-2">¿Borrar? Se archivará en Notion.</span>
            <button onClick={() => setConfirmDelete(false)} className="btn btn-sm btn-text">
              Cancelar
            </button>
            <button
              onClick={() => {
                void remove(task.id)
                onClose()
              }}
              className="btn btn-sm btn-danger"
            >
              Borrar
            </button>
          </>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="btn btn-danger">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
            </svg>
            Borrar tarea
          </button>
        )}
      </div>

      {colMenu && db && (
        <Popover anchor={colMenu.anchor} onClose={() => setColMenu(null)} width={colMenu.prop ? 280 : 320}>
          {colMenu.prop ? (
            (() => {
              const sc = db.schema.find((p) => p.name === colMenu.prop)
              return sc ? <ColumnMenu db={db} schema={sc} onDone={() => setColMenu(null)} /> : null
            })()
          ) : (
            <NewPropertyForm db={db} onDone={() => setColMenu(null)} />
          )}
        </Popover>
      )}
    </aside>
  )
}

function Field({
  label,
  hint,
  onLabelClick,
  children
}: {
  label: string
  hint?: string
  onLabelClick?: (anchor: HTMLElement) => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="grid grid-cols-[130px_1fr] items-start gap-3 rounded-xl py-1.5">
      {onLabelClick ? (
        <button
          type="button"
          onClick={(e) => onLabelClick(e.currentTarget)}
          title="Renombrar, editar opciones o eliminar esta columna"
          className="-ml-2 truncate rounded-lg px-2 pb-1 pt-1.5 text-left text-[13px] text-ink-2 hover:bg-ink/5"
        >
          {label}
          {hint && <span className="block text-[10px] text-ink-2/70">{hint}</span>}
        </button>
      ) : (
        <p className="truncate pt-1.5 text-[13px] text-ink-2" title={label}>
          {label}
          {hint && <span className="block text-[10px] text-ink-2/70">{hint}</span>}
        </p>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  )
}
