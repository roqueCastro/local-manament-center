import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { EstadoServicio, ResultadoServicio, ServidorConfig } from '../../shared/types'
import { ejecutar, resumirError } from './ejecutar'

// Captura de cada servidor = una unidad de systemd de USUARIO (nada del sistema, nada en
// los servidores): centro-captura-<id>.service, que corre bash/captura_servidor.sh.
// Sigue viva aunque la app se cierre o se actualice; su log queda en journalctl --user.
// No se "habilita" en systemd: la enciende la app al arrancar si el servidor está marcado.

const PREFIJO = 'centro-captura-'

export function nombreUnidad(id: string): string {
  return `${PREFIJO}${id}.service`
}

function carpetaUnidades(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'systemd', 'user')
}

export function rutaScript(baseDir: string): string {
  return join(baseDir, 'bash', 'captura_servidor.sh')
}

// systemd: comillas dobles para rutas con espacios y %% para que % no sea un especificador
function arg(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`
}

function contenidoUnidad(s: ServidorConfig, baseDir: string): string {
  const args = [rutaScript(baseDir), '-ipR', s.ip, '--server', s.nombre]
  if (s.tipos.length) args.push('-tL', s.tipos.join(','))
  if (!s.metricas) args.push('--sin-metricas')
  return [
    '# Generado por el Centro de Control de Tareas (ventana Servicios). Se reescribe al editar',
    '# el servidor en la app: los cambios a mano aquí se pierden.',
    '[Unit]',
    `Description=Captura de logs y métricas de ${s.nombre} (${s.etiqueta})`,
    'After=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=/bin/bash ${args.map(arg).join(' ')}`,
    // Si se cae, la app avisa y el usuario decide (no se relanza sola)
    'Restart=no',
    'KillMode=control-group',
    'TimeoutStopSec=20',
    ''
  ].join('\n')
}

// Escribe/actualiza las unidades de los servidores configurados (daemon-reload solo si cambió
// alguna). Las de servidores eliminados las borra borrarUnidad().
export async function sincronizarUnidades(servidores: ServidorConfig[], baseDir: string): Promise<void> {
  const dir = carpetaUnidades()
  mkdirSync(dir, { recursive: true })
  let cambio = false
  for (const s of servidores) {
    const ruta = join(dir, nombreUnidad(s.id))
    const nuevo = contenidoUnidad(s, baseDir)
    const actual = existsSync(ruta) ? readFileSync(ruta, 'utf-8') : null
    if (actual !== nuevo) {
      writeFileSync(ruta, nuevo, 'utf-8')
      cambio = true
    }
  }
  if (cambio) await ejecutar('systemctl', ['--user', 'daemon-reload'])
}

export async function borrarUnidad(id: string): Promise<void> {
  const unidad = nombreUnidad(id)
  await ejecutar('systemctl', ['--user', 'stop', unidad], { timeoutMs: 30000 })
  const ruta = join(carpetaUnidades(), unidad)
  if (existsSync(ruta)) rmSync(ruta)
  await ejecutar('systemctl', ['--user', 'daemon-reload'])
  await ejecutar('systemctl', ['--user', 'reset-failed', unidad])
}

export interface EstadoUnidad {
  estado: EstadoServicio
  detalle: string
  desde: string | null
}

