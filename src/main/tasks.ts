import type { NewTaskInput, PropValue, Task, TaskPatch } from '../shared/types'
import { createTask, getTask, updateTask } from './db'
import { corePropValues, isDoneStatus, priorityFromOption } from './notion'
import { getActiveDatabases, getNotionDatabases, getNotionSettings, type NotionDatabase } from './settings'

// Capa entre el IPC y SQLite: mantiene coherentes los campos "principales" de la tarea
// (título, estado, fecha, prioridad, etiquetas) con las propiedades de Notion que los
// representan (ej. "Estado" = "En curso", "Prioridad" = "Alta").

type CoreField = 'title' | 'status' | 'dueDate' | 'priority' | 'tags'
const CORE_FIELDS: CoreField[] = ['title', 'status', 'dueDate', 'priority', 'tags']

// Database de una tarea: donde vive, o la de su proyecto, o la por defecto.
export function databaseFor(t: Pick<Task, 'notionDb' | 'project'>): NotionDatabase | undefined {
  const all = getNotionDatabases()
  if (t.notionDb) {
    const d = all.find((x) => x.id === t.notionDb)
    if (d) return d
  }
  if (t.project) {
    const d = all.find((x) => x.title.toLowerCase() === t.project!.toLowerCase())
    if (d) return d
  }
  const defaultId = getNotionSettings().databaseId
  return all.find((x) => x.id === defaultId) ?? getActiveDatabases()[0]
}

const asString = (v: PropValue | undefined): string | null =>
  v === null || v === undefined ? null : Array.isArray(v) ? v.join(', ') : String(v)

// Cambios en propiedades de Notion → campos principales equivalentes.
function coreFromProps(changes: Record<string, PropValue>, db: NotionDatabase): TaskPatch {
  const m = db.mapping
  const out: TaskPatch = {}
  for (const [name, value] of Object.entries(changes)) {
    if (name === m.title) {
      const t = asString(value)?.trim()
      if (t) out.title = t
    } else if (name === m.statusProp) {
      out.status =
        m.statusKind === 'checkbox'
          ? value === true
            ? 'done'
            : 'pending'
          : isDoneStatus(asString(value), m)
            ? 'done'
            : 'pending'
    } else if (name === m.dueProp) {
      out.dueDate = asString(value)
    } else if (name === m.priorityProp) {
      out.priority =
        m.priorityKind === 'select'
          ? priorityFromOption(asString(value), m)
          : Math.max(0, Math.min(3, Math.round(Number(value) || 0)))
    } else if (name === m.tagsProp) {
      out.tags = Array.isArray(value) ? value : []
    }
  }
  return out
}

// Fecha de creación automática: si la database tiene una columna de fecha "creación".
function creationDateProp(db: NotionDatabase): string | null {
  const p = (db.schema ?? []).find((s) => s.type === 'date' && /creaci|created/i.test(s.name))
  return p?.name ?? null
}

export function createTaskSvc(input: NewTaskInput): Task {
  const db = databaseFor({ notionDb: null, project: input.project ?? null })
  let props: Record<string, PropValue> = { ...(input.props ?? {}) }
  let core: NewTaskInput = { ...input }
  if (db) {
    // Las propiedades indicadas mandan sobre los campos principales…
    core = { ...core, ...coreFromProps(props, db) } as NewTaskInput
    // …y los campos principales se reflejan en sus propiedades.
    const base = corePropValues(
      {
        title: core.title,
        status: 'pending',
        dueDate: core.dueDate ?? null,
        priority: core.priority ?? 0,
        tags: core.tags ?? []
      },
      db.mapping
    )
    props = { ...base, ...props }
    const created = creationDateProp(db)
    if (created && !props[created]) {
      // Fecha local (toISOString daría el día siguiente por la noche, al estar en UTC)
      const d = new Date()
      const pad = (n: number): string => String(n).padStart(2, '0')
      props[created] = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }
  }
  return createTask({ ...core, project: core.project ?? db?.title ?? null, props })
}

export function updateTaskSvc(id: string, patch: TaskPatch): Task | null {
  const existing = getTask(id)
  if (!existing) return null
  const db = databaseFor(existing)
  if (!db) return updateTask(id, patch)

  const propChanges: Record<string, PropValue> = { ...(patch.props ?? {}) }
  // Propiedad → campo principal (ej. Estado "Lista" → hecha)
  const fromProps = coreFromProps(propChanges, db)
  // Campo principal → propiedad (ej. marcar hecha → Estado "Lista")
  const coreChanged = CORE_FIELDS.filter((f) => patch[f] !== undefined)
  const merged = { ...existing, ...fromProps, ...patch }
  const fromCore = corePropValues(merged, db.mapping, coreChanged)
  // Si se eligió una opción concreta de estado, no pisarla con la genérica
  if (db.mapping.statusProp && propChanges[db.mapping.statusProp] !== undefined) {
    delete fromCore[db.mapping.statusProp]
  }

  const props = { ...fromCore, ...propChanges }
  const { props: _ignored, ...corePatch } = patch
  return updateTask(id, { ...fromProps, ...corePatch, props }, Object.keys(props))
}

export function toggleTaskSvc(id: string): Task | null {
  const existing = getTask(id)
  if (!existing) return null
  return updateTaskSvc(id, { status: existing.status === 'done' ? 'pending' : 'done' })
}
