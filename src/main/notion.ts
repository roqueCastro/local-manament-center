import { EDITABLE_PROP_TYPES } from '../shared/types'
import type { PropSchema, PropValue, Task } from '../shared/types'
import type { NotionDatabase, NotionMapping } from './settings'
import { REMINDER_RE } from '../shared/dates'

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
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    })
    // Límite de peticiones (≈3/s): esperar lo que indique Notion y reintentar
    if (res.status === 429 && attempt < 4) {
      const wait = Number(res.headers.get('retry-after')) || 1
      await new Promise((r) => setTimeout(r, Math.min(wait, 10) * 1000))
      continue
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new NotionError(res.status, data?.code ?? 'unknown', data?.message ?? res.statusText)
    }
    return data
  }
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

export function normalizeId(id: string): string {
  return id.replace(/-/g, '').toLowerCase()
}

function databaseTitle(db: any): string {
  return (db.title ?? []).map((t: any) => t.plain_text).join('').trim() || 'Sin título'
}

// Deduce qué propiedad de la database corresponde a cada campo de la tarea.
// Columnas de la database en el orden en que vienen, con sus opciones (select/status).
function schemaOf(entries: SchemaEntry[]): PropSchema[] {
  return entries.map((e) => {
    const options: any[] | undefined =
      e.type === 'select' || e.type === 'status' || e.type === 'multi_select'
        ? (e.def[e.type]?.options ?? [])
        : undefined
    // Status: a qué grupo (Por hacer / En curso / Completo) pertenece cada opción
    let groups: Record<string, string> | undefined
    let groupNames: string[] | undefined
    if (e.type === 'status') {
      const gs: any[] = e.def.status?.groups ?? []
      groupNames = gs.map((g) => g.name as string)
      groups = {}
      for (const g of gs) {
        for (const id of (g.option_ids ?? []) as string[]) {
          const o = options?.find((x) => x.id === id)
          if (o) groups[o.name] = g.name
        }
      }
    }
    return {
      name: e.name,
      type: e.type,
      options: options?.map((o) => o.name as string),
      colors: options
        ? Object.fromEntries(options.map((o) => [o.name as string, (o.color as string) ?? 'default']))
        : undefined,
      groups,
      groupNames,
      editable: (EDITABLE_PROP_TYPES as readonly string[]).includes(e.type)
    }
  })
}

