import type {
  ConnectResult,
  NotionConnection,
  NotionMappingSummary,
  PropValue,
  SyncState,
  Task
} from '../shared/types'
import {
  addProject,
  getAllNotionIds,
  getTaskByNotionId,
  getTombstones,
  getUnsyncedTasks,
  listProjects,
  markSynced,
  removeByNotionId,
  removeTombstone,
  upsertFromNotion
} from './db'
import {
  archivePage,
  buildProperties,
  corePropValues,
  createPage,
  discoverDatabases,
  NotionError,
  queryAllPages,
  retrieveAndMap,
  taskDataFromPage,
  textToBlocks,
  updatePage
} from './notion'
import {
  clearNotion,
  encryptionAvailable,
  getActiveDatabases,
  getNotionDatabases,
  getNotionSettings,
  getNotionToken,
  isNotionConnected,
  saveNotionCredentials,
  setDatabaseExcluded,
  setLastSyncTime,
  setNotionDatabases,
  type NotionDatabase,
  type NotionMapping
} from './settings'

// ---- Estado y eventos ----

let state: SyncState = {
  status: 'disconnected',
  lastSyncTime: null,
  lastError: null,
  pushed: 0,
  pulled: 0
}

const stateListeners = new Set<(s: SyncState) => void>()
const changedListeners = new Set<() => void>()

export function onSyncStateChange(cb: (s: SyncState) => void): void {
  stateListeners.add(cb)
}
export function onDataChanged(cb: () => void): void {
  changedListeners.add(cb)
}

function setState(partial: Partial<SyncState>): void {
  state = { ...state, ...partial }
  for (const cb of stateListeners) cb(state)
}
function emitChanged(): void {
  for (const cb of changedListeners) cb()
}

export function getSyncState(): SyncState {
  return state
}

export function initSyncState(): void {
  const n = getNotionSettings()
  state = {
    status: isNotionConnected() ? 'idle' : 'disconnected',
    lastSyncTime: n.lastSyncTime,
    lastError: null,
    pushed: 0,
    pulled: 0
  }
}

// ---- Conexión ----

function toSummary(m: NotionMapping): NotionMappingSummary {
  return {
    title: m.title,
    statusProp: m.statusProp,
    statusKind: m.statusKind,
    dueProp: m.dueProp,
    priorityProp: m.priorityProp,
    tagsProp: m.tagsProp,
    reminderProp: m.reminderProp ?? null
  }
}

export function getConnection(): NotionConnection {
  const n = getNotionSettings()
  return {
    connected: isNotionConnected(),
    databaseId: n.databaseId,
    databaseTitle: n.databaseTitle,
    lastSyncTime: n.lastSyncTime,
    encryptionAvailable: encryptionAvailable(),
    databases: getNotionDatabases().map((d) => ({
      id: d.id,
      title: d.title,
      isDefault: d.id === n.databaseId,
      enabled: !n.excludedDatabases.includes(d.id),
      mapping: toSummary(d.mapping),
      schema: d.schema ?? []
    }))
  }
}

// Normaliza el ID de database: quita guiones y espacios (acepta URL pegada completa).
function normalizeDatabaseId(input: string): string {
  const trimmed = input.trim()
  // Si pegaron una URL, extraer el bloque de 32 hex
  const match = trimmed.match(/[0-9a-fA-F]{32}/)
  return (match ? match[0] : trimmed).replace(/-/g, '').toLowerCase()
}

const NO_ACCESS_MSG =
  'La integración no tiene acceso a ninguna database. En Notion abrí cada database (o la página que las contiene) → ··· → Conexiones → agregá tu integración.'

