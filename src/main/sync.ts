import type {
  ConnectResult,
  NotionConnection,
  NotionMappingSummary,
  SyncState
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
  addProjectOption,
  archivePage,
  createPage,
  NotionError,
  queryAllPages,
  retrieveAndMap,
  taskDataFromPage,
  updatePage
} from './notion'
import {
  clearNotion,
  encryptionAvailable,
  getNotionSettings,
  getNotionToken,
  isNotionConnected,
  saveNotionCredentials,
  setLastSyncTime,
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
    projectProp: m.projectProp
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
    mapping: n.mapping ? toSummary(n.mapping) : null
  }
}

// Normaliza el ID de database: quita guiones y espacios (acepta URL pegada completa).
function normalizeDatabaseId(input: string): string {
  const trimmed = input.trim()
  // Si pegaron una URL, extraer el bloque de 32 hex
  const match = trimmed.match(/[0-9a-fA-F]{32}/)
  return (match ? match[0] : trimmed).replace(/-/g, '')
}

export async function connectNotion(
  token: string,
  databaseIdRaw: string
): Promise<ConnectResult> {
  const databaseId = normalizeDatabaseId(databaseIdRaw)
  const cleanToken = token.trim()
  if (!cleanToken) return { ok: false, error: 'Falta el token de integración.' }
  if (!/^[0-9a-f]{32}$/.test(databaseId)) {
    return { ok: false, error: 'El ID de la database no parece válido (se esperan 32 caracteres).' }
  }
  try {
    const { title, mapping, projectOptions } = await retrieveAndMap(cleanToken, databaseId)
    saveNotionCredentials(cleanToken, databaseId, title, mapping)
    // Registrar los proyectos existentes en Notion (aunque no tengan tareas)
    for (const name of projectOptions) addProject(name)
    setState({ status: 'idle', lastError: null })
    // Primer sync completo en segundo plano
    void syncNow()
    return { ok: true, databaseTitle: title, mapping: toSummary(mapping) }
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

// ---- Proyectos ----

export function getProjects(): string[] {
  return listProjects()
}

export async function createProject(name: string): Promise<string[]> {
  const clean = name.trim()
  if (!clean) return listProjects()
  addProject(clean)
  // Si hay conexión, crear también la opción en Notion (no bloquea si falla)
  if (isNotionConnected()) {
    const token = getNotionToken()
    const n = getNotionSettings()
    if (token && n.mapping && n.databaseId) {
      try {
        await addProjectOption(token, n.databaseId, n.mapping, clean)
      } catch {
        // la opción se materializará igual al asignar una tarea a este proyecto
      }
    }
  }
  return listProjects()
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
  const n = getNotionSettings()
  const mapping = n.mapping!
  const databaseId = n.databaseId!

  if (!token) {
    syncing = false
    setState({ status: 'error', lastError: 'No se pudo leer el token (keychain).' })
    return state
  }

  let pushed = 0
  let pulled = 0

  try {
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

    // 2) Subir cambios locales pendientes
    for (const t of getUnsyncedTasks()) {
      if (!t.notionId) {
        const { id, updatedAt } = await createPage(token, databaseId, t, mapping)
        markSynced(t.id, id, updatedAt)
      } else {
        const { updatedAt } = await updatePage(token, t.notionId, t, mapping)
        markSynced(t.id, t.notionId, updatedAt)
      }
      pushed++
    }

    // 3) Traer el estado remoto completo (activas, no archivadas)
    const pages = await queryAllPages(token, databaseId)
    const remoteIds = new Set<string>()
    for (const page of pages) {
      remoteIds.add(page.id)
      const data = taskDataFromPage(page, mapping)
      const local = getTaskByNotionId(data.notionId)
      // Conflicto: si lo local no está sincronizado y es más nuevo, no pisar.
      if (local && !local.synced && local.updatedAt > data.updatedAt) continue
      // Upsert si hay cambios (incluye diferencia de proyecto, útil tras migrar el mapping)
      if (!local || local.updatedAt !== data.updatedAt || local.project !== data.project) {
        upsertFromNotion(data)
        pulled++
      }
    }

    // 4) Borrados remotos: lo que ya no está en Notion se borra localmente
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

// Re-detecta el esquema si el mapping guardado es de una versión anterior
// (sin la propiedad de proyecto). Evita tener que reconectar a mano.
async function ensureMappingFresh(): Promise<void> {
  if (!isNotionConnected()) return
  const n = getNotionSettings()
  // Si ya tiene la clave projectProp, el mapping está actualizado.
  if (n.mapping && 'projectProp' in n.mapping) return
  const token = getNotionToken()
  if (!token || !n.databaseId) return
  try {
    const { title, mapping, projectOptions } = await retrieveAndMap(token, n.databaseId)
    saveNotionCredentials(token, n.databaseId, title, mapping)
    for (const name of projectOptions) addProject(name)
  } catch {
    // si falla, seguimos con el mapping anterior
  }
}

export function startAutoSync(intervalMs = 5 * 60 * 1000): void {
  if (intervalTimer) clearInterval(intervalTimer)
  intervalTimer = setInterval(() => {
    void syncNow()
  }, intervalMs)
  // Al arrancar: actualizar mapping si hace falta y luego sincronizar
  if (isNotionConnected()) {
    void ensureMappingFresh().then(() => syncNow())
  }
}

export function stopAutoSync(): void {
  if (intervalTimer) clearInterval(intervalTimer)
  if (debounceTimer) clearTimeout(debounceTimer)
}