export function mapDatabase(db: any): {
  title: string
  mapping: NotionMapping
  schema: PropSchema[]
} {
  const props = (db.properties ?? {}) as Record<string, any>
  const entries: SchemaEntry[] = Object.entries(props).map(([name, def]: [string, any]) => ({
    name,
    type: def.type as string,
    def
  }))

  // title (siempre existe exactamente una)
  const titleName = entries.find((e) => e.type === 'title')?.name ?? 'Name'

  // Prioridad: number, o select con opciones tipo Alta/Media/Baja
  const priorityEntry =
    pickByName(
      entries.filter((e) => e.type === 'number' || e.type === 'select'),
      /prior|import|urgen/i
    ) ?? entries.find((e) => e.type === 'number')
  let priorityKind: NotionMapping['priorityKind'] = null
  let priorityOptions: NotionMapping['priorityOptions'] = null
  if (priorityEntry) {
    priorityKind = priorityEntry.type as 'number' | 'select'
    if (priorityKind === 'select') {
      const options: any[] = priorityEntry.def.select?.options ?? []
      priorityOptions = {
        high: pickByName(options, /alta|high|urgent|cr[ií]tic/i)?.name ?? null,
        medium: pickByName(options, /media|medium|normal/i)?.name ?? null,
        low: pickByName(options, /baja|low/i)?.name ?? null
      }
    }
  }

  // status: preferir 'status' > 'checkbox' > 'select' (excluyendo la de prioridad)
  const statusCandidates = entries.filter(
    (e) => ['status', 'checkbox', 'select'].includes(e.type) && e.name !== priorityEntry?.name
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
  let statusDoneNames: string[] = []

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
      statusDoneNames = ((doneGroup?.option_ids ?? []) as string[])
        .map(nameOf)
        .filter((n): n is string => !!n)
    } else if (statusEntry.type === 'select') {
      const options: any[] = statusEntry.def.select?.options ?? []
      statusDoneName = pickByName(options, /done|complet|hecho|termin|finaliz/i)?.name ?? null
      statusPendingName =
        pickByName(options, /to-?do|pend|sin|nuev|abiert/i)?.name ??
        options.find((o) => o.name !== statusDoneName)?.name ??
        null
    }
  }

  // Recordatorio: fecha (con hora) cuyo nombre lo indique
  const reminderEntry = entries.find((e) => e.type === 'date' && REMINDER_RE.test(e.name))

  // Fecha de vencimiento: preferir "límite/vencimiento/due"; nunca creación/finalización
  // ni el recordatorio
  const dateEntries = entries.filter(
    (e) =>
      e.type === 'date' &&
      !/creaci|creat|finaliz|complet|cierre|termin/i.test(e.name) &&
      !REMINDER_RE.test(e.name)
  )
  const dueEntry =
    pickByName(dateEntries, /l[ií]mite|venc|due|deadline|entrega|plazo/i) ??
    pickByName(dateEntries, /fecha|date/i) ??
    dateEntries[0]

  // Etiquetas: multi_select (que no sea un antiguo "Proyecto")
  const tagCandidates = entries.filter(
    (e) => e.type === 'multi_select' && !/proyect|project/i.test(e.name)
  )
  const tagsEntry =
    pickByName(tagCandidates, /tag|etiqueta|label|categor/i) ?? tagCandidates[0]

  const mapping: NotionMapping = {
    title: titleName,
    statusProp,
    statusKind,
    statusDoneName,
    statusPendingName,
    statusDoneNames: statusDoneNames.length ? statusDoneNames : statusDoneName ? [statusDoneName] : [],
    dueProp: dueEntry?.name ?? null,
    priorityProp: priorityEntry?.name ?? null,
    priorityKind,
    priorityOptions,
    tagsProp: tagsEntry?.name ?? null,
    reminderProp: reminderEntry?.name ?? null
  }

  return { title: databaseTitle(db), mapping, schema: schemaOf(entries) }
}

export async function retrieveAndMap(
  token: string,
  databaseId: string
): Promise<NotionDatabase> {
  const db = await call(token, `/databases/${databaseId}`, 'GET')
  return { id: normalizeId(db.id ?? databaseId), ...mapDatabase(db) }
}

