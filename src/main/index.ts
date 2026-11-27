import { app, dialog, globalShortcut, ipcMain, session } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { initDb, listTasks } from './db'
import { isDatabaseExcluded } from './settings'
import { initBubble, updateBubbleBadge } from './bubble'
import { registerIpc } from './ipc'
import {
  buildAppMenu,
  createTrayAndPanel,
  broadcast,
  hidePanel,
  setPanelPinned,
  showPanel,
  togglePanel,
  refreshTrayMenu
} from './window'
import { hideManager, openManager, openManagerAt, takePendingSelect, toggleManager } from './manager'
import { initReminders, refreshReminders } from './reminders'
import { getAutostart, setAutostart } from './autostart'
import { initSyncState, onDataChanged, onSyncStateChange, startAutoSync, stopAutoSync } from './sync'
import { abrirServicios, initServicios, serviciosDisponibles } from './servicios'
import { checkForUpdates, getUpdateState, initUpdater, installUpdate, openDownloadPage, stopUpdater } from './updater'

// Carpeta de datos fija (tareas, token, ajustes), sin depender del nombre visible de la app.
// En desarrollo se usa una aparte: así `npm run dev` y la app instalada no comparten la
// base de datos ni el bloqueo de instancia única (pueden abrirse a la vez).
const DATA_DIR = 'local-management-center'
const dataPath = join(app.getPath('appData'), app.isPackaged ? DATA_DIR : `${DATA_DIR}-dev`)
if (!app.isPackaged && !existsSync(dataPath)) {
  // Primera vez en desarrollo: arrancar con una copia de los datos que ya tenías
  const from = join(app.getPath('appData'), DATA_DIR)
  mkdirSync(dataPath, { recursive: true })
  for (const f of ['settings.json', 'tasks.sqlite', 'tasks.sqlite-wal', 'tasks.sqlite-shm', 'Local State']) {
    if (existsSync(join(from, f))) copyFileSync(join(from, f), join(dataPath, f))
  }
}
app.setPath('userData', dataPath)

// Windows: necesario para que las notificaciones muestren el nombre de la app
if (process.platform === 'win32') app.setAppUserModelId('com.roquecastro.localmanagementcenter')

// Garantizar una sola instancia de la app. app.quit() es asíncrono, así que se sale
// de inmediato para que la segunda instancia no llegue a inicializar DB, atajo, etc.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.exit(0)
}

// Volver a abrir la app (ej. desde el lanzador) muestra el panel de la instancia existente;
// con --servicios abre la ventana de Servicios.
app.on('second-instance', (_e, argv) => {
  if (serviciosDisponibles && argv.includes('--servicios')) abrirServicios()
  else showPanel()
})

app.whenReady().then(() => {
  // Permitir el uso del micrófono (para dictar tareas por voz)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media')
  })

  initDb()
  initSyncState()
  registerIpc()
  createTrayAndPanel()

  // Burbuja flotante en pantalla (click → gestor de tareas, arrastrable, contador de pendientes)
  initBubble({
    onClick: () => {
      hidePanel()
      toggleManager()
    },
    buildMenu: buildAppMenu,
    getBadge: () =>
      listTasks().filter(
        (t) => t.status === 'pending' && !(t.notionDb && isDatabaseExcluded(t.notionDb))
      ).length
  })

  // Reenviar eventos de sync al panel (React) para refrescar UI e indicador
  onSyncStateChange((s) => broadcast('sync:state', s))
  onDataChanged(() => {
    broadcast('data:changed')
    updateBubbleBadge()
    refreshReminders()
  })

  // Recordatorios: aviso a la hora exacta (+ perdidos al abrir la app)
  initReminders({
    openTask: (taskId) => {
      hidePanel()
      openManagerAt(taskId)
    },
    changed: () => {
      broadcast('data:changed')
      updateBubbleBadge()
    }
  })
  // Servicios (solo Linux): Docker + captura de servidores; enciende los marcados al arrancar
  initServicios()
  if (serviciosDisponibles && process.argv.includes('--servicios')) abrirServicios()

  ipcMain.handle('manager:takeSelect', () => takePendingSelect())
  ipcMain.handle('autostart:get', () => getAutostart())
  ipcMain.handle('autostart:set', (_e, on: boolean) => setAutostart(on))

  // Actualizaciones: busca al arrancar y cada 4 horas; avisa a Ajustes y a la bandeja
  let lastUpdateStatus = ''
  initUpdater({
    onState: (s) => {
      broadcast('update:state', s)
      // El menú solo cambia con el estado (no con cada % de la descarga)
      if (s.status !== lastUpdateStatus) refreshTrayMenu()
      lastUpdateStatus = s.status
    }
  })
  ipcMain.handle('update:get', () => getUpdateState())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.on('update:install', () => installUpdate())
  ipcMain.on('update:openDownload', () => openDownloadPage())

  // Permitir que el renderer oculte el panel (ej: tras crear una tarea con Esc)
  ipcMain.on('panel:hide', () => hidePanel())
  ipcMain.on('panel:setPinned', (_e, pinned: boolean) => setPanelPinned(pinned))
  ipcMain.on('manager:open', () => {
    hidePanel()
    openManager()
  })
  ipcMain.on('manager:hide', () => hideManager())

  // Atajo global para abrir/cerrar el panel desde cualquier app
  const shortcut = 'CommandOrControl+Shift+Space'
  const registered = globalShortcut.register(shortcut, () => togglePanel())
  if (!registered) {
    console.warn(`No se pudo registrar el atajo global ${shortcut} (¿ocupado por otra app?)`)
  }

  // Sincronización automática: al arrancar (si hay conexión) y cada 5 minutos
  startAutoSync()
}).catch(failStartup)

// Si el arranque falla (ej. no carga el módulo nativo de SQLite), avisar y salir. Sin esto
// el proceso queda vivo sin ventanas y con el bloqueo de instancia única tomado, así que
// volver a abrir la app tampoco hace nada.
function failStartup(err: unknown): void {
  const detail = err instanceof Error ? err.stack || err.message : String(err)
  console.error('Error al iniciar la app:', detail)
  dialog.showErrorBox(
    'No se pudo iniciar Centro de Control de Tareas',
    `${detail}\n\nSi el problema sigue, instala la última versión desde\nhttps://github.com/roqueCastro/local-manament-center/releases`
  )
  app.exit(1)
}

// App de bandeja: registrar el listener evita el cierre por defecto.
// La app sigue viva en la bandeja aunque el panel se oculte.
app.on('window-all-closed', () => {
  // intencionalmente vacío: no salir
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopAutoSync()
  stopUpdater()
})
