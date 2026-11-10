import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

// Mapeo completo de propiedades de la database (incluye detalles de status
// que no se exponen al renderer).
export interface NotionMapping {
  title: string
  statusProp: string | null
  statusKind: 'status' | 'checkbox' | 'select' | null
  statusDoneName: string | null // nombre de la opción que representa "hecho" (status/select)
  statusPendingName: string | null // nombre de la opción "pendiente"
  dueProp: string | null
  priorityProp: string | null
  tagsProp: string | null
  projectProp: string | null // propiedad "Proyecto" (select o multi_select)
  projectKind: 'select' | 'multi_select' | null
}

interface NotionSettings {
  tokenEnc: string | null // base64 (cifrado o texto plano, según `encrypted`)
  encrypted: boolean
  databaseId: string | null
  databaseTitle: string | null
  mapping: NotionMapping | null
  lastSyncTime: string | null
}

interface GroqSettings {
  keyEnc: string | null // base64 (cifrado o plano según `encrypted`)
  encrypted: boolean
}

interface Settings {
  notion: NotionSettings
  groq: GroqSettings
}

const DEFAULTS: Settings = {
  notion: {
    tokenEnc: null,
    encrypted: false,
    databaseId: null,
    databaseTitle: null,
    mapping: null,
    lastSyncTime: null
  },
  groq: {
    keyEnc: null,
    encrypted: false
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
        groq: { ...DEFAULTS.groq, ...(raw.groq ?? {}) }
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
    lastSyncTime: s.notion.lastSyncTime
  }
  write(s)
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
