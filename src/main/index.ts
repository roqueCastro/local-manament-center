import { app, globalShortcut, ipcMain, session } from 'electron'
import { initDb } from './db'
import { registerIpc } from './ipc'
import { createTrayAndPanel, hidePanel, sendToPanel, setPanelPinned, togglePanel } from './window'
import { initSyncState, onDataChanged, onSyncStateChange, startAutoSync, stopAutoSync } from './sync'

// Garantizar una sola instancia de la app
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.whenReady().then(() => {
  // Permitir el uso del micrófono (para dictar tareas por voz)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media')
  })

  initDb()
  initSyncState()
  registerIpc()
  createTrayAndPanel()

  // Reenviar eventos de sync al panel (React) para refrescar UI e indicador
  onSyncStateChange((s) => sendToPanel('sync:state', s))
  onDataChanged(() => sendToPanel('data:changed'))

  // Permitir que el renderer oculte el panel (ej: tras crear una tarea con Esc)
  ipcMain.on('panel:hide', () => hidePanel())
  ipcMain.on('panel:setPinned', (_e, pinned: boolean) => setPanelPinned(pinned))

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
