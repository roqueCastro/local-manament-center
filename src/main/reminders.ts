import { BrowserWindow, ipcMain, Notification, screen } from 'electron'
import { join } from 'path'
import appIconPath from '../../resources/icon.png?asset'
import type { ReminderAction, ReminderAlert, Task } from '../shared/types'
import { reminderTime } from '../shared/dates'
import { getTask, listTasks } from './db'
import { getBubbleBounds } from './bubble'
import { getReminderState, isDatabaseExcluded, saveReminderState } from './settings'
import { databaseFor, toggleTaskSvc } from './tasks'
import { requestSync } from './sync'

// Recordatorios: cada tarea pendiente con valor en la columna "Recordatorio" (fecha y hora)
// avisa a esa hora con una notificación del sistema + una ventanita siempre encima con
// sonido y botones (abrir, hecha, posponer, descartar). Si la app estaba cerrada, al abrirla
// muestra los avisos perdidos (de los últimos 7 días).

const ON_TIME_MS = 2 * 60 * 1000 // más tarde que esto = "perdido" (la app no estaba abierta)
const MISSED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const SAFETY_TICK_MS = 30 * 1000 // revisión periódica (suspensión del equipo, relojes, etc.)
const WIDTH = 380
const MAX_HEIGHT = 600

let onOpenTask: (taskId: string) => void = () => {}
let onChanged: () => void = () => {}

const alerts = new Map<string, ReminderAlert>()
let pendingSound = false
let win: BrowserWindow | null = null
let timer: NodeJS.Timeout | null = null

const key = (taskId: string, at: number): string => `${taskId}|${at}`

function reminderOf(t: Task): number | null {
  if (t.status !== 'pending') return null
  if (t.notionDb && isDatabaseExcluded(t.notionDb)) return null
  const prop = databaseFor(t)?.mapping.reminderProp
  return prop ? reminderTime(t.props[prop]) : null
}

// Revisa qué recordatorios tocan ahora y programa la próxima revisión exacta.
function scan(): void {
  const now = Date.now()
  const state = getReminderState()
  const fired = new Set(state.fired)
  let changed = false
  const fresh: ReminderAlert[] = []
  let next = Infinity

  const tasks = listTasks()
  // Pospuestos de tareas que ya no existen: limpiar
  for (const id of Object.keys(state.snoozed)) {
    if (!tasks.some((t) => t.id === id)) {
      delete state.snoozed[id]
      changed = true
    }
  }

  for (const t of tasks) {
    const at = reminderOf(t)
    const snoozedAt = state.snoozed[t.id]
    // Hecha mientras estaba pospuesta: ya no avisar
    if (snoozedAt && t.status !== 'pending') {
      delete state.snoozed[t.id]
      changed = true
      continue
    }
    // Pospuesto: suena a la hora pospuesta
    if (snoozedAt) {
      if (snoozedAt <= now) {
        delete state.snoozed[t.id]
        changed = true
        fresh.push(alertFor(t, snoozedAt, false))
      } else next = Math.min(next, snoozedAt)
      continue
    }
    if (at === null || fired.has(key(t.id, at))) continue
    if (at > now) {
      next = Math.min(next, at)
      continue
    }
    // Ya pasó: avisar (o, si es muy viejo, marcarlo sin avisar)
    state.fired.push(key(t.id, at))
    fired.add(key(t.id, at))
    changed = true
    if (now - at <= MISSED_WINDOW_MS) fresh.push(alertFor(t, at, now - at > ON_TIME_MS))
  }

  if (changed) saveReminderState(state)
  if (fresh.length) show(fresh)

  if (timer) clearTimeout(timer)
  const wait = Math.max(500, Math.min(next - Date.now(), SAFETY_TICK_MS))
  timer = setTimeout(scan, wait)
}

function alertFor(t: Task, at: number, missed: boolean): ReminderAlert {
  return { taskId: t.id, title: t.title, project: t.project, at: new Date(at).toISOString(), missed }
}

