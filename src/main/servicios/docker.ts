import type { ContenedorEstado, DockerConfig, EstadoServicio, ResultadoServicio } from '../../shared/types'
import { ejecutar, resumirError } from './ejecutar'

// Proyectos de docker compose. Se encienden con `up -d` y se apagan con `stop` (no `down`):
// `down` borra los contenedores y Graylog, que no persiste su carpeta de datos, arrancaría
// con otro node-id y perdería el journal.

// El compose de ListenerServer monta volúmenes con ${PWD}: hay que pasarlo además del cwd,
// porque Node no actualiza PWD al cambiar de carpeta.
function envCompose(d: DockerConfig): { cwd: string; env: Record<string, string> } {
  return { cwd: d.dir, env: { PWD: d.dir } }
}

export async function dockerDisponible(): Promise<boolean> {
  const r = await ejecutar('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 8000 })
  return r.codigo === 0
}

// Servicios declarados en el compose (para saber cuántos contenedores deberían estar arriba)
const serviciosCompose = new Map<string, string[]>()
async function serviciosDeclarados(d: DockerConfig): Promise<string[] | null> {
  const cache = serviciosCompose.get(d.id)
  if (cache) return cache
  const r = await ejecutar('docker', ['compose', '-p', d.id, 'config', '--services'], {
    ...envCompose(d),
    timeoutMs: 15000
  })
  if (r.codigo !== 0) return null
  const lista = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  serviciosCompose.set(d.id, lista)
  return lista
}

export async function contenedores(d: DockerConfig): Promise<ContenedorEstado[]> {
  const r = await ejecutar(
    'docker',
    [
      'ps', '-a',
      '--filter', `label=com.docker.compose.project=${d.id}`,
      '--format', '{{.Names}}\t{{.Label "com.docker.compose.service"}}\t{{.State}}\t{{.Status}}'
    ],
    { timeoutMs: 10000 }
  )
  if (r.codigo !== 0) return []
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [nombre, servicio, estado, detalle] = l.split('\t')
      return { nombre, servicio, estado, detalle }
    })
    .sort((a, b) => a.servicio.localeCompare(b.servicio))
}

export interface EstadoDocker {
  estado: EstadoServicio
  detalle: string
  contenedores: ContenedorEstado[]
  desde: string | null
}

export async function estadoDocker(d: DockerConfig): Promise<EstadoDocker> {
  const [lista, declarados] = await Promise.all([contenedores(d), serviciosDeclarados(d)])
  const total = Math.max(declarados?.length ?? 0, lista.length)
  const arriba = lista.filter((c) => c.estado === 'running').length
  const enBucle = lista.filter((c) => c.estado === 'restarting')

  let estado: EstadoServicio
  let detalle: string
  if (lista.length === 0) {
    estado = 'detenido'
    detalle = declarados ? 'Sin contenedores creados' : 'No se encontró el docker-compose.yml'
  } else if (enBucle.length > 0) {
    estado = 'fallo'
    detalle = `Reiniciándose en bucle: ${enBucle.map((c) => c.nombre).join(', ')}`
  } else if (arriba === 0) {
    estado = 'detenido'
    detalle = `0/${total} contenedores encendidos`
  } else if (arriba < total) {
    estado = 'parcial'
    const caidos = lista.filter((c) => c.estado !== 'running').map((c) => c.nombre)
    detalle = `${arriba}/${total} encendidos${caidos.length ? ` — apagados: ${caidos.join(', ')}` : ''}`
  } else {
    estado = 'activo'
    detalle = `${arriba}/${total} contenedores encendidos`
  }
  return { estado, detalle, contenedores: lista, desde: null }
}

export async function accionDocker(d: DockerConfig, accion: 'iniciar' | 'detener' | 'reiniciar'): Promise<ResultadoServicio> {
  const args =
    accion === 'iniciar'
      ? ['compose', '-p', d.id, 'up', '-d']
      : accion === 'detener'
        ? ['compose', '-p', d.id, 'stop']
        : ['compose', '-p', d.id, 'restart']
  // up -d puede tener que construir imágenes (el webhook): hasta 10 min
  const r = await ejecutar('docker', args, { ...envCompose(d), timeoutMs: accion === 'iniciar' ? 600_000 : 180_000 })
  serviciosCompose.delete(d.id)
  if (r.codigo !== 0) return { ok: false, mensaje: `docker compose ${args.slice(3).join(' ')} falló:\n${resumirError(r)}` }
  return { ok: true }
}

export async function reiniciarContenedor(d: DockerConfig, nombre: string): Promise<ResultadoServicio> {
  // Solo contenedores de este proyecto (el nombre viene del renderer)
  const lista = await contenedores(d)
  if (!lista.some((c) => c.nombre === nombre)) return { ok: false, mensaje: `El contenedor ${nombre} no es del proyecto ${d.id}.` }
  const r = await ejecutar('docker', ['restart', nombre], { timeoutMs: 120_000 })
  if (r.codigo !== 0) return { ok: false, mensaje: `docker restart ${nombre} falló:\n${resumirError(r)}` }
  return { ok: true }
}

export async function logsContenedor(d: DockerConfig, nombre: string | null): Promise<string> {
  const lista = await contenedores(d)
  const c = nombre ? lista.find((x) => x.nombre === nombre) : null
  if (!c) {
    // Sin contenedor elegido: los de todo el proyecto
    const r = await ejecutar('docker', ['compose', '-p', d.id, 'logs', '--tail', '40', '--no-color', '--timestamps'], {
      ...envCompose(d),
      timeoutMs: 20000
    })
    return (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim() || '(sin logs)'
  }
  const r = await ejecutar('docker', ['logs', '--tail', '300', '--timestamps', c.nombre], { timeoutMs: 20000 })
  // docker logs escribe la salida del contenedor por stdout y stderr: se mezclan por fecha
  const lineas = (r.stdout + '\n' + r.stderr).split('\n').filter(Boolean)
  lineas.sort()
  return lineas.join('\n') || '(sin logs)'
}
