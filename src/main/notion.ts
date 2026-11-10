import type { Task } from '../shared/types'
import type { NotionMapping } from './settings'

const API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

// Una página de Notion tal como la necesitamos (campos relevantes)
interface NotionPage {
  id: string
  last_edited_time: string
  archived: boolean
  properties: Record<string, any>
}

export class NotionError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function call(
  token: string,
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  body?: unknown
): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new NotionError(res.status, data?.code ?? 'unknown', data?.message ?? res.statusText)
  }
  return data
}

// ---- Auto-descubrimiento del esquema ----

function pickByName<T extends { name: string }>(items: T[], regex: RegExp): T | undefined {
  return items.find((i) => regex.test(i.name))
}

interface SchemaEntry {
  name: string
  type: string
  def: any
}

export async function retrieveAndMap(
  token: string,
  databaseId: string
): Promise<{ title: string; mapping: NotionMapping; projectOptions: string[] }> {
  const db = await call(token, `/databases/${databaseId}`, 'GET')
  const dbTitle: string = (db.title ?? []).map((t: any) => t.plain_text).join('') || 'Database'

  const props = db.properties as Record<string, any>
  const entries: SchemaEntry[] = Object.entries(props).map(([name, def]: [string, any]) => ({
    name,
    type: def.type as string,
    def
  }))

  // title (siempre existe exactamente una)
  const titleName = entries.find((e) => e.type === 'title')?.name ?? 'Name'

  // Proyecto: select o multi_select cuyo nombre sea "Proyecto"/"Project"
  const projectCandidates = entries.filter(
    (e) => e.type === 'select' || e.type === 'multi_select'
  )
  const projectEntry = pickByName(projectCandidates, /proyect|project/i)
  let projectProp: string | null = null
  let projectKind: NotionMapping['projectKind'] = null
  let projectOptions: string[] = []
  if (projectEntry) {
    projectProp = projectEntry.name
    projectKind = projectEntry.type as 'select' | 'multi_select'
    projectOptions = (projectEntry.def[projectEntry.type]?.options ?? []).map(
      (o: any) => o.name as string
    )
  }

  // status: preferir 'status' > 'checkbox' > 'select' (excluyendo la prop de proyecto)
  const statusCandidates = entries.filter(
    (e) => ['status', 'checkbox', 'select'].includes(e.type) && e.name !== projectProp
  )
  const statusEntry =
    pickByName(statusCandidates, /status|estado/i) ??
    statusCandidates.find((e) => e.type === 'status') ??
    statusCandidates.find((e) => e.type === 'checkbox') ??
    statusCandidates.find((e) => e.type === 'select')

  let statusProp: string | null = null
  let statusKind: NotionMapping['statusKind'] = null
  let statusDoneName: string | null = null
  let statusPendingName: string | null = null

  if (statusEntry) {
    statusProp = statusEntry.name
    statusKind = statusEntry.type as NotionMapping['statusKind']

    if (statusEntry.type === 'status') {
      const options: any[] = statusEntry.def.status?.options ?? []
      const groups: any[] = statusEntry.def.status?.groups ?? []
      const nameOf = (id: string): string | null =>
        options.find((o) => o.id === id)?.name ?? null
      const doneGroup =
        groups.find((g) => /complet|done|hecho|termin|finaliz/i.test(g.name)) ??
        groups.find((g) => g.color === 'green')
      const pendingGroup =
        groups.find((g) => /to-?do|pend|sin|not started|backlog|nuev/i.test(g.name)) ?? groups[0]
      statusDoneName =
        (doneGroup?.option_ids?.[0] && nameOf(doneGroup.option_ids[0])) ??
        pickByName(options, /done|complet|hecho|termin|finaliz/i)?.name ??
        null
      statusPendingName =
        (pendingGroup?.option_ids?.[0] && nameOf(pendingGroup.option_ids[0])) ??
        options.find((o) => o.name !== statusDoneName)?.name ??
        null
    } else if (statusEntry.type === 'select') {
      const options: any[] = statusEntry.def.select?.options ?? []
      statusDoneName = pickByName(options, /done|complet|hecho|termin|finaliz/i)?.name ?? null
      statusPendingName =
        pickByName(options, /to-?do|pend|sin|nuev|abiert/i)?.name ??
        options.find((o) => o.name !== statusDoneName)?.name ??
        null
    }
  }

  const dueEntry =
    pickByName(entries.filter((e) => e.type === 'date'), /due|venc|fecha|date|limit/i) ??
    entries.find((e) => e.type === 'date')

  const priorityEntry =
    pickByName(entries.filter((e) => e.type === 'number'), /prior|import/i) ??
    entries.find((e) => e.type === 'number')

  // Etiquetas: multi_select que NO sea la propiedad de proyecto
  const tagCandidates = entries.filter(
    (e) => e.type === 'multi_select' && e.name !== projectProp
  )
  const tagsEntry =
    pickByName(tagCandidates, /tag|etiqueta|label|categor/i) ?? tagCandidates[0]

  const mapping: NotionMapping = {
    title: titleName,
    statusProp,
    statusKind,
    statusDoneName,
    statusPendingName,
    dueProp: dueEntry?.name ?? null,
    priorityProp: priorityEntry?.name ?? null,
    tagsProp: tagsEntry?.name ?? null,
    projectProp,
    projectKind
  }

  return { title: dbTitle, mapping, projectOptions }
}

// Lee las opciones actuales de la propiedad de proyecto desde el esquema.
export async function fetchProjectOptions(
  token: string,
  databaseId: string,
  mapping: NotionMapping
): Promise<string[]> {
  if (!mapping.projectProp || !mapping.projectKind) return []
  const db = await call(token, `/databases/${databaseId}`, 'GET')
  const def = db.properties?.[mapping.projectProp]
  const options = def?.[mapping.projectKind]?.options ?? []
  return options.map((o: any) => o.name as string)
}

