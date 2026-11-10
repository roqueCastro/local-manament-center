import { app, globalShortcut, ipcMain, session } from 'electron'
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
  togglePanel
} from './window'
import { openManager, toggleManager } from './manager'
import { initSyncState, onDataChanged, onSyncStateChange, startAutoSync, stopAutoSync } from './sync'

// Garantizar una sola instancia de la app. app.quit() es asíncrono, así que se sale
// de inmediato para que la segunda instancia no llegue a inicializar DB, atajo, etc.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.exit(0)
}

// Volver a abrir la app (ej. desde el lanzador) muestra el panel de la instancia existente.
app.on('second-instance', () => showPanel())

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
  })

  // Permitir que el renderer oculte el panel (ej: tras crear una tarea con Esc)
  ipcMain.on('panel:hide', () => hidePanel())
  ipcMain.on('panel:setPinned', (_e, pinned: boolean) => setPanelPinned(pinned))
  ipcMain.on('manager:open', () => {
    hidePanel()
    openManager()
  })

  // Atajo global para abrir/cerrar el panel desde cualquier app
  const shortcut = 'CommandOrControl+Shift+Space'
  const registered = globalShortcut.register(shortcut, () => togglePanel())
  if (!registered) {
    console.warn(`No se pudo registrar el atajo global ${shortcut} (¿ocupado por otra app?)`)
  }

  // Sincronización automática: al arrancar (si hay conexión) y cada 5 minutos
  startAutoSync()
})

// App de bandeja: registrar el listener evita el cierre por defecto.
// La app sigue viva en la bandeja aunque el panel se oculte.
app.on('window-all-closed', () => {
  // intencionalmente vacío: no salir
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopAutoSync()
})
