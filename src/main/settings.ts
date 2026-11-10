import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { ManagerPrefs, PropSchema } from '../shared/types'

// Mapeo completo de propiedades de la database (incluye detalles de status
// que no se exponen al renderer).
export interface NotionMapping {
  title: string
  statusProp: string | null
  statusKind: 'status' | 'checkbox' | 'select' | null
  statusDoneName: string | null // nombre de la opción que representa "hecho" (status/select)
  statusPendingName: string | null // nombre de la opción "pendiente"
  statusDoneNames?: string[] // todas las opciones que cuentan como "hecha" (grupo Completo)
  dueProp: string | null
  priorityProp: string | null
  priorityKind: 'number' | 'select' | null
  // Opciones del select de prioridad equivalentes a 3/2/1 (Alta/Media/Baja)
  priorityOptions: { high: string | null; medium: string | null; low: string | null } | null
  tagsProp: string | null
}

// Cada database de Notion compartida con la integración = un proyecto en la app.
export interface NotionDatabase {
  id: string // 32 hex, sin guiones
  title: string
  mapping: NotionMapping
  schema?: PropSchema[] // columnas de la database (Cliente, Contacto, Estado…)
}

interface NotionSettings {
  tokenEnc: string | null // base64 (cifrado o texto plano, según `encrypted`)
  encrypted: boolean
  databaseId: string | null // database por defecto (tareas sin proyecto)
  databaseTitle: string | null
  mapping: NotionMapping | null
  databases: NotionDatabase[] // todas las databases accesibles (proyectos)
  excludedDatabases: string[] // proyectos que el usuario desmarcó en Ajustes
  lastSyncTime: string | null
}

interface GroqSettings {
  keyEnc: string | null // base64 (cifrado o plano según `encrypted`)
  encrypted: boolean
}

export interface UiSettings {
  bubbleEnabled: boolean // burbuja flotante visible en pantalla
  bubblePosition: { x: number; y: number } | null // última posición (null = por defecto)
  manager?: ManagerPrefs // proyecto, filtro y vistas de tabla del gestor
}

interface Settings {
  notion: NotionSettings
  groq: GroqSettings
  ui: UiSettings
}

const DEFAULTS: Settings = {
  notion: {
    tokenEnc: null,
    encrypted: false,
    databaseId: null,
    databaseTitle: null,
    mapping: null,
    databases: [],
    excludedDatabases: [],
    lastSyncTime: null
  },
  groq: {
    keyEnc: null,
    encrypted: false
  },
  ui: {
    bubbleEnabled: true,
    bubblePosition: null
  }
}

let cache: Settings | null = null

function filePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function read(): Settings {
  if (cache) return cache
  try {
    if (existsSync(filePath())) {
      const raw = JSON.parse(readFileSync(filePath(), 'utf-8'))
      cache = {
        notion: { ...DEFAULTS.notion, ...(raw.notion ?? {}) },
        groq: { ...DEFAULTS.groq, ...(raw.groq ?? {}) },
        ui: { ...DEFAULTS.ui, ...(raw.ui ?? {}) }
      }
    } else {
      cache = structuredClone(DEFAULTS)
    }
  } catch {
    cache = structuredClone(DEFAULTS)
  }
  return cache
}

function write(s: Settings): void {
  cache = s
  writeFileSync(filePath(), JSON.stringify(s, null, 2), 'utf-8')
}

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function getNotionSettings(): NotionSettings {
  return read().notion
}

// Devuelve el token descifrado, o null si no hay.
export function getNotionToken(): string | null {
  const n = read().notion
  if (!n.tokenEnc) return null
  if (!n.encrypted) return Buffer.from(n.tokenEnc, 'base64').toString('utf-8')
  try {
    return safeStorage.decryptString(Buffer.from(n.tokenEnc, 'base64'))
  } catch {
    return null
  }
}

