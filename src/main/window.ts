import { BrowserWindow, Tray, Menu, screen, nativeImage, app } from 'electron'
import { join } from 'path'
import trayTemplatePath from '../../resources/trayTemplate.png?asset'
import trayColorPath from '../../resources/trayColor.png?asset'
import { getBubbleBounds, isBubbleEnabled, setBubbleEnabled } from './bubble'
import { openManager } from './manager'

const PANEL_WIDTH = 420
const PANEL_HEIGHT = 600

let panel: BrowserWindow | null = null
let tray: Tray | null = null
let pinned = false
// Momento del último show: en Linux, al cerrarse el menú del AppIndicator puede llegar
// un blur espurio justo después de mostrar el panel.
let shownAt = 0
// Momento en que el panel se ocultó por perder el foco: al pulsar la burbuja/icono con el
// panel abierto, primero llega el blur (oculta) y luego el click; sin esto lo volvería a abrir.
let hiddenByBlurAt = 0

// Mientras esté fijado, el panel no se oculta al perder el foco.
export function setPanelPinned(value: boolean): void {
  pinned = value
}

function createPanel(): BrowserWindow {
  const preloadPath = join(__dirname, '../preload/index.js')
  const win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Ocultar al perder el foco → comportamiento tipo popover
  win.on('blur', () => {
    if (Date.now() - shownAt < 400) return
    if (!pinned && !win.webContents.isDevToolsOpened()) {
      hiddenByBlurAt = Date.now()
      win.hide()
    }
  })

  // Diagnóstico: si el preload falla al cargar, Electron lo reporta aquí.
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    // eslint-disable-next-line no-console
    console.error('[PRELOAD-ERROR] No se pudo cargar el preload:', preloadPath, '\n', error)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function positionPanel(): void {
  if (!panel) return
  const trayBounds = tray?.getBounds()
  const { width: panelW, height: panelH } = panel.getBounds()
  const bubbleBounds = getBubbleBounds()

  if (bubbleBounds) {
    // Burbuja visible: abrir el panel a su lado, hacia el centro de la pantalla
    const c = {
      x: bubbleBounds.x + bubbleBounds.width / 2,
      y: bubbleBounds.y + bubbleBounds.height / 2
    }
    const workArea = screen.getDisplayNearestPoint(c).workArea
    const bubbleOnRight = c.x > workArea.x + workArea.width / 2
    let x = bubbleOnRight ? bubbleBounds.x - panelW - 4 : bubbleBounds.x + bubbleBounds.width + 4
    let y = bubbleBounds.y
    x = Math.max(workArea.x + 4, Math.min(x, workArea.x + workArea.width - panelW - 4))
    y = Math.max(workArea.y + 4, Math.min(y, workArea.y + workArea.height - panelH - 4))
    panel.setPosition(Math.round(x), Math.round(y), false)
  } else if (trayBounds && trayBounds.width > 0) {
    const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y })
    const workArea = display.workArea
    let x = Math.round(trayBounds.x + trayBounds.width / 2 - panelW / 2)
    let y: number
    if (process.platform === 'darwin') {
      // macOS: bandeja arriba → panel debajo
      y = Math.round(trayBounds.y + trayBounds.height + 4)
    } else {
      // Windows/Linux: bandeja abajo → panel encima
      y = Math.round(trayBounds.y - panelH - 4)
    }
    // Mantener dentro del área visible
    x = Math.max(workArea.x + 4, Math.min(x, workArea.x + workArea.width - panelW - 4))
    y = Math.max(workArea.y + 4, Math.min(y, workArea.y + workArea.height - panelH - 4))
    panel.setPosition(x, y, false)
  } else {
    // Linux (AppIndicator) no informa la posición del icono: usar la pantalla del cursor
    // y pegar el panel a la esquina del lado donde está la barra (arriba en GNOME, abajo en KDE).
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const { workArea, bounds } = display
    const barOnTop = workArea.y > bounds.y
    panel.setPosition(
      workArea.x + workArea.width - panelW - 12,
      barOnTop ? workArea.y + 12 : workArea.y + workArea.height - panelH - 12,
      false
    )
  }
}

export function showPanel(): void {
  if (!panel) return
  positionPanel()
  shownAt = Date.now()
  panel.show()
  panel.focus()
}

export function togglePanel(): void {
  if (!panel) return
  if (panel.isVisible()) {
    panel.hide()
  } else if (Date.now() - hiddenByBlurAt > 300) {
    showPanel()
  }
}

// Menú compartido: icono de bandeja y click derecho sobre la burbuja.
export function buildAppMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: 'Abrir panel', click: () => showPanel() },
    {
      label: 'Abrir gestor de tareas',
      click: () => {
        hidePanel()
        openManager()
      }
    },
    {
      label: 'Mostrar burbuja',
      type: 'checkbox',
      checked: isBubbleEnabled(),
      click: (item) => {
        setBubbleEnabled(item.checked)
        refreshTrayMenu()
      }
    },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() }
  ])
}

// En Linux el menú queda fijado al AppIndicator: hay que reconstruirlo para reflejar el checkbox.
function refreshTrayMenu(): void {
  if (tray && process.platform === 'linux') tray.setContextMenu(buildAppMenu())
}

export function hidePanel(): void {
  panel?.hide()
}

// Envía un evento a todas las ventanas (panel, gestor, burbuja).
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args)
  }
}

export function createTrayAndPanel(): void {
  panel = createPanel()

  const isMac = process.platform === 'darwin'
  const image = nativeImage.createFromPath(isMac ? trayTemplatePath : trayColorPath)
  if (isMac) {
    image.setTemplateImage(true) // se adapta a modo claro/oscuro
  }
  tray = new Tray(image)
  tray.setToolTip('Centro de Control de Tareas')
  tray.on('click', () => togglePanel())
  // macOS/Windows: click derecho → menú (abrir panel, mostrar/ocultar burbuja, salir)
  tray.on('right-click', () => tray?.popUpContextMenu(buildAppMenu()))

  // Linux (AppIndicator / StatusNotifier) no emite eventos de click: el único modo
  // de interactuar con el icono es su menú contextual.
  refreshTrayMenu()

  // En macOS, evitar que aparezca en el Dock (app de barra de menú)
  if (process.platform === 'darwin') {
    app.dock?.hide()
  }
}