// Todas las databases a las que la integración tiene acceso (= proyectos).
// En Notion se comparte una database (o una página que las contiene) con la integración
// desde ··· → Conexiones; las hijas heredan el acceso.
export async function discoverDatabases(token: string): Promise<NotionDatabase[]> {
  const found: NotionDatabase[] = []
  let cursor: string | undefined
  do {
    const data = await call(token, '/search', 'POST', {
      filter: { property: 'object', value: 'database' },
      page_size: 100,
      start_cursor: cursor
    })
    for (const db of data.results as any[]) {
      if (db.archived || db.in_trash) continue
      found.push({ id: normalizeId(db.id), ...mapDatabase(db) })
    }
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return found.sort((a, b) => a.title.localeCompare(b.title, 'es'))
}

// ---- Conversión Task <-> Notion ----

// ¿Esta opción de estado cuenta como "hecha"?
export function isDoneStatus(name: string | null, mapping: NotionMapping): boolean {
  if (!name) return false
  if (mapping.statusDoneNames?.includes(name)) return true
  return name === mapping.statusDoneName || /done|complet|hecho|termin/i.test(name)
}

export function priorityFromOption(name: string | null, mapping: NotionMapping): number {
  const o = mapping.priorityOptions
  if (!name || !o) return 0
  return name === o.high ? 3 : name === o.medium ? 2 : name === o.low ? 1 : 0
}

export function optionFromPriority(priority: number, mapping: NotionMapping): string | null {
  const o = mapping.priorityOptions
  if (!o) return null
  return priority >= 3 ? o.high : priority === 2 ? o.medium : priority === 1 ? o.low : null
}

const plain = (rich: any[] | undefined): string =>
  (rich ?? []).map((t: any) => t.plain_text ?? '').join('')

// Convierte una propiedad de Notion a un valor simple (para guardar y mostrar).
export function simplifyProperty(prop: any): PropValue {
  if (!prop || typeof prop !== 'object') return null
  switch (prop.type) {
    case 'title':
      return plain(prop.title)
    case 'rich_text':
      return plain(prop.rich_text)
    case 'number':
      return prop.number ?? null
    case 'select':
      return prop.select?.name ?? null
    case 'status':
      return prop.status?.name ?? null
    case 'multi_select':
      return (prop.multi_select ?? []).map((o: any) => o.name)
    case 'date':
      return prop.date?.start ?? null
    case 'checkbox':
      return !!prop.checkbox
    case 'url':
      return prop.url ?? null
    case 'email':
      return prop.email ?? null
    case 'phone_number':
      return prop.phone_number ?? null
    case 'people':
      return (prop.people ?? []).map((p: any) => p.name ?? 'Usuario')
    case 'created_by':
    case 'last_edited_by':
      return prop[prop.type]?.name ?? null
    case 'created_time':
    case 'last_edited_time':
      return prop[prop.type] ?? null
    case 'relation':
      return `${(prop.relation ?? []).length} vinculado(s)`
    case 'files':
      return (prop.files ?? []).map((f: any) => f.name ?? 'archivo')
    case 'unique_id': {
      const u = prop.unique_id
      return u ? `${u.prefix ? u.prefix + '-' : ''}${u.number}` : null
    }
    case 'formula': {
      const f = prop.formula ?? {}
      const v = f[f.type]
      if (f.type === 'date') return v?.start ?? null
      return v === undefined || v === null ? null : typeof v === 'object' ? null : (v as PropValue)
    }
    case 'rollup': {
      const r = prop.rollup ?? {}
      if (r.type === 'number') return r.number ?? null
      if (r.type === 'date') return r.date?.start ?? null
      if (r.type === 'array') return `${(r.array ?? []).length} elemento(s)`
      return null
    }
    default:
      return null
  }
}

export function pageProps(page: NotionPage): Record<string, PropValue> {
  const out: Record<string, PropValue> = {}
  for (const [name, prop] of Object.entries(page.properties ?? {})) {
    out[name] = simplifyProperty(prop)
  }
  return out
}

const str = (v: PropValue): string | null =>
  v === null || v === undefined ? null : Array.isArray(v) ? v.join(', ') : String(v)

// Valor simple → formato de la API de Notion. undefined = no se puede escribir.
export function toNotionProperty(schema: PropSchema, value: PropValue): any | undefined {
  if (!schema.editable) return undefined
  const s = str(value)
  switch (schema.type) {
    case 'title':
      return { title: [{ text: { content: s ?? '' } }] }
    case 'rich_text':
      return { rich_text: s ? [{ text: { content: s.slice(0, 2000) } }] : [] }
    case 'number': {
      const n = value === null || value === '' ? null : Number(value)
      return { number: n === null || Number.isNaN(n) ? null : n }
    }
    case 'select':
      return { select: s ? { name: s } : null }
    case 'status':
      // El estado debe ser una opción existente (Notion no crea opciones de status)
      if (!s || (schema.options && !schema.options.includes(s))) return undefined
      return { status: { name: s } }
    case 'multi_select': {
      const arr = Array.isArray(value) ? value : s ? s.split(',').map((x) => x.trim()) : []
      return { multi_select: arr.filter(Boolean).map((name) => ({ name })) }
    }
    case 'date':
      return { date: s ? { start: s } : null }
    case 'checkbox':
      return { checkbox: value === true || value === 'true' }
    case 'url':
      return { url: s || null }
    case 'email':
      return { email: s || null }
    case 'phone_number':
      return { phone_number: s || null }
    default:
      return undefined
  }
}

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
  props: Record<string, PropValue>
  updatedAt: string
} {
  const props = pageProps(page)

  const title = (str(props[mapping.title]) ?? '').trim() || '(sin título)'

  let status: Task['status'] = 'pending'
  if (mapping.statusProp && mapping.statusKind) {
    const v = props[mapping.statusProp]
    if (mapping.statusKind === 'checkbox') status = v === true ? 'done' : 'pending'
    else status = isDoneStatus(str(v), mapping) ? 'done' : 'pending'
  }

  const dueDate = mapping.dueProp ? str(props[mapping.dueProp]) : null

  let priority = 0
  if (mapping.priorityProp && mapping.priorityKind === 'number') {
    const raw = Number(props[mapping.priorityProp] ?? 0)
    priority = Math.max(0, Math.min(3, Math.round(Number.isNaN(raw) ? 0 : raw)))
  } else if (mapping.priorityProp && mapping.priorityKind === 'select') {
    priority = priorityFromOption(str(props[mapping.priorityProp]), mapping)
  }

  const tagsRaw = mapping.tagsProp ? props[mapping.tagsProp] : null
  const tags = Array.isArray(tagsRaw) ? tagsRaw : []

  return {
    notionId: page.id,
    title,
    status,
    dueDate,
    priority,
    tags,
    props,
    updatedAt: page.last_edited_time
  }
}

