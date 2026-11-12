import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import appIconPath from '../../resources/icon.png?asset'
import { getBubbleBounds } from './bubble'

const DEFAULT_WIDTH = 1320
const DEFAULT_HEIGHT = 840
const GAP = 8 // separación entre la burbuja y el gestor

// "Gestor de tareas": ventana grande tipo modal (sin marco, siempre encima) pegada a la
// burbuja. Se oculta al hacer clic fuera (pierde el foco) o con Esc, como el panel.

let manager: BrowserWindow | null = null
// Al cerrar el gestor solo se oculta (reabre al instante y conserva el proyecto elegido);
// se destruye de verdad únicamente al salir de la app.
let quitting = false
app.on('before-quit', () => {
  quitting = true
})

// En Linux, al cerrarse el menú del AppIndicator puede llegar un blur espurio justo
// después de mostrar la ventana.
let shownAt = 0
// Al pulsar la burbuja con el gestor abierto, puede llegar primero el blur (oculta) y
// luego el click: sin esto lo volvería a abrir.
let hiddenByBlurAt = 0

// Click en la burbuja: si el gestor está visible se oculta; si no, se muestra.
export function toggleManager(): void {
  if (manager && !manager.isDestroyed() && manager.isVisible()) {
    manager.hide()
    return
  }
  if (Date.now() - hiddenByBlurAt < 300) return
  openManager()
}

// Abrir el gestor con el detalle de una tarea (ej. desde un recordatorio). Si la ventana aún
// está cargando, el renderer la pide al montarse (takePendingSelect).
let pendingSelect: string | null = null
export function openManagerAt(taskId: string): void {
  pendingSelect = taskId
  openManager()
  if (manager && !manager.isDestroyed() && !manager.webContents.isLoading()) {
    manager.webContents.send('manager:select', taskId)
    pendingSelect = null
  }
}
export function takePendingSelect(): string | null {
  const id = pendingSelect
  pendingSelect = null
  return id
}

export function hideManager(): void {
  if (manager && !manager.isDestroyed()) manager.hide()
}

// Ubica el gestor pegado a la burbuja (del lado que da al centro de la pantalla),
// como el panel. Sin burbuja visible: centrado en la pantalla del cursor.
// Conserva el tamaño que tenga la ventana, ajustándolo si no cabe.
function placeWindow(win: BrowserWindow): void {
  if (win.isMaximized() || win.isFullScreen()) return
  const [curW, curH] = win.getSize()
  const bubble = getBubbleBounds()
  const anchor = bubble
    ? { x: bubble.x + bubble.width / 2, y: bubble.y + bubble.height / 2 }
    : screen.getCursorScreenPoint()
  const wa = screen.getDisplayNearestPoint(anchor).workArea
  const reserved = bubble ? bubble.width + GAP * 2 : 80
  const width = Math.min(curW, wa.width - reserved)
  const height = Math.min(curH, wa.height - GAP * 2)

  let x: number
  let y: number
  if (bubble) {
    const bubbleOnRight = anchor.x > wa.x + wa.width / 2
    x = bubbleOnRight ? bubble.x - width - GAP : bubble.x + bubble.width + GAP
    // Alinear con la burbuja, sin salirse por abajo
    y = bubble.y
  } else {
    x = wa.x + (wa.width - width) / 2
    y = wa.y + (wa.height - height) / 2
  }
  x = Math.max(wa.x + GAP, Math.min(x, wa.x + wa.width - width - GAP))
  y = Math.max(wa.y + GAP, Math.min(y, wa.y + wa.height - height - GAP))
  win.setBounds({ x: Math.round(x), y: Math.round(y), width, height }, false)
}

function present(win: BrowserWindow): void {
  shownAt = Date.now()
  win.show()
  win.focus()
}

export function openManager(): void {
  if (manager && !manager.isDestroyed()) {
    if (manager.isMinimized()) manager.restore()
    placeWindow(manager)
    present(manager)
    return
  }

  const win = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: 900,
    minHeight: 560,
    title: 'Gestor de tareas',
    icon: appIconPath,
    show: false,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setMenuBarVisibility(false)
  placeWindow(win)
  win.once('ready-to-show', () => present(win))

  // Clic fuera (pierde el foco) → ocultar, como un modal
  win.on('blur', () => {
    if (Date.now() - shownAt < 400) return
    if (win.webContents.isDevToolsOpened()) return
    hiddenByBlurAt = Date.now()
    win.hide()
  })
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    if (manager === win) manager = null
  })

  // Misma app React; el hash #manager hace que renderice el gestor en vez del panel.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(`${devUrl}#manager`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'manager' })
  }
  manager = win
}
