import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import type { NewTaskInput, PropValue, Task, TaskPatch } from '../shared/types'

let db: Database.Database

// Fila tal cual vive en SQLite (tags como texto JSON, booleans como 0/1)
interface TaskRow {
  id: string
  notion_id: string | null
  title: string
  status: string
  due_date: string | null
  priority: number
  tags: string | null
  project: string | null
  notion_db: string | null
  props: string | null // JSON: propiedades de Notion
  dirty: string | null // JSON: nombres de propiedades cambiadas localmente sin subir
  created_at: string
  updated_at: string
  synced: number
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    notionId: row.notion_id,
    title: row.title,
    status: row.status === 'done' ? 'done' : 'pending',
    dueDate: row.due_date,
    priority: row.priority,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
    project: row.project,
    notionDb: row.notion_db,
    props: parseJson<Record<string, PropValue>>(row.props, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    synced: row.synced === 1
  }
}

function columnExists(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return cols.some((c) => c.name === column)
}

export function initDb(): void {
  const dbPath = join(app.getPath('userData'), 'tasks.sqlite')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      notion_id   TEXT,
      title       TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      due_date    TEXT,
      priority    INTEGER NOT NULL DEFAULT 0,
      tags        TEXT,
      project     TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      synced      INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_notion ON tasks(notion_id);

    -- Borrados pendientes de archivar en Notion
    CREATE TABLE IF NOT EXISTS tombstones (
      notion_id   TEXT PRIMARY KEY,
      deleted_at  TEXT NOT NULL
    );

    -- Proyectos conocidos (incluye los que aún no tienen tareas)
    CREATE TABLE IF NOT EXISTS projects (
      name TEXT PRIMARY KEY
    );
  `)

  // Migración: añadir 'project' a tablas creadas antes de esta versión
  if (!columnExists('tasks', 'project')) {
    db.exec('ALTER TABLE tasks ADD COLUMN project TEXT')
  }
  // Migración: database de Notion donde vive cada tarea (multi-proyecto)
  if (!columnExists('tasks', 'notion_db')) {
    db.exec('ALTER TABLE tasks ADD COLUMN notion_db TEXT')
  }
  // Migración: todas las propiedades de Notion + cuáles cambiaron localmente
  if (!columnExists('tasks', 'props')) db.exec('ALTER TABLE tasks ADD COLUMN props TEXT')
  if (!columnExists('tasks', 'dirty')) db.exec('ALTER TABLE tasks ADD COLUMN dirty TEXT')
}

export function listTasks(): Task[] {
  const rows = db
    .prepare(
      `SELECT * FROM tasks
       ORDER BY (status = 'done') ASC,
                (due_date IS NULL) ASC,
                due_date ASC,
                priority DESC,
                created_at DESC`
    )
    .all() as TaskRow[]
  return rows.map(rowToTask)
}

export function getTask(id: string): Task | null {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
  return row ? rowToTask(row) : null
}

export function getTaskByNotionId(notionId: string): Task | null {
  const row = db.prepare('SELECT * FROM tasks WHERE notion_id = ?').get(notionId) as
    | TaskRow
    | undefined
  return row ? rowToTask(row) : null
}

export function createTask(input: NewTaskInput): Task {
  const now = new Date().toISOString()
  const task: Task = {
    id: randomUUID(),
    notionId: null,
    title: input.title.trim(),
    status: 'pending',
    dueDate: input.dueDate ?? null,
    priority: input.priority ?? 0,
    tags: input.tags ?? [],
    project: input.project ?? null,
    notionDb: null,
    props: input.props ?? {},
    createdAt: now,
    updatedAt: now,
    synced: false
  }
  db.prepare(
    `INSERT INTO tasks
       (id, notion_id, title, status, due_date, priority, tags, project, props, created_at, updated_at, synced)
     VALUES
       (@id, @notion_id, @title, @status, @due_date, @priority, @tags, @project, @props, @created_at, @updated_at, @synced)`
  ).run({
    id: task.id,
    notion_id: null,
    title: task.title,
    status: task.status,
    due_date: task.dueDate,
    priority: task.priority,
    tags: JSON.stringify(task.tags),
    project: task.project,
    props: JSON.stringify(task.props),
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    synced: 0
  })
  if (task.project) addProject(task.project)
  return task
}

// Aplica cambios locales. `dirtyProps` = propiedades de Notion que hay que subir en el
// próximo sync (se acumulan hasta que se sincroniza).
export function updateTask(id: string, patch: TaskPatch, dirtyProps: string[] = []): Task | null {
  const existing = getTask(id)
  if (!existing) return null
  const row = db.prepare('SELECT dirty FROM tasks WHERE id = ?').get(id) as { dirty: string | null }
  const dirty = new Set([...parseJson<string[]>(row.dirty, []), ...dirtyProps])

  const merged: Task = {
    ...existing,
    title: patch.title !== undefined ? patch.title.trim() : existing.title,
    status: patch.status ?? existing.status,
    dueDate: patch.dueDate !== undefined ? patch.dueDate : existing.dueDate,
    priority: patch.priority ?? existing.priority,
    tags: patch.tags ?? existing.tags,
    project: patch.project !== undefined ? patch.project : existing.project,
    props: patch.props ? { ...existing.props, ...patch.props } : existing.props,
    updatedAt: new Date().toISOString(),
    synced: false // cualquier cambio local queda pendiente de sincronizar
  }

  db.prepare(
    `UPDATE tasks SET
       title = @title,
       status = @status,
       due_date = @due_date,
       priority = @priority,
       tags = @tags,
       project = @project,
       props = @props,
       dirty = @dirty,
       updated_at = @updated_at,
       synced = @synced
     WHERE id = @id`
  ).run({
    id,
    title: merged.title,
    status: merged.status,
    due_date: merged.dueDate,
    priority: merged.priority,
    tags: JSON.stringify(merged.tags),
    project: merged.project,
    props: JSON.stringify(merged.props),
    dirty: JSON.stringify([...dirty]),
    updated_at: merged.updatedAt,
    synced: 0
  })
  if (merged.project) addProject(merged.project)
  return merged
}

export function toggleTask(id: string): Task | null {
  const existing = getTask(id)
  if (!existing) return null
  return updateTask(id, { status: existing.status === 'done' ? 'pending' : 'done' })
}

export function removeTask(id: string): boolean {
  const existing = getTask(id)
  if (!existing) return false
  // Si ya existía en Notion, dejar un tombstone para archivarla en el próximo sync.
  if (existing.notionId) {
    db.prepare(
      'INSERT OR REPLACE INTO tombstones (notion_id, deleted_at) VALUES (?, ?)'
    ).run(existing.notionId, new Date().toISOString())
  }
  const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  return info.changes > 0
}

// ---- Operaciones de sincronización ----

// Tareas con cambios locales pendientes de subir a Notion.
export function getUnsyncedTasks(): Array<{ task: Task; dirty: string[] }> {
  const rows = db.prepare('SELECT * FROM tasks WHERE synced = 0').all() as TaskRow[]
  return rows.map((r) => ({ task: rowToTask(r), dirty: parseJson<string[]>(r.dirty, []) }))
}

// Marca una tarea como sincronizada, fijando su notion_id (y la database donde vive) y
// alineando updated_at con el last_edited_time remoto para que el pull no la vea como "más nueva".
export function markSynced(
  id: string,
  notionId: string,
  remoteUpdatedAt: string,
  notionDb: string
): void {
  db.prepare(
    "UPDATE tasks SET notion_id = ?, updated_at = ?, notion_db = ?, dirty = '[]', synced = 1 WHERE id = ?"
  ).run(notionId, remoteUpdatedAt, notionDb, id)
}

// Reescribe las propiedades (y la lista de cambios pendientes) de las tareas que cumplan
// `match`, sin marcarlas como modificadas: se usa tras cambiar el esquema en Notion
// (renombrar/eliminar columnas u opciones), donde Notion ya tiene el valor correcto.
export function rewriteLocalProps(
  match: (t: Task) => boolean,
  fn: (props: Record<string, PropValue>, dirty: string[]) => { props: Record<string, PropValue>; dirty: string[] }
): number {
  const rows = db.prepare('SELECT * FROM tasks').all() as TaskRow[]
  const upd = db.prepare('UPDATE tasks SET props = ?, dirty = ? WHERE id = ?')
  let n = 0
  const tx = db.transaction(() => {
    for (const r of rows) {
      const t = rowToTask(r)
      if (!match(t)) continue
      const before = JSON.stringify(t.props)
      const beforeDirty = r.dirty ?? '[]'
      const out = fn({ ...t.props }, parseJson<string[]>(r.dirty, []))
      const after = JSON.stringify(out.props)
      const afterDirty = JSON.stringify(out.dirty)
      if (after !== before || afterDirty !== beforeDirty) {
        upd.run(after, afterDirty, t.id)
        n++
      }
    }
  })
  tx()
  return n
}

// Inserta o actualiza una tarea proveniente de Notion (queda como synced=1).
export function upsertFromNotion(data: {
  notionId: string
  title: string
  status: Task['status']
  dueDate: string | null
  priority: number
  tags: string[]
  project: string | null
  notionDb: string
  props: Record<string, PropValue>
  updatedAt: string
}): void {
  const existing = getTaskByNotionId(data.notionId)
  const now = new Date().toISOString()
  if (existing) {
    db.prepare(
      `UPDATE tasks SET title=@title, status=@status, due_date=@due_date,
         priority=@priority, tags=@tags, project=@project, notion_db=@notion_db,
         props=@props, dirty='[]', updated_at=@updated_at, synced=1
       WHERE notion_id=@notion_id`
    ).run({
      notion_id: data.notionId,
      title: data.title,
      status: data.status,
      due_date: data.dueDate,
      priority: data.priority,
      tags: JSON.stringify(data.tags),
      project: data.project,
      notion_db: data.notionDb,
      props: JSON.stringify(data.props),
      updated_at: data.updatedAt
    })
  } else {
    db.prepare(
      `INSERT INTO tasks
         (id, notion_id, title, status, due_date, priority, tags, project, notion_db, props, dirty, created_at, updated_at, synced)
       VALUES
         (@id, @notion_id, @title, @status, @due_date, @priority, @tags, @project, @notion_db, @props, '[]', @created_at, @updated_at, 1)`
    ).run({
      id: randomUUID(),
      notion_id: data.notionId,
      title: data.title,
      status: data.status,
      due_date: data.dueDate,
      priority: data.priority,
      tags: JSON.stringify(data.tags),
      project: data.project,
      notion_db: data.notionDb,
      props: JSON.stringify(data.props),
      created_at: now,
      updated_at: data.updatedAt
    })
  }
  if (data.project) addProject(data.project)
}

// Borra una tarea local por notion_id SIN crear tombstone (la página ya no está en Notion).
export function removeByNotionId(notionId: string): void {
  db.prepare('DELETE FROM tasks WHERE notion_id = ?').run(notionId)
}

export function getTombstones(): { notionId: string; deletedAt: string }[] {
  const rows = db.prepare('SELECT notion_id, deleted_at FROM tombstones').all() as {
    notion_id: string
    deleted_at: string
  }[]
  return rows.map((r) => ({ notionId: r.notion_id, deletedAt: r.deleted_at }))
}

export function removeTombstone(notionId: string): void {
  db.prepare('DELETE FROM tombstones WHERE notion_id = ?').run(notionId)
}

// Conjunto de notion_ids presentes localmente (para detectar borrados remotos).
export function getAllNotionIds(): Set<string> {
  const rows = db
    .prepare("SELECT notion_id FROM tasks WHERE notion_id IS NOT NULL")
    .all() as { notion_id: string }[]
  return new Set(rows.map((r) => r.notion_id))
}

// ---- Proyectos ----

export function addProject(name: string): void {
  const clean = name.trim()
  if (!clean) return
  db.prepare('INSERT OR IGNORE INTO projects (name) VALUES (?)').run(clean)
}

// Lista de proyectos: unión de los registrados y los usados por tareas.
export function listProjects(): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM projects
       UNION
       SELECT DISTINCT project AS name FROM tasks WHERE project IS NOT NULL AND project <> ''
       ORDER BY name COLLATE NOCASE`
    )
    .all() as { name: string }[]
  return rows.map((r) => r.name)
}