// Conecta con el token. La database es opcional: si se indica, queda como "por defecto"
// (recibe las tareas sin proyecto); los proyectos son TODAS las databases compartidas.
export async function connectNotion(
  token: string,
  databaseIdRaw: string
): Promise<ConnectResult> {
  const cleanToken = token.trim()
  if (!cleanToken) return { ok: false, error: 'Falta el token de integración.' }
  const wantedId = databaseIdRaw.trim() ? normalizeDatabaseId(databaseIdRaw) : null
  if (wantedId && !/^[0-9a-f]{32}$/.test(wantedId)) {
    return { ok: false, error: 'El ID de la database no parece válido (se esperan 32 caracteres).' }
  }
  try {
    const dbs = await discoverDatabases(cleanToken)
    let def: NotionDatabase | undefined
    if (wantedId) {
      def = dbs.find((d) => d.id === wantedId)
      if (!def) {
        // La búsqueda de Notion puede tardar en indexar una database recién compartida
        def = await retrieveAndMap(cleanToken, wantedId)
        dbs.push(def)
      }
    } else {
      def = dbs[0]
    }
    if (!def) return { ok: false, error: NO_ACCESS_MSG }

    saveNotionCredentials(cleanToken, def.id, def.title, def.mapping)
    setNotionDatabases(dbs)
    setState({ status: 'idle', lastError: null })
    // Primer sync completo en segundo plano
    void syncNow()
    return { ok: true, databaseTitle: def.title, mapping: toSummary(def.mapping) }
  } catch (e) {
    const err = e as NotionError
    let msg = err.message || 'Error desconocido al conectar.'
    if (err.status === 401) msg = 'Token inválido o sin permisos (401).'
    else if (err.status === 404)
      msg = 'Database no encontrada (404). ¿La compartiste con la integración?'
    return { ok: false, error: msg }
  }
}

export function disconnectNotion(): void {
  clearNotion()
  setState({ status: 'disconnected', lastSyncTime: null, lastError: null, pushed: 0, pulled: 0 })
}

// Marca/desmarca un proyecto en Ajustes y sincroniza para traer o quitar sus tareas.
export function setDatabaseEnabled(id: string, enabled: boolean): NotionConnection {
  if (setDatabaseExcluded(id, !enabled)) requestSync(0)
  return getConnection()
}

// ---- Proyectos ----

// Con Notion conectado, los proyectos son las databases compartidas con la integración.
// Sin conexión, son los proyectos locales.
export function getProjects(): string[] {
  if (isNotionConnected()) return getActiveDatabases().map((d) => d.title)
  return listProjects()
}

export async function createProject(name: string): Promise<string[]> {
  const clean = name.trim()
  // Conectado: un proyecto nuevo es una database nueva en Notion (se crea allí y se comparte).
  if (clean && !isNotionConnected()) addProject(clean)
  return getProjects()
}

// Database destino de una tarea: la del proyecto asignado; si no hay proyecto (o no
// coincide con ninguna database), la database donde ya vive; si no, la por defecto.
function targetDatabase(
  t: Task,
  dbs: NotionDatabase[],
  defaultDb: NotionDatabase
): NotionDatabase {
  const byProject = t.project
    ? dbs.find((d) => d.title.toLowerCase() === t.project!.toLowerCase())
    : undefined
  const current = t.notionDb ? dbs.find((d) => d.id === t.notionDb) : undefined
  return byProject ?? current ?? defaultDb
}

// ---- Sincronización ----

let syncing = false

