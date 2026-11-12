import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReminderAlert } from '../../../shared/types'
import { formatReminder } from '../../../shared/dates'

// Ventanita de recordatorios (siempre encima, esquina inferior derecha). Suena al llegar
// avisos nuevos y permite abrir la tarea, marcarla hecha, posponer o descartar.

// Campanita de dos tonos, tres veces (sin archivos de audio)
function chime(): void {
  try {
    const ctx = new AudioContext()
    const t0 = ctx.currentTime + 0.05
    const notes: [number, number][] = []
    for (let r = 0; r < 3; r++) notes.push([880, r * 0.9], [1318.5, r * 0.9 + 0.18])
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + at)
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.7)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + 0.75)
    }
    setTimeout(() => void ctx.close(), 3500)
  } catch {
    // sin audio disponible: queda la notificación visual
  }
}

// Minutos hasta mañana a las 9:00
function untilTomorrow9(): number {
  const d = new Date()
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 0)
  return Math.round((t.getTime() - d.getTime()) / 60000)
}

const SNOOZE = [
  { label: '5 min', minutes: () => 5 },
  { label: '15 min', minutes: () => 15 },
  { label: '1 hora', minutes: () => 60 },
  { label: 'Mañana 9:00', minutes: untilTomorrow9 }
]

export default function ReminderApp(): JSX.Element {
  const [alerts, setAlerts] = useState<ReminderAlert[]>([])
  const [snoozing, setSnoozing] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await window.api.reminders.get()
    setAlerts(r.alerts)
    if (r.sound) chime()
  }, [])

  useEffect(() => {
    document.title = 'Recordatorio'
    void load()
    window.api.reminders.onChanged(() => void load())
  }, [load])

  const act = (taskId: string, action: 'dismiss' | 'done' | 'open' | 'snooze', minutes?: number): void => {
    setAlerts((a) => a.filter((x) => x.taskId !== taskId))
    setSnoozing(null)
    void window.api.reminders.act(taskId, action, minutes)
  }

  const missedOnly = alerts.length > 0 && alerts.every((a) => a.missed)

  // La ventana se ajusta al alto del contenido (hasta un máximo; luego hay scroll)
  const contentRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const report = (): void => window.api.reminders.resize(el.scrollHeight)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="h-full overflow-y-auto bg-surface-1 text-ink scroll-thin">
     <div ref={contentRef} className="flex flex-col">
      <header className="flex items-center gap-3 px-4 pb-2 pt-3.5 [-webkit-app-region:drag]">
        <span className="flex h-9 w-9 animate-[pulse_1.6s_ease-in-out_3] items-center justify-center rounded-full bg-primary text-on-primary shadow-elev-1">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M12 22a2 2 0 002-2h-4a2 2 0 002 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 00-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-medium leading-tight">
            {missedOnly ? 'Recordatorios perdidos' : alerts.length > 1 ? `${alerts.length} recordatorios` : 'Recordatorio'}
          </h1>
          {missedOnly && <p className="text-[11px] text-ink-2">Sonaron mientras la app estaba cerrada</p>}
        </div>
      </header>

      <div className="space-y-2 px-3 pb-3">
        {alerts.map((a) => (
          <div key={a.taskId} className="relative rounded-2xl bg-card p-3 pr-10 shadow-elev-1">
            <button
              onClick={() => act(a.taskId, 'dismiss')}
              title="Descartar"
              aria-label="Descartar"
              className="icon-btn absolute right-1.5 top-1.5 h-8 w-8"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
            <p className="line-clamp-3 select-text text-sm font-medium leading-snug">{a.title}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-2">
              <span>{formatReminder(new Date(a.at).getTime())}</span>
              {a.missed && (
                <span className="rounded-full bg-danger-soft px-2 py-0.5 font-medium text-danger">Perdido</span>
              )}
              {a.project && <span className="truncate">· {a.project}</span>}
            </div>

            {snoozing === a.taskId ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-ink-2">Posponer:</span>
                {SNOOZE.map((s) => (
                  <button key={s.label} onClick={() => act(a.taskId, 'snooze', s.minutes())} className="chip h-7 text-xs">
                    {s.label}
                  </button>
                ))}
                <button onClick={() => setSnoozing(null)} className="btn btn-sm btn-text ml-auto">
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <button onClick={() => act(a.taskId, 'open')} className="btn btn-sm btn-tonal">
                  Abrir
                </button>
                <button onClick={() => act(a.taskId, 'done')} className="btn btn-sm btn-outlined">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Hecha
                </button>
                <button onClick={() => setSnoozing(a.taskId)} className="btn btn-sm btn-outlined">
                  Posponer
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
     </div>
    </div>
  )
}