// Añade una opción (proyecto) a la propiedad select/multi_select en Notion.
export async function addProjectOption(
  token: string,
  databaseId: string,
  mapping: NotionMapping,
  name: string
): Promise<void> {
  if (!mapping.projectProp || !mapping.projectKind) return
  const current = await fetchProjectOptions(token, databaseId, mapping)
  if (current.includes(name)) return
  const options = [...current, name].map((n) => ({ name: n }))
  await call(token, `/databases/${databaseId}`, 'PATCH', {
    properties: {
      [mapping.projectProp]: { [mapping.projectKind]: { options } }
    }
  })
}

// ---- Conversión Task <-> Notion ----

export function taskDataFromPage(
  page: NotionPage,
  mapping: NotionMapping
): {
  notionId: string
  title: string
  status: Task['status']
  dueDate: string | null
  priority: number
  tags: string[]
  project: string | null
  updatedAt: string
} {
  const p = page.properties

  const title =
    (p[mapping.title]?.title ?? []).map((t: any) => t.plain_text).join('') || '(sin título)'

  let status: Task['status'] = 'pending'
  if (mapping.statusProp && mapping.statusKind) {
    const sp = p[mapping.statusProp]
    if (mapping.statusKind === 'checkbox') {
      status = sp?.checkbox ? 'done' : 'pending'
    } else if (mapping.statusKind === 'status') {
      const name = sp?.status?.name ?? null
      status =
        name && (name === mapping.statusDoneName || /done|complet|hecho|termin/i.test(name))
          ? 'done'
          : 'pending'
    } else if (mapping.statusKind === 'select') {
      const name = sp?.select?.name ?? null
      status =
        name && (name === mapping.statusDoneName || /done|complet|hecho|termin/i.test(name))
          ? 'done'
          : 'pending'
    }
  }

  const dueDate = mapping.dueProp ? (p[mapping.dueProp]?.date?.start ?? null) : null
  const priorityRaw = mapping.priorityProp ? (p[mapping.priorityProp]?.number ?? 0) : 0
  const priority = Math.max(0, Math.min(3, Math.round(priorityRaw)))
  const tags = mapping.tagsProp
    ? ((p[mapping.tagsProp]?.multi_select ?? []).map((o: any) => o.name) as string[])
    : []

  // Proyecto: para multi_select tomamos el primer valor (un proyecto por tarea)
  let project: string | null = null
  if (mapping.projectProp && mapping.projectKind) {
    const pp = p[mapping.projectProp]
    if (mapping.projectKind === 'select') {
      project = pp?.select?.name ?? null
    } else {
      project = pp?.multi_select?.[0]?.name ?? null
    }
  }

  return {
    notionId: page.id,
    title,
    status,
    dueDate,
    priority,
    tags,
    project,
    updatedAt: page.last_edited_time
  }
}

function propertiesFromTask(task: Task, mapping: NotionMapping): Record<string, any> {
  const props: Record<string, any> = {
    [mapping.title]: { title: [{ text: { content: task.title } }] }
  }

  if (mapping.statusProp && mapping.statusKind) {
    if (mapping.statusKind === 'checkbox') {
      props[mapping.statusProp] = { checkbox: task.status === 'done' }
    } else if (mapping.statusKind === 'status') {
      const name = task.status === 'done' ? mapping.statusDoneName : mapping.statusPendingName
      if (name) props[mapping.statusProp] = { status: { name } }
    } else if (mapping.statusKind === 'select') {
      const name = task.status === 'done' ? mapping.statusDoneName : mapping.statusPendingName
      props[mapping.statusProp] = { select: name ? { name } : null }
    }
  }

  if (mapping.dueProp) {
    props[mapping.dueProp] = { date: task.dueDate ? { start: task.dueDate } : null }
  }
  if (mapping.priorityProp) {
    props[mapping.priorityProp] = { number: task.priority }
  }
  if (mapping.tagsProp) {
    props[mapping.tagsProp] = { multi_select: task.tags.map((name) => ({ name })) }
  }
  if (mapping.projectProp && mapping.projectKind) {
    if (mapping.projectKind === 'select') {
      props[mapping.projectProp] = { select: task.project ? { name: task.project } : null }
    } else {
      props[mapping.projectProp] = {
        multi_select: task.project ? [{ name: task.project }] : []
      }
    }
  }

  return props
}

// ---- Operaciones ----

export async function createPage(
  token: string,
  databaseId: string,
  task: Task,
  mapping: NotionMapping
): Promise<{ id: string; updatedAt: string }> {
  const data = await call(token, '/pages', 'POST', {
    parent: { database_id: databaseId },
    properties: propertiesFromTask(task, mapping)
  })
  return { id: data.id, updatedAt: data.last_edited_time }
}

export async function updatePage(
  token: string,
  pageId: string,
  task: Task,
  mapping: NotionMapping
): Promise<{ updatedAt: string }> {
  const data = await call(token, `/pages/${pageId}`, 'PATCH', {
    properties: propertiesFromTask(task, mapping)
  })
  return { updatedAt: data.last_edited_time }
}

export async function archivePage(token: string, pageId: string): Promise<void> {
  await call(token, `/pages/${pageId}`, 'PATCH', { archived: true })
}

// Trae TODAS las páginas activas (no archivadas) de la database, paginando.
export async function queryAllPages(token: string, databaseId: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = []
  let cursor: string | undefined
  do {
    const data = await call(token, `/databases/${databaseId}/query`, 'POST', {
      page_size: 100,
      start_cursor: cursor
    })
    for (const r of data.results as NotionPage[]) {
      if (!r.archived) pages.push(r)
    }
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return pages
}
