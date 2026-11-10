import { BrowserWindow, Tray, screen, nativeImage, app } from 'electron'
import { join } from 'path'
import trayIconPath from '../../resources/trayTemplate.png?asset'

const PANEL_WIDTH = 380
const PANEL_HEIGHT = 520

let panel: BrowserWindow | null = null
let tray: Tray | null = null
let pinned = false

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
    if (!pinned && !win.webContents.isDevToolsOpened()) win.hide()
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

function positionPanelNearTray(): void {
  if (!panel) return
  const trayBounds = tray?.getBounds()
  const { width: panelW, height: panelH } = panel.getBounds()

  if (trayBounds && trayBounds.width > 0) {
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
    const { workArea } = screen.getPrimaryDisplay()
    panel.setPosition(
      workArea.x + workArea.width - panelW - 12,
      workArea.y + workArea.height - panelH - 12,
      false
    )
  }
}

export function togglePanel(): void {
  if (!panel) return
  if (panel.isVisible()) {
    panel.hide()
  } else {
    positionPanelNearTray()
    panel.show()
    panel.focus()
  }
}

export function hidePanel(): void {
  panel?.hide()
}

// Envía un evento al renderer del panel (si existe).
export function sendToPanel(channel: string, ...args: unknown[]): void {
  if (panel && !panel.isDestroyed()) {
    panel.webContents.send(channel, ...args)
  }
}

export function createTrayAndPanel(): void {
  panel = createPanel()

  let image = nativeImage.createFromPath(trayIconPath)
  if (process.platform === 'darwin') {
    image.setTemplateImage(true) // se adapta a modo claro/oscuro
  }
  tray = new Tray(image)
  tray.setToolTip('Centro de Control de Tareas')
  tray.on('click', () => togglePanel())
  tray.on('right-click', () => togglePanel())

  // En macOS, evitar que aparezca en el Dock (app de barra de menú)
  if (process.platform === 'darwin') {
    app.dock?.hide()
  }
}
