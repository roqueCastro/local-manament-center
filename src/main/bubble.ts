import { BrowserWindow, Menu, ipcMain, screen } from 'electron'
import type { IpcMainEvent, Point, Rectangle } from 'electron'
import { join } from 'path'
import { getUiSettings, saveUiSettings } from './settings'

// Burbuja flotante tipo "chat head": ventana pequeña, redonda (transparente),
// siempre encima, arrastrable. Click → abre/cierra el panel. Se pega al borde al soltarla.

const SIZE = 64 // tamaño de la ventana (la burbuja visible mide 52px, el resto es margen para el badge/sombra)
const EDGE_MARGIN = 8
const DRAG_THRESHOLD = 4 // px que hay que mover para que cuente como arrastre y no como click

export interface BubbleHandlers {
  onClick: () => void
  buildMenu: () => Menu
  getBadge: () => number // nº de tareas pendientes a mostrar
}

let bubble: BrowserWindow | null = null
let handlers: BubbleHandlers | null = null
let drag: { startCursor: Point; startPos: Point; moved: boolean } | null = null
let snapTimer: NodeJS.Timeout | null = null

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(v, max))
}

function centerOf(x: number, y: number): Point {
  return { x: x + SIZE / 2, y: y + SIZE / 2 }
}

function isInsideSomeDisplay(p: Point): boolean {
  return screen.getAllDisplays().some(({ workArea: w }) => {
    return p.x >= w.x && p.x <= w.x + w.width && p.y >= w.y && p.y <= w.y + w.height
  })
}

// Posición guardada si sigue siendo visible (puede haber cambiado el monitor); si no, borde derecho.
function initialPosition(): Point {
  const saved = getUiSettings().bubblePosition
  if (saved) {
    const c = centerOf(saved.x, saved.y)
    if (isInsideSomeDisplay(c)) return saved
  }
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: workArea.x + workArea.width - SIZE - EDGE_MARGIN,
    y: Math.round(workArea.y + workArea.height * 0.3)
  }
}

function snapTarget(x: number, y: number): Point {
  const c = centerOf(x, y)
  const wa = screen.getDisplayNearestPoint(c).workArea
  const left = c.x < wa.x + wa.width / 2
  return {
    x: left ? wa.x + EDGE_MARGIN : wa.x + wa.width - SIZE - EDGE_MARGIN,
    y: clamp(y, wa.y + EDGE_MARGIN, wa.y + wa.height - SIZE - EDGE_MARGIN)
  }
}

// Desliza la burbuja hasta (tx, ty) en ~120ms y guarda la posición final.
function animateTo(tx: number, ty: number): void {
  if (!bubble) return
  if (snapTimer) clearInterval(snapTimer)
  const [sx, sy] = bubble.getPosition()
  const steps = 8
  let i = 0
  snapTimer = setInterval(() => {
    i++
    const t = 1 - Math.pow(1 - i / steps, 3) // ease-out
    if (bubble && !bubble.isDestroyed()) {
      bubble.setPosition(Math.round(sx + (tx - sx) * t), Math.round(sy + (ty - sy) * t), false)
    }
    if (i >= steps) {
      if (snapTimer) clearInterval(snapTimer)
      snapTimer = null
      saveUiSettings({ bubblePosition: { x: tx, y: ty } })
    }
  }, 15)
}

function createBubbleWindow(): BrowserWindow {
  const { x, y } = initialPosition()
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false, // no roba el foco a la app que estés usando
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  win.once('ready-to-show', () => win.showInactive())
  win.webContents.on('did-finish-load', () => updateBubbleBadge())
  win.on('closed', () => {
    if (bubble === win) bubble = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(`${devUrl}/bubble.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/bubble.html'))
  }
  return win
}

function fromBubble(e: IpcMainEvent): boolean {
  return !!bubble && !bubble.isDestroyed() && e.sender === bubble.webContents
}

function registerBubbleIpc(): void {
  ipcMain.on('bubble:dragStart', (e) => {
    if (!fromBubble(e) || !bubble) return
    if (snapTimer) clearInterval(snapTimer)
    const [x, y] = bubble.getPosition()
    drag = { startCursor: screen.getCursorScreenPoint(), startPos: { x, y }, moved: false }
  })

  ipcMain.on('bubble:dragMove', (e) => {
    if (!fromBubble(e) || !bubble || !drag) return
    const c = screen.getCursorScreenPoint()
    const dx = c.x - drag.startCursor.x
    const dy = c.y - drag.startCursor.y
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    drag.moved = true
    bubble.setPosition(drag.startPos.x + dx, drag.startPos.y + dy, false)
  })

  ipcMain.on('bubble:dragEnd', (e) => {
    if (!fromBubble(e) || !bubble || !drag) return
    const moved = drag.moved
    drag = null
    if (!moved) {
      handlers?.onClick()
      return
    }
    const [x, y] = bubble.getPosition()
    const t = snapTarget(x, y)
    animateTo(t.x, t.y)
  })

  ipcMain.on('bubble:contextMenu', (e) => {
    if (!fromBubble(e) || !bubble || !handlers) return
    handlers.buildMenu().popup({ window: bubble })
  })
}

// Si se desconecta un monitor o cambia la resolución, traer la burbuja de vuelta a la pantalla.
function keepOnScreen(): void {
  if (!bubble || bubble.isDestroyed()) return
  const [x, y] = bubble.getPosition()
  if (!isInsideSomeDisplay(centerOf(x, y))) {
    const t = snapTarget(x, y)
    bubble.setPosition(t.x, t.y, false)
    saveUiSettings({ bubblePosition: t })
  }
}

export function initBubble(h: BubbleHandlers): void {
  handlers = h
  registerBubbleIpc()
  screen.on('display-removed', keepOnScreen)
  screen.on('display-metrics-changed', keepOnScreen)
  if (getUiSettings().bubbleEnabled) bubble = createBubbleWindow()
}

export function isBubbleEnabled(): boolean {
  return getUiSettings().bubbleEnabled
}

export function setBubbleEnabled(enabled: boolean): void {
  saveUiSettings({ bubbleEnabled: enabled })
  if (enabled && (!bubble || bubble.isDestroyed())) {
    bubble = createBubbleWindow()
  } else if (!enabled && bubble && !bubble.isDestroyed()) {
    bubble.destroy()
    bubble = null
  }
}

// Límites de la burbuja si está visible (para posicionar el panel a su lado).
export function getBubbleBounds(): Rectangle | null {
  if (!bubble || bubble.isDestroyed() || !bubble.isVisible()) return null
  return bubble.getBounds()
}

export function updateBubbleBadge(): void {
  if (!bubble || bubble.isDestroyed() || !handlers) return
  bubble.webContents.send('bubble:badge', handlers.getBadge())
}
