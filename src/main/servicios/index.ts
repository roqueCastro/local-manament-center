import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import appIconPath from '../../../resources/icon.png?asset'
import type {
  AccionServicio,
  EstadoServicio,
  ResultadoServicio,
  ServicioEstado,
  ServidorConfig,
  ServiciosResumen
} from '../../shared/types'
import { guardarConfig, leerConfig, recargarConfig, rutaConfig, validarServidor } from './config'
import { accionDocker, dockerDisponible, estadoDocker, logsContenedor, reiniciarContenedor } from './docker'
import { ejecutar } from './ejecutar'
import {
  accionUnidad,
  borrarUnidad,
  estadoUnidades,
  logsUnidad,
  rutaScript,
  sincronizarUnidades,
  ultimoMinuto
} from './systemd'

// Ventana "Servicios" (solo Linux): Docker compose + captura de servidores.
// - Al arrancar la app enciende los servicios marcados "con el PC" (primero Docker, luego
//   las capturas, en el orden del servicios.json).
// - Si un servicio que estaba encendido se cae, avisa con una notificación: no lo relanza.

export const serviciosDisponibles = process.platform === 'linux'

const INTERVALO_MONITOR_MS = 30_000
const ESPERA_ARRANQUE_MS = 15_000 // dejar que la sesión y Docker terminen de levantar
const GRACIA_ACCION_MS = 120_000 // tras una acción de la app, sus cambios no son "caídas"

let ventana: BrowserWindow | null = null
let saliendo = false
app.on('before-quit', () => {
  saliendo = true
})

// ---- Estado ----

async function consultar(): Promise<ServiciosResumen> {
  const cfg = leerConfig()
  const avisos: string[] = []
  const dockerOk = await dockerDisponible()
  if (!dockerOk && cfg.docker.length) avisos.push('Docker no responde: no se puede ver ni controlar los contenedores.')
  if (cfg.servidores.length && (!cfg.baseDir || !existsSync(rutaScript(cfg.baseDir))))
    avisos.push(`No se encontró ${cfg.baseDir ? rutaScript(cfg.baseDir) : 'baseDir'}: revisa "baseDir" en servicios.json.`)

  // loop_logs.sh y la captura de la app sobre el mismo servidor descargarían todo dos veces
  const loop = await ejecutar('pgrep', ['-af', 'loop_logs.sh'])
  // Solo el script en ejecución ("bash …/loop_logs.sh -sv ultra"), no un editor con el archivo abierto
  const loops = loop.stdout.split('\n').filter((l) => /^\d+\s+\S*\bbash\s+\S*loop_logs\.sh(\s|$)/.test(l))
  if (loops.length)
    avisos.push(
      `loop_logs.sh está corriendo (${loops.map((l) => l.replace(/^.*loop_logs\.sh/, 'loop_logs.sh').trim()).join('; ')}). ` +
        'Si también enciendes aquí la captura de esos servidores, sus logs se descargarán dos veces.'
    )

  const servicios: ServicioEstado[] = []
  const docker = await Promise.all(
    cfg.docker.map(async (d) => {
      const e = dockerOk
        ? await estadoDocker(d)
        : { estado: 'desconocido' as EstadoServicio, detalle: 'Docker no responde', contenedores: [], desde: null }
      return {
        id: `docker:${d.id}`,
        tipo: 'docker' as const,
        etiqueta: d.etiqueta || d.id,
        estado: e.estado,
        detalle: e.detalle,
        desde: e.desde,
        alIniciar: d.alIniciar,
        contenedores: e.contenedores
      }
    })
  )
  servicios.push(...docker)

  const unidades = await estadoUnidades(cfg.servidores.map((s) => s.id))
  const capturas = await Promise.all(
    cfg.servidores.map(async (s) => {
      const u = unidades.get(s.id) ?? { estado: 'desconocido' as EstadoServicio, detalle: '', desde: null }
      return {
        id: `srv:${s.id}`,
        tipo: 'captura' as const,
        etiqueta: s.etiqueta || s.nombre,
        estado: u.estado,
        detalle: u.detalle,
        desde: u.desde,
        alIniciar: s.alIniciar,
        servidor: s,
        ultimoMinuto: u.estado === 'activo' || u.estado === 'fallo' ? await ultimoMinuto(s.id) : null
      }
    })
  )
  servicios.push(...capturas)

  return { disponible: true, dockerOk, avisos, servicios, configPath: rutaConfig(), baseDir: cfg.baseDir }
}

function avisarCambio(): void {
  if (ventana && !ventana.isDestroyed()) ventana.webContents.send('servicios:cambio')
}

// ---- Acciones ----

const ultimaAccion = new Map<string, number>() // id → momento de la última acción de la app

function buscar(id: string): { docker?: ReturnType<typeof leerConfig>['docker'][number]; servidor?: ServidorConfig } {
  const cfg = leerConfig()
  if (id.startsWith('docker:')) return { docker: cfg.docker.find((d) => `docker:${d.id}` === id) }
  if (id.startsWith('srv:')) return { servidor: cfg.servidores.find((s) => `srv:${s.id}` === id) }
  return {}
}

