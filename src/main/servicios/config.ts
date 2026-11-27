import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { TIPOS_LOG, type ServidorConfig, type ServiciosConfig, type TipoLog } from '../../shared/types'

// Lista de servicios de ESTE PC (rutas, IPs de los servidores). Vive solo en la carpeta de
// datos, nunca en el repo. Siempre la de la app instalada (también en `npm run dev`): las
// unidades de systemd que se generan a partir de ella son las mismas para las dos.
const DATA_DIR = 'local-management-center'
const ARCHIVO = 'servicios.json'

const VACIA: ServiciosConfig = { baseDir: '', docker: [], servidores: [] }

let cache: ServiciosConfig | null = null

export function rutaConfig(): string {
  return join(app.getPath('appData'), DATA_DIR, ARCHIVO)
}

export function leerConfig(): ServiciosConfig {
  if (cache) return cache
  try {
    if (existsSync(rutaConfig())) {
      const raw = JSON.parse(readFileSync(rutaConfig(), 'utf-8'))
      cache = {
        baseDir: typeof raw.baseDir === 'string' ? raw.baseDir : '',
        docker: Array.isArray(raw.docker) ? raw.docker : [],
        servidores: Array.isArray(raw.servidores) ? raw.servidores.map(normalizarServidor) : []
      }
    } else {
      cache = structuredClone(VACIA)
    }
  } catch {
    cache = structuredClone(VACIA)
  }
  return cache
}

// El archivo se puede editar a mano: volver a leerlo en cada consulta de estado sería caro,
// así que se relee al abrir la ventana de Servicios.
export function recargarConfig(): ServiciosConfig {
  cache = null
  return leerConfig()
}

export function guardarConfig(c: ServiciosConfig): void {
  mkdirSync(join(rutaConfig(), '..'), { recursive: true })
  writeFileSync(rutaConfig(), JSON.stringify(c, null, 2) + '\n', 'utf-8')
  cache = c
}

function normalizarServidor(s: Partial<ServidorConfig>): ServidorConfig {
  return {
    id: String(s.id ?? ''),
    nombre: String(s.nombre ?? ''),
    etiqueta: String(s.etiqueta ?? s.nombre ?? ''),
    ip: String(s.ip ?? ''),
    tipos: Array.isArray(s.tipos) ? s.tipos.filter((t): t is TipoLog => TIPOS_LOG.includes(t as TipoLog)) : [],
    metricas: s.metricas !== false,
    alIniciar: s.alIniciar === true
  }
}

const RE_ID = /^[a-z0-9_]{1,32}$/ // también va en el nombre de la unidad de systemd
const RE_IP = /^(\d{1,3}\.){3}\d{1,3}$|^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/

// Devuelve el motivo si el servidor no es válido (null = válido)
export function validarServidor(s: ServidorConfig, idOriginal: string | null): string | null {
  if (!RE_ID.test(s.id)) return 'El identificador solo admite a-z, 0-9 y _ (máx. 32).'
  // El nombre arma rutas (log_ingest/<nombre>-*) y el extractor de Graylog lo lee con \w+
  if (!RE_ID.test(s.nombre)) return 'El nombre del servidor solo admite a-z, 0-9 y _ (ej. miempresa_web).'
  if (!s.etiqueta.trim()) return 'Falta la etiqueta.'
  if (!RE_IP.test(s.ip)) return 'La IP o el host no es válido.'
  if (s.ip.split('.').length === 4 && s.ip.split('.').every((p) => /^\d+$/.test(p)) && s.ip.split('.').some((p) => Number(p) > 255))
    return 'La IP no es válida.'
  if (s.tipos.length === 0 && !s.metricas) return 'Elige al menos un tipo de log o las métricas.'
  const otros = leerConfig().servidores.filter((x) => x.id !== idOriginal)
  if (otros.some((x) => x.id === s.id)) return `Ya hay un servidor con el identificador "${s.id}".`
  if (otros.some((x) => x.nombre === s.nombre)) return `Ya hay un servidor con el nombre "${s.nombre}".`
  // Si un nombre es prefijo de otro con "_" no pasa nada: los archivos son <nombre>-<tipo>…
  return null
}