export async function syncNow(): Promise<SyncState> {
  if (!isNotionConnected()) {
    setState({ status: 'disconnected' })
    return state
  }
  if (syncing) return state
  syncing = true
  setState({ status: 'syncing', lastError: null, pushed: 0, pulled: 0 })

  const token = getNotionToken()

  if (!token) {
    syncing = false
    setState({ status: 'error', lastError: 'No se pudo leer el token (keychain).' })
    return state
  }

  let pushed = 0
  let pulled = 0

  try {
    // 0) Redescubrir databases (proyectos): así aparecen las recién compartidas y se
    //    actualiza el mapeo si cambió el esquema. Si no devuelve nada, se conserva lo anterior.
    const discovered = await discoverDatabases(token)
    if (discovered.length > 0) setNotionDatabases(discovered)
    const dbs = getNotionDatabases()
    const defaultId = getNotionSettings().databaseId
    const defaultDb = dbs.find((d) => d.id === defaultId) ?? dbs[0]
    if (!defaultDb) throw new NotionError(404, 'no_access', NO_ACCESS_MSG)

    // 1) Archivar en Notion los borrados locales
    for (const tomb of getTombstones()) {
      try {
        await archivePage(token, tomb.notionId)
      } catch (e) {
        // Si ya no existe, igual limpiamos el tombstone
        if (!(e instanceof NotionError && e.status === 404)) throw e
      }
      removeTombstone(tomb.notionId)
    }

    // 2) Subir cambios locales pendientes. Se busca en TODAS las databases (también las
    //    desmarcadas) para que un cambio pendiente no termine en otro proyecto.
    for (const { task: t, dirty } of getUnsyncedTasks()) {
      const target = targetDatabase(t, dbs, defaultDb)
      const schema = target.schema ?? []
      // Tareas anteriores al multi-proyecto viven en la database por defecto
      const currentDbId = t.notionId ? (t.notionDb ?? defaultDb.id) : null
      if (!t.notionId || currentDbId !== target.id) {
        // Página nueva (o cambio de proyecto): campos principales + todas las propiedades
        // que existan en la database destino.
        const values: Record<string, PropValue> = {
          ...corePropValues(t, target.mapping),
          ...t.props
        }
        // Los detalles (dictados/escritos al crearla) van al cuerpo de la página
        const children = t.details ? textToBlocks(t.details) : []
        const { id, updatedAt } = await createPage(token, target.id, buildProperties(values, schema), children)
        markSynced(t.id, id, updatedAt, target.id)
        if (t.notionId) {
          // Notion no mueve páginas entre databases → se creó en la nueva; archivar la anterior
          try {
            await archivePage(token, t.notionId)
          } catch (e) {
            if (!(e instanceof NotionError && e.status === 404)) throw e
          }
        }
      } else {
        // Página existente: subir solo lo que cambió (no pisa ediciones hechas en Notion
        // sobre otras columnas). Sin registro de cambios (datos antiguos): campos principales.
        const values: Record<string, PropValue> =
          dirty.length > 0
            ? Object.fromEntries(dirty.map((name) => [name, t.props[name] ?? null]))
            : corePropValues(t, target.mapping)
        const { updatedAt } = await updatePage(token, t.notionId, buildProperties(values, schema))
        markSynced(t.id, t.notionId, updatedAt, target.id)
      }
      pushed++
    }

    // 3) Traer el estado remoto completo de cada proyecto marcado (activas, no archivadas)
    const remoteIds = new Set<string>()
    for (const db of getActiveDatabases()) {
      const pages = await queryAllPages(token, db.id)
      for (const page of pages) {
        remoteIds.add(page.id)
        const data = { ...taskDataFromPage(page, db.mapping), project: db.title, notionDb: db.id }
        const local = getTaskByNotionId(data.notionId)
        // Conflicto: si lo local no está sincronizado y es más nuevo, no pisar.
        if (local && !local.synced && local.updatedAt > data.updatedAt) continue
        if (
          !local ||
          local.updatedAt !== data.updatedAt ||
          local.project !== data.project ||
          local.notionDb !== data.notionDb ||
          JSON.stringify(local.props) !== JSON.stringify(data.props)
        ) {
          upsertFromNotion(data)
          pulled++
        }
      }
    }

    // 4) Borrados remotos (o proyectos desmarcados): lo que no se trajo se quita localmente
    for (const id of getAllNotionIds()) {
      if (!remoteIds.has(id)) removeByNotionId(id)
    }

    const now = new Date().toISOString()
    setLastSyncTime(now)
    setState({ status: 'idle', lastSyncTime: now, pushed, pulled })
    emitChanged()
  } catch (e) {
    const err = e as NotionError
    setState({ status: 'error', lastError: err.message ?? 'Error de sincronización', pushed, pulled })
  } finally {
    syncing = false
  }
  return state
}

// ---- Disparadores automáticos ----

let debounceTimer: NodeJS.Timeout | null = null
let intervalTimer: NodeJS.Timeout | null = null

// Agenda un sync con debounce tras mutaciones locales.
export function requestSync(delayMs = 1500): void {
  if (!isNotionConnected()) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void syncNow()
  }, delayMs)
}

export function startAutoSync(intervalMs = 5 * 60 * 1000): void {
  if (intervalTimer) clearInterval(intervalTimer)
  intervalTimer = setInterval(() => {
    void syncNow()
  }, intervalMs)
  // Al arrancar: sincronizar (incluye redescubrir databases y su mapeo)
  if (isNotionConnected()) void syncNow()
}

export function stopAutoSync(): void {
  if (intervalTimer) clearInterval(intervalTimer)
  if (debounceTimer) clearTimeout(debounceTimer)
}