async function accion(id: string, acc: AccionServicio): Promise<ResultadoServicio> {
  if (!['iniciar', 'detener', 'reiniciar'].includes(acc)) return { ok: false, mensaje: 'Acción desconocida.' }
  const { docker, servidor } = buscar(id)
  ultimaAccion.set(id, Date.now())
  let r: ResultadoServicio
  if (docker) {
    r = await accionDocker(docker, acc)
  } else if (servidor) {
    const cfg = leerConfig()
    if (acc !== 'detener' && !existsSync(rutaScript(cfg.baseDir)))
      return { ok: false, mensaje: `No existe ${rutaScript(cfg.baseDir)}. Revisa "baseDir" en servicios.json.` }
    await sincronizarUnidades(cfg.servidores, cfg.baseDir)
    r = await accionUnidad(servidor.id, acc)
  } else {
    r = { ok: false, mensaje: 'Ese servicio ya no está en la configuración.' }
  }
  ultimaAccion.set(id, Date.now())
  avisarCambio()
  return r
}

function setAlIniciar(id: string, on: boolean): ResultadoServicio {
  const cfg = leerConfig()
  const d = cfg.docker.find((x) => `docker:${x.id}` === id)
  const s = cfg.servidores.find((x) => `srv:${x.id}` === id)
  if (!d && !s) return { ok: false, mensaje: 'Ese servicio ya no está en la configuración.' }
  if (d) d.alIniciar = on
  if (s) s.alIniciar = on
  guardarConfig(cfg)
  return { ok: true }
}

async function guardarServidor(s: ServidorConfig, idOriginal: string | null): Promise<ResultadoServicio> {
  const limpio: ServidorConfig = {
    id: String(s.id ?? '').trim(),
    nombre: String(s.nombre ?? '').trim(),
    etiqueta: String(s.etiqueta ?? '').trim(),
    ip: String(s.ip ?? '').trim(),
    tipos: Array.isArray(s.tipos) ? s.tipos : [],
    metricas: !!s.metricas,
    alIniciar: !!s.alIniciar
  }
  const error = validarServidor(limpio, idOriginal)
  if (error) return { ok: false, mensaje: error }
  const cfg = leerConfig()
  const i = idOriginal ? cfg.servidores.findIndex((x) => x.id === idOriginal) : -1

  // Cambiar el identificador = otra unidad de systemd: solo con la captura apagada
  let estabaActivo = false
  if (i >= 0) {
    const u = (await estadoUnidades([idOriginal!])).get(idOriginal!)
    estabaActivo = u?.estado === 'activo'
    if (idOriginal !== limpio.id && estabaActivo)
      return { ok: false, mensaje: 'Apaga la captura antes de cambiar el identificador.' }
    if (idOriginal !== limpio.id) await borrarUnidad(idOriginal!)
    cfg.servidores[i] = limpio
  } else {
    cfg.servidores.push(limpio)
  }
  guardarConfig(cfg)
  await sincronizarUnidades(cfg.servidores, cfg.baseDir)
  avisarCambio()
  if (estabaActivo)
    return { ok: true, mensaje: 'Guardado. La captura sigue con la configuración anterior hasta que la reinicies.' }
  return { ok: true }
}

async function eliminarServidor(id: string): Promise<ResultadoServicio> {
  const cfg = leerConfig()
  const s = cfg.servidores.find((x) => `srv:${x.id}` === id)
  if (!s) return { ok: false, mensaje: 'Ese servidor ya no está en la configuración.' }
  ultimaAccion.set(id, Date.now())
  await borrarUnidad(s.id) // la apaga si estaba encendida
  cfg.servidores = cfg.servidores.filter((x) => x.id !== s.id)
  guardarConfig(cfg)
  estadoPrevio.delete(id)
  avisarCambio()
  return { ok: true }
}

async function logs(id: string, contenedor: string | null): Promise<string> {
  const { docker, servidor } = buscar(id)
  if (docker) return logsContenedor(docker, contenedor)
  if (servidor) return logsUnidad(servidor.id)
  return '(servicio no encontrado)'
}

// ---- Monitor de caídas ----

const estadoPrevio = new Map<string, EstadoServicio>()
const ENCENDIDO: EstadoServicio[] = ['activo', 'parcial']

function notificar(titulo: string, cuerpo: string, id?: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: titulo, body: cuerpo, icon: appIconPath, urgency: 'critical' })
  n.on('click', () => abrirServicios(id))
  n.show()
}

async function revisar(): Promise<void> {
  let r: ServiciosResumen
  try {
    r = await consultar()
  } catch {
    return
  }
  for (const s of r.servicios) {
    const antes = estadoPrevio.get(s.id)
    estadoPrevio.set(s.id, s.estado)
    if (!antes || s.estado === 'desconocido' || antes === s.estado) continue
    if (Date.now() - (ultimaAccion.get(s.id) ?? 0) < GRACIA_ACCION_MS) continue
    // Estaba encendido (o a medias) y ahora está peor
    const peor =
      (ENCENDIDO.includes(antes) && (s.estado === 'fallo' || s.estado === 'detenido')) ||
      (antes === 'activo' && s.estado === 'parcial')
    if (peor) {
      const que = s.tipo === 'docker' ? 'Docker' : 'Captura'
      notificar(`⚠️ ${que}: ${s.etiqueta} ${s.estado === 'parcial' ? 'quedó a medias' : 'se cayó'}`, `${s.detalle}\nAbre Servicios para revisarlo y reiniciarlo.`, s.id)
    }
  }
}