// Valores de las propiedades "principales" (título, estado, fecha, prioridad, etiquetas)
// derivados de los campos de la tarea, en formato simple.
export function corePropValues(
  task: Pick<Task, 'title' | 'status' | 'dueDate' | 'priority' | 'tags'>,
  mapping: NotionMapping,
  fields: Array<'title' | 'status' | 'dueDate' | 'priority' | 'tags'> = [
    'title',
    'status',
    'dueDate',
    'priority',
    'tags'
  ]
): Record<string, PropValue> {
  const out: Record<string, PropValue> = {}
  if (fields.includes('title')) out[mapping.title] = task.title
  if (fields.includes('status') && mapping.statusProp && mapping.statusKind) {
    if (mapping.statusKind === 'checkbox') out[mapping.statusProp] = task.status === 'done'
    else {
      const name = task.status === 'done' ? mapping.statusDoneName : mapping.statusPendingName
      if (name) out[mapping.statusProp] = name
    }
  }
  if (fields.includes('dueDate') && mapping.dueProp) out[mapping.dueProp] = task.dueDate
  if (fields.includes('priority') && mapping.priorityProp) {
    out[mapping.priorityProp] =
      mapping.priorityKind === 'select' ? optionFromPriority(task.priority, mapping) : task.priority
  }
  if (fields.includes('tags') && mapping.tagsProp) out[mapping.tagsProp] = task.tags
  return out
}

// Construye el objeto `properties` de la API a partir de valores simples.
export function buildProperties(
  values: Record<string, PropValue>,
  schema: PropSchema[]
): Record<string, any> {
  const byName = new Map(schema.map((p) => [p.name, p]))
  const out: Record<string, any> = {}
  for (const [name, value] of Object.entries(values)) {
    const sc = byName.get(name)
    if (!sc) continue
    const v = toNotionProperty(sc, value)
    if (v !== undefined) out[name] = v
  }
  return out
}

// ---- Operaciones ----

export async function createPage(
  token: string,
  databaseId: string,
  properties: Record<string, any>
): Promise<{ id: string; updatedAt: string }> {
  const data = await call(token, '/pages', 'POST', {
    parent: { database_id: databaseId },
    properties
  })
  return { id: data.id, updatedAt: data.last_edited_time }
}

export async function updatePage(
  token: string,
  pageId: string,
  properties: Record<string, any>
): Promise<{ updatedAt: string }> {
  const data = await call(token, `/pages/${pageId}`, 'PATCH', { properties })
  return { updatedAt: data.last_edited_time }
}

// Database "cruda" (con ids de opciones), para editar su esquema.
export async function getDatabaseRaw(token: string, databaseId: string): Promise<any> {
  return call(token, `/databases/${databaseId}`, 'GET')
}

// Cambia columnas/opciones de la database. Devuelve la database actualizada ya mapeada.
export async function patchDatabaseProperties(
  token: string,
  databaseId: string,
  properties: Record<string, any>
): Promise<{ raw: any; db: NotionDatabase }> {
  const raw = await call(token, `/databases/${databaseId}`, 'PATCH', { properties })
  return { raw, db: { id: normalizeId(raw.id ?? databaseId), ...mapDatabase(raw) } }
}

// Páginas de la database que cumplen un filtro de Notion.
export async function queryPages(
  token: string,
  databaseId: string,
  filter: Record<string, any>
): Promise<NotionPage[]> {
  const pages: NotionPage[] = []
  let cursor: string | undefined
  do {
    const data = await call(token, `/databases/${databaseId}/query`, 'POST', {
      filter,
      page_size: 100,
      start_cursor: cursor
    })
    pages.push(...(data.results as NotionPage[]).filter((r) => !r.archived))
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return pages
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
