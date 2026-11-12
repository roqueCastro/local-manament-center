// Fechas con hora en la zona horaria local, compartidas por el main y el renderer.

// Columna de recordatorio: una fecha de Notion cuyo nombre lo indique.
export const REMINDER_RE = /recordatorio|reminder|alarma|avis(o|ar)/i

export const isReminderName = (name: string): boolean => REMINDER_RE.test(name)

// Hora por defecto de un recordatorio que solo tiene día (sin hora)
export const DEFAULT_REMINDER_HOUR = 9

const pad = (n: number): string => String(n).padStart(2, '0')

// Fecha ISO (con o sin hora/zona) → valor de <input type="datetime-local"> en hora local
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Valor "YYYY-MM-DDTHH:mm" (hora local) → ISO con el desfase local, como lo guarda Notion
// (ej. 2026-11-12T15:30:00-05:00). Así la hora no cambia al pasar por UTC.
export function fromLocalInput(value: string): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  if (Number.isNaN(d.getTime())) return null
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

// Momento (ms) en que debe sonar un recordatorio. Solo día → a las 9:00 locales.
export function reminderTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, mo, d] = value.split('-').map(Number)
    return new Date(y, mo - 1, d, DEFAULT_REMINDER_HOUR, 0).getTime()
  }
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? null : t
}

// "hoy 15:30", "mañana 09:00", "lun 17 nov, 10:00"
export function formatReminder(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(d) - day(new Date(now))) / 86400000)
  if (diff === 0) return `hoy ${time}`
  if (diff === 1) return `mañana ${time}`
  if (diff === -1) return `ayer ${time}`
  const label = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${label}, ${time}`
}