// ---- Encender al arrancar ----

async function esperarDocker(maxMs: number): Promise<boolean> {
  const fin = Date.now() + maxMs
  while (Date.now() < fin) {
    if (await dockerDisponible()) return true
    await new Promise((r) => setTimeout(r, 5000))
  }
  return false
}

async function encenderMarcados(): Promise<void> {
  const cfg = recargarConfig()
  const marcados = [...cfg.docker.filter((d) => d.alIniciar).map((d) => `docker:${d.id}`), ...cfg.servidores.filter((s) => s.alIniciar).map((s) => `srv:${s.id}`)]
  if (marcados.length === 0) return

  const inicial = await consultar()
  const encendidos: string[] = []
  const fallidos: string[] = []
  if (cfg.docker.some((d) => d.alIniciar) && !(await esperarDocker(120_000))) {
    fallidos.push('Docker no respondió en 2 minutos')
  }
  for (const id of marcados) {
    const s = inicial.servicios.find((x) => x.id === id)
    if (!s || s.estado === 'activo') continue
    if (id.startsWith('docker:') && fallidos.length) continue
    const r = await accion(id, 'iniciar')
    if (r.ok) encendidos.push(s.etiqueta)
    else fallidos.push(`${s.etiqueta}: ${(r.mensaje ?? '').split('\n').slice(-1)[0]}`)
  }
  if (fallidos.length) notificar('⚠️ Servicios: no se pudo encender todo', fallidos.join('\n'))
  else if (encendidos.length) notificar('Servicios encendidos', encendidos.join(', '))
  await revisar()
}

// ---- Ventana ----

export function abrirServicios(seleccionar?: string): void {
  if (ventana && !ventana.isDestroyed()) {
    if (ventana.isMinimized()) ventana.restore()
    ventana.show()
    ventana.focus()
    if (seleccionar) ventana.webContents.send('servicios:seleccionar', seleccionar)
    return
  }
  recargarConfig()
  const win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 920,
    minHeight: 560,
    title: 'Servicios',
    icon: appIconPath,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => {
    win.show()
    if (seleccionar) win.webContents.send('servicios:seleccionar', seleccionar)
  })
  // Cerrar solo la oculta (la app sigue en la bandeja)
  win.on('close', (e) => {
    if (!saliendo) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    if (ventana === win) ventana = null
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) win.loadURL(`${devUrl}#servicios`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'servicios' })
  ventana = win
}

// ---- Inicio ----

export function initServicios(): void {
  ipcMain.handle('servicios:estado', async (): Promise<ServiciosResumen> => {
    if (!serviciosDisponibles)
      return { disponible: false, dockerOk: false, avisos: [], servicios: [], configPath: '', baseDir: '' }
    const r = await consultar()
    for (const s of r.servicios) if (!estadoPrevio.has(s.id)) estadoPrevio.set(s.id, s.estado)
    return r
  })
  ipcMain.handle('servicios:accion', (_e, id: string, acc: AccionServicio) => accion(String(id), acc))
  ipcMain.handle('servicios:reiniciarContenedor', async (_e, id: string, contenedor: string) => {
    const { docker } = buscar(String(id))
    if (!docker) return { ok: false, mensaje: 'Proyecto no encontrado.' }
    ultimaAccion.set(String(id), Date.now())
    const r = await reiniciarContenedor(docker, String(contenedor))
    avisarCambio()
    return r
  })
  ipcMain.handle('servicios:logs', (_e, id: string, contenedor: string | null) => logs(String(id), contenedor ? String(contenedor) : null))
  ipcMain.handle('servicios:setAlIniciar', (_e, id: string, on: boolean) => setAlIniciar(String(id), !!on))
  ipcMain.handle('servicios:guardarServidor', (_e, s: ServidorConfig, idOriginal: string | null) =>
    guardarServidor(s, idOriginal ? String(idOriginal) : null)
  )
  ipcMain.handle('servicios:eliminarServidor', (_e, id: string) => eliminarServidor(String(id)))
  ipcMain.on('servicios:abrirConfig', () => {
    if (!existsSync(rutaConfig())) writeFileSync(rutaConfig(), JSON.stringify(leerConfig(), null, 2) + '\n', 'utf-8')
    void shell.openPath(rutaConfig())
  })

  if (!serviciosDisponibles) return

  setTimeout(() => {
    void encenderMarcados()
      .catch(() => undefined)
      .finally(() => {
        setInterval(() => void revisar(), INTERVALO_MONITOR_MS)
      })
  }, ESPERA_ARRANQUE_MS)
}