// systemd escribe las fechas como "Fri 2026-11-27 15:20:22 -05"
function fechaSystemd(v: string | undefined): string | null {
  if (!v || v === 'n/a') return null
  const m = v.match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/)
  if (!m) return null
  const d = new Date(`${m[1]}T${m[2]}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// Estado de varias unidades en una sola llamada (systemctl show separa cada una con línea vacía)
export async function estadoUnidades(ids: string[]): Promise<Map<string, EstadoUnidad>> {
  const res = new Map<string, EstadoUnidad>()
  if (ids.length === 0) return res
  const props = ['Id', 'LoadState', 'ActiveState', 'SubState', 'Result', 'ExecMainStatus', 'ActiveEnterTimestamp', 'InactiveEnterTimestamp']
  const r = await ejecutar('systemctl', ['--user', 'show', ...ids.map(nombreUnidad), '-p', props.join(',')])
  const porUnidad = new Map<string, Record<string, string>>()
  for (const bloque of r.stdout.split(/\n\s*\n/)) {
    const kv: Record<string, string> = {}
    for (const l of bloque.split('\n')) {
      const p = l.indexOf('=')
      if (p > 0) kv[l.slice(0, p)] = l.slice(p + 1)
    }
    if (kv.Id) porUnidad.set(kv.Id, kv)
  }
  for (const id of ids) res.set(id, interpretar(porUnidad.get(nombreUnidad(id)) ?? {}, r.codigo === 0))
  return res
}

function interpretar(kv: Record<string, string>, ok: boolean): EstadoUnidad {
  if (!ok || !kv.ActiveState) return { estado: 'desconocido', detalle: 'No se pudo consultar systemd', desde: null }
  if (kv.LoadState === 'not-found') return { estado: 'detenido', detalle: 'Nunca se ha encendido', desde: null }
  const desde = fechaSystemd(kv.ActiveEnterTimestamp)
  switch (kv.ActiveState) {
    case 'active':
      return { estado: 'activo', detalle: 'Capturando', desde }
    case 'activating':
    case 'reloading':
      return { estado: 'iniciando', detalle: 'Arrancando…', desde: null }
    case 'deactivating':
      return { estado: 'iniciando', detalle: 'Deteniendo…', desde: null }
    case 'failed': {
      const cuando = fechaSystemd(kv.InactiveEnterTimestamp)
      const hora = cuando ? ` a las ${new Date(cuando).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}` : ''
      return { estado: 'fallo', detalle: `Se detuvo con error${hora} (código ${kv.ExecMainStatus || '?'}, ${kv.Result})`, desde: null }
    }
    default:
      return { estado: 'detenido', detalle: 'Apagado', desde: null }
  }
}

export async function accionUnidad(id: string, accion: 'iniciar' | 'detener' | 'reiniciar'): Promise<ResultadoServicio> {
  const verbo = accion === 'iniciar' ? 'start' : accion === 'detener' ? 'stop' : 'restart'
  const unidad = nombreUnidad(id)
  // Tras un fallo, start no arranca si systemd la tiene marcada como failed por límite de reinicios
  if (verbo !== 'stop') await ejecutar('systemctl', ['--user', 'reset-failed', unidad])
  const r = await ejecutar('systemctl', ['--user', verbo, unidad], { timeoutMs: 60000 })
  if (r.codigo !== 0) return { ok: false, mensaje: `systemctl --user ${verbo} ${unidad} falló:\n${resumirError(r)}` }
  return { ok: true }
}

export async function logsUnidad(id: string, lineas = 300): Promise<string> {
  const r = await ejecutar('journalctl', ['--user', '-u', nombreUnidad(id), '-n', String(lineas), '--no-pager', '-o', 'short-iso'], {
    timeoutMs: 15000
  })
  const txt = r.stdout.trim()
  if (!txt || txt === '-- No entries --') return '(sin logs todavía)'
  return txt
}

// Último resumen "Minuto capturado: nginx=ok …" que escribió captura_servidor.sh
export async function ultimoMinuto(id: string): Promise<string | null> {
  const r = await ejecutar('journalctl', ['--user', '-u', nombreUnidad(id), '-n', '40', '--no-pager', '-o', 'cat'], { timeoutMs: 10000 })
  const lineas = r.stdout.split('\n').filter((l) => l.includes('Minuto capturado:'))
  const ult = lineas[lineas.length - 1]
  if (!ult) return null
  const m = ult.match(/^\[([^\]]+)\] Minuto capturado:\s*(.*)$/)
  return m ? `${m[1].slice(11, 16)} — ${m[2]}` : ult
}
