import { app, Notification, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import appIconPath from '../../resources/icon.png?asset'
import type { UpdateState } from '../shared/types'

// Actualizaciones de la app instalada (electron-updater + GitHub Releases).
// - Windows y Linux (.deb): se descarga sola en segundo plano y se instala al reiniciar
//   (o al salir de la app). En Linux pide la contraseña para instalar el .deb.
// - macOS sin firma de Apple: no puede instalarse sola; se avisa y se abre la página
//   de descarga.
// - En desarrollo (npm run dev) no se busca nada.

const RELEASES_URL = 'https://github.com/roqueCastro/local-manament-center/releases/latest'
const FIRST_CHECK_MS = 15_000 // tras arrancar (deja terminar el primer sync)
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000 // cada 4 horas

const manualOnly = process.platform === 'darwin'

let state: UpdateState = { current: app.getVersion(), status: app.isPackaged ? 'idle' : 'dev' }
let onChange: (s: UpdateState) => void = () => {}
let notifiedVersion: string | null = null
let timer: NodeJS.Timeout | null = null

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  onChange(state)
}

// Mensaje corto y entendible para los errores más comunes
function friendlyError(err: unknown): string {
  const msg = String((err as Error)?.message ?? err)
  if (/404|Cannot find latest|No published versions/i.test(msg)) return 'Aún no hay versiones publicadas.'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/i.test(msg)) return 'Sin conexión a internet.'
  return msg.split('\n')[0].slice(0, 200)
}

function notify(title: string, body: string, onClick: () => void): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, icon: appIconPath })
  n.on('click', onClick)
  n.show()
}

export function getUpdateState(): UpdateState {
  return state
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) return state
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return state
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ status: 'error', message: friendlyError(err), checkedAt: new Date().toISOString() })
  }
  return state
}

// Reinicia la app instalando la versión descargada
export function installUpdate(): void {
  if (state.status !== 'ready') return
  // Windows: instalación silenciosa y vuelve a abrir la app al terminar
  autoUpdater.quitAndInstall(true, true)
}

export function openDownloadPage(): void {
  void shell.openExternal(RELEASES_URL)
}

export function initUpdater(opts: { onState: (s: UpdateState) => void }): void {
  onChange = opts.onState
  if (!app.isPackaged) return

  autoUpdater.autoDownload = !manualOnly
  autoUpdater.autoInstallOnAppQuit = !manualOnly
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', message: undefined }))
  autoUpdater.on('update-not-available', () =>
    set({ status: 'none', version: undefined, checkedAt: new Date().toISOString() })
  )
  autoUpdater.on('update-available', (info) => {
    const checkedAt = new Date().toISOString()
    if (!manualOnly) {
      set({ status: 'downloading', version: info.version, percent: 0, checkedAt })
      return
    }
    set({ status: 'manual', version: info.version, checkedAt })
    if (notifiedVersion !== info.version) {
      notifiedVersion = info.version
      notify('Nueva versión disponible', `Versión ${info.version}. Haz clic para descargarla.`, openDownloadPage)
    }
  })
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => {
    set({ status: 'ready', version: info.version, percent: 100 })
    if (notifiedVersion !== info.version) {
      notifiedVersion = info.version
      notify(
        'Actualización lista',
        `Versión ${info.version} descargada. Haz clic para reiniciar e instalarla (o se instalará al salir).`,
        installUpdate
      )
    }
  })
  autoUpdater.on('error', (err) => {
    // Si la descarga falla, se vuelve a intentar en la próxima búsqueda
    set({ status: 'error', message: friendlyError(err), checkedAt: new Date().toISOString() })
  })

  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS)
  timer = setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}

export function stopUpdater(): void {
  if (timer) clearInterval(timer)
  timer = null
}