function show(fresh: ReminderAlert[]): void {
  for (const a of fresh) alerts.set(a.taskId, a)
  pendingSound = true

  // Notificación del sistema (además de la ventanita)
  if (Notification.isSupported()) {
    const onTime = fresh.filter((a) => !a.missed)
    const missed = fresh.filter((a) => a.missed)
    const notify = (title: string, body: string, taskId?: string): void => {
      const n = new Notification({ title, body, icon: appIconPath, silent: true, urgency: 'critical' })
      n.on('click', () => taskId && onOpenTask(taskId))
      n.show()
    }
    for (const a of onTime) notify('⏰ Recordatorio', a.title, a.taskId)
    if (missed.length === 1) notify('⏰ Recordatorio perdido', missed[0].title, missed[0].taskId)
    else if (missed.length > 1) notify('⏰ Recordatorios perdidos', `${missed.length} recordatorios mientras la app estaba cerrada`)
  }

  openWindow()
  win?.webContents.send('reminders:changed')
}

// ---- Ventana de avisos ----

function place(w: BrowserWindow, height: number): void {
  const bubble = getBubbleBounds()
  const point = bubble ? { x: bubble.x, y: bubble.y } : screen.getCursorScreenPoint()
  const wa = screen.getDisplayNearestPoint(point).workArea
  w.setBounds({
    x: wa.x + wa.width - WIDTH - 16,
    y: wa.y + wa.height - height - 16,
    width: WIDTH,
    height
  })
}

// Alto inicial aproximado; luego el renderer informa el alto real de su contenido
let contentHeight = 0
function heightFor(n: number): number {
  return Math.min(MAX_HEIGHT, contentHeight || 80 + n * 150)
}

function openWindow(): void {
  const height = heightFor(alerts.size)
  if (win && !win.isDestroyed()) {
    place(win, height)
    if (!win.isVisible()) win.showInactive()
    win.moveTop()
    return
  }
  win = new BrowserWindow({
    width: WIDTH,
    height,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    title: 'Recordatorio',
    icon: appIconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // El sonido debe poder reproducirse sin que el usuario haya hecho clic antes
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  place(win, height)
  // Sin robar el foco a lo que el usuario esté haciendo
  win.once('ready-to-show', () => win?.showInactive())
  win.on('closed', () => {
    win = null
    contentHeight = 0
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) win.loadURL(`${devUrl}#reminder`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'reminder' })
}

function refreshWindow(): void {
  if (!win || win.isDestroyed()) return
  if (alerts.size === 0) {
    win.close()
    return
  }
  place(win, heightFor(alerts.size))
  win.webContents.send('reminders:changed')
}

function act(taskId: string, action: ReminderAction, minutes = 10): void {
  const state = getReminderState()
  if (action === 'snooze') {
    state.snoozed[taskId] = Date.now() + Math.max(1, minutes) * 60 * 1000
    saveReminderState(state)
  } else if (action === 'done') {
    const t = getTask(taskId)
    if (t && t.status === 'pending') {
      toggleTaskSvc(taskId)
      requestSync()
      onChanged()
    }
  } else if (action === 'open') {
    onOpenTask(taskId)
  }
  alerts.delete(taskId)
  refreshWindow()
  scan()
}

export function initReminders(opts: { openTask: (taskId: string) => void; changed: () => void }): void {
  onOpenTask = opts.openTask
  onChanged = opts.changed
  ipcMain.handle('reminders:get', () => {
    const sound = pendingSound
    pendingSound = false
    return { alerts: [...alerts.values()].sort((a, b) => a.at.localeCompare(b.at)), sound }
  })
  ipcMain.on('reminders:resize', (_e, h: number) => {
    contentHeight = Math.max(120, Math.min(MAX_HEIGHT, Math.ceil(h)))
    if (win && !win.isDestroyed()) place(win, contentHeight)
  })
  ipcMain.handle('reminders:act', (_e, taskId: string, action: ReminderAction, minutes?: number) =>
    act(taskId, action, minutes)
  )
  // Primera revisión al arrancar (avisos perdidos incluidos)
  setTimeout(scan, 1500)
}

// Tras cambios en las tareas (edición local o sync): reprogramar.
export function refreshReminders(): void {
  scan()
}