export function saveNotionCredentials(
  token: string,
  databaseId: string,
  databaseTitle: string,
  mapping: NotionMapping
): void {
  const useEnc = encryptionAvailable()
  const tokenEnc = useEnc
    ? safeStorage.encryptString(token).toString('base64')
    : Buffer.from(token, 'utf-8').toString('base64')
  const s = read()
  s.notion = {
    tokenEnc,
    encrypted: useEnc,
    databaseId,
    databaseTitle,
    mapping,
    databases: s.notion.databases,
    excludedDatabases: s.notion.excludedDatabases,
    lastSyncTime: s.notion.lastSyncTime
  }
  write(s)
}

// Databases accesibles (proyectos). Si aún no se descubrieron (configuración anterior),
// se devuelve solo la database por defecto.
export function getNotionDatabases(): NotionDatabase[] {
  const n = read().notion
  if (n.databases.length > 0) return n.databases
  if (n.databaseId && n.mapping) {
    return [{ id: n.databaseId, title: n.databaseTitle ?? 'Database', mapping: n.mapping }]
  }
  return []
}

// Solo los proyectos que el usuario tiene marcados en Ajustes.
export function getActiveDatabases(): NotionDatabase[] {
  const excluded = new Set(read().notion.excludedDatabases)
  return getNotionDatabases().filter((d) => !excluded.has(d.id))
}

export function isDatabaseExcluded(id: string): boolean {
  return read().notion.excludedDatabases.includes(id)
}

// La database por defecto debe ser accesible y estar marcada; si no, la primera activa.
function fixDefault(s: Settings): void {
  const excluded = new Set(s.notion.excludedDatabases)
  const active = s.notion.databases.filter((d) => !excluded.has(d.id))
  const def = active.find((d) => d.id === s.notion.databaseId) ?? active[0]
  if (def) {
    s.notion.databaseId = def.id
    s.notion.databaseTitle = def.title
    s.notion.mapping = def.mapping
  }
}

// Guarda las databases descubiertas y mantiene coherente la database por defecto.
export function setNotionDatabases(dbs: NotionDatabase[]): void {
  const s = read()
  s.notion.databases = dbs
  fixDefault(s)
  write(s)
}

// Marca/desmarca un proyecto para traerlo a la app. Siempre queda al menos uno activo.
export function setDatabaseExcluded(id: string, excluded: boolean): boolean {
  const s = read()
  const set = new Set(s.notion.excludedDatabases)
  if (excluded) set.add(id)
  else set.delete(id)
  const activeLeft = s.notion.databases.filter((d) => !set.has(d.id)).length
  if (activeLeft === 0) return false
  s.notion.excludedDatabases = [...set]
  fixDefault(s)
  write(s)
  return true
}

export function setLastSyncTime(iso: string): void {
  const s = read()
  s.notion.lastSyncTime = iso
  write(s)
}

export function clearNotion(): void {
  const s = read()
  s.notion = structuredClone(DEFAULTS.notion)
  write(s)
}

export function isNotionConnected(): boolean {
  const n = read().notion
  return !!(n.tokenEnc && n.databaseId && n.mapping)
}

// ---- Groq (IA) ----

export function hasGroqKey(): boolean {
  return !!read().groq.keyEnc
}

export function getGroqKey(): string | null {
  const g = read().groq
  if (!g.keyEnc) return null
  if (!g.encrypted) return Buffer.from(g.keyEnc, 'base64').toString('utf-8')
  try {
    return safeStorage.decryptString(Buffer.from(g.keyEnc, 'base64'))
  } catch {
    return null
  }
}

export function saveGroqKey(key: string): void {
  const useEnc = encryptionAvailable()
  const keyEnc = useEnc
    ? safeStorage.encryptString(key).toString('base64')
    : Buffer.from(key, 'utf-8').toString('base64')
  const s = read()
  s.groq = { keyEnc, encrypted: useEnc }
  write(s)
}

export function clearGroqKey(): void {
  const s = read()
  s.groq = structuredClone(DEFAULTS.groq)
  write(s)
}

// ---- UI (burbuja flotante) ----

export function getUiSettings(): UiSettings {
  return read().ui
}

export function saveUiSettings(patch: Partial<UiSettings>): void {
  const s = read()
  s.ui = { ...s.ui, ...patch }
  write(s)
}
