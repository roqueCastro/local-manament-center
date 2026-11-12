import type { NotionDatabaseSummary, PropSchema, PropValue, Task } from '../../../shared/types'
import type { ChipOption } from '../ui/ChipSelect'
import { PRIORITY_LEVELS } from '../ui/colors'

// Filtros y orden de la tabla del gestor. Se guardan por vista (cada proyecto y "Todos")
// en settings.json (ManagerPrefs.views); el panel rápido no se ve afectado.

export type ColKind = 'text' | 'options' | 'date' | 'checkbox'

export interface ColDef {
  key: string
  label: string
  kind: ColKind
  options?: ChipOption[]
  value: (t: Task) => PropValue // para filtrar
  sortValue: (t: Task) => string | number | null // null = vacío (siempre al final)
}

export type DatePreset = 'overdue' | 'today' | 'week' | 'month' | 'empty' | 'set'

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'overdue', label: 'Vencida (antes de hoy)' },
  { value: 'today', label: 'Hoy' },
  { value: 'week', label: 'Próximos 7 días' },
  { value: 'month', label: 'Este mes' },
  { value: 'set', label: 'Con fecha' },
  { value: 'empty', label: 'Sin fecha' }
]

export const EMPTY_VALUE = '__vacio__'

export interface ColFilter {
  col: string
  values?: string[] // kind "options": coincide con cualquiera
  text?: string // kind "text": contiene
  date?: DatePreset // kind "date"
  bool?: boolean // kind "checkbox"
}

export interface SortRule {
  col: string
  dir: 'asc' | 'desc'
}

export interface TableView {
  filters: ColFilter[]
  // Orden por varias columnas: la primera manda; las siguientes desempatan
  sorts: SortRule[]
}

export const EMPTY_VIEW: TableView = { filters: [], sorts: [] }

// Vista guardada → formato actual (las vistas antiguas tenían un único `sort`)
export function normalizeView(raw: unknown): TableView {
  const v = (raw ?? {}) as { filters?: ColFilter[]; sorts?: SortRule[]; sort?: SortRule | null }
  const sorts = Array.isArray(v.sorts) ? v.sorts : v.sort ? [v.sort] : []
  return {
    filters: Array.isArray(v.filters) ? v.filters : [],
    sorts: sorts.filter((r) => r && typeof r.col === 'string' && (r.dir === 'asc' || r.dir === 'desc'))
  }
}

// Click en un encabezado: si la columna no ordena, se agrega como siguiente nivel
// (ascendente); si ya ordena: ascendente → descendente → se quita.
export function cycleSort(sorts: SortRule[], col: string): SortRule[] {
  const cur = sorts.find((r) => r.col === col)
  if (!cur) return [...sorts, { col, dir: 'asc' }]
  if (cur.dir === 'asc') return sorts.map((r) => (r.col === col ? { col, dir: 'desc' as const } : r))
  return sorts.filter((r) => r.col !== col)
}

// ---- Columnas ----

const asText = (v: PropValue | undefined): string =>
  v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v)

function kindOf(type: string): ColKind {
  if (type === 'select' || type === 'status' || type === 'multi_select') return 'options'
  if (type === 'date' || type === 'created_time' || type === 'last_edited_time') return 'date'
  if (type === 'checkbox') return 'checkbox'
  return 'text'
}

// Une las opciones (con color) de una propiedad a través de varias databases.
function mergedOptions(schemas: (PropSchema | undefined)[]): ChipOption[] {
  const out: ChipOption[] = []
  for (const s of schemas) {
    for (const o of s?.options ?? []) {
      if (!out.some((x) => x.value === o)) out.push({ value: o, label: o, color: s?.colors?.[o] })
    }
  }
  return out
}

export function buildColumns(args: {
  dbs: NotionDatabaseSummary[] // databases visibles en la vista
  dbOf: (t: Task) => NotionDatabaseSummary | undefined
  showProject: boolean
  projects: string[]
  extraColumns: PropSchema[]
  dueLabel: string
}): ColDef[] {
  const { dbs, dbOf, showProject, projects, extraColumns, dueLabel } = args

  // Estado: opción de Notion si la database tiene estado; si no, Pendiente/Hecha
  const statusOptions = mergedOptions(
    dbs.map((d) => d.schema.find((p) => p.name === d.mapping.statusProp))
  )
  const withFallback = dbs.length === 0 || dbs.some((d) => !d.mapping.statusProp)
  if (withFallback) {
    statusOptions.push(
      { value: 'Pendiente', label: 'Pendiente', color: 'blue' },
      { value: 'Hecha', label: 'Hecha', color: 'green' }
    )
  }
  const statusOf = (t: Task): string => {
    const d = dbOf(t)
    const v = d?.mapping.statusProp ? t.props[d.mapping.statusProp] : null
    if (typeof v === 'string' && v) return v
    return t.status === 'done' ? 'Hecha' : 'Pendiente'
  }

  const cols: ColDef[] = [
    {
      key: 'title',
      label: 'Tarea',
      kind: 'text',
      value: (t) => t.title,
      sortValue: (t) => t.title.toLowerCase()
    }
  ]
  if (showProject) {
    cols.push({
      key: 'project',
      label: 'Proyecto',
      kind: 'options',
      options: projects.map((p) => ({ value: p, label: p, color: 'purple' })),
      value: (t) => t.project,
      sortValue: (t) => t.project?.toLowerCase() ?? null
    })
  }
  cols.push(
    {
      key: 'status',
      label: 'Estado',
      kind: 'options',
      options: statusOptions,
      value: statusOf,
      // Orden según el flujo de Notion (Sin empezar → En curso → Lista…)
      sortValue: (t) => {
        const i = statusOptions.findIndex((o) => o.value === statusOf(t))
        return i < 0 ? null : i
      }
    },
    {
      key: 'priority',
      label: 'Prioridad',
      kind: 'options',
      options: PRIORITY_LEVELS.map((p) => ({ value: String(p.value), label: p.label, color: p.color })),
      value: (t) => String(t.priority),
      sortValue: (t) => (t.priority > 0 ? t.priority : null)
    },
    {
      key: 'due',
      label: dueLabel,
      kind: 'date',
      value: (t) => t.dueDate,
      sortValue: (t) => t.dueDate?.slice(0, 10) ?? null
    }
  )
  for (const c of extraColumns) {
    const kind = kindOf(c.type)
    const sameName = dbs.map((d) => d.schema.find((p) => p.name === c.name))
    cols.push({
      key: `prop:${c.name}`,
      label: c.name,
      kind,
      options: kind === 'options' ? mergedOptions(sameName) : undefined,
      value: (t) => t.props[c.name] ?? null,
      sortValue: (t) => {
        const v = t.props[c.name]
        if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return null
        if (typeof v === 'number') return v
        if (typeof v === 'boolean') return v ? 1 : 0
        return asText(v).toLowerCase()
      }
    })
  }
  return cols
}

// ---- Filtrar y ordenar ----

function localDay(iso: string): Date | null {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  d.setHours(0, 0, 0, 0)
  return d
}

function matchDate(v: PropValue, preset: DatePreset): boolean {
  const day = typeof v === 'string' && v ? localDay(v) : null
  if (preset === 'empty') return !day
  if (preset === 'set') return !!day
  if (!day) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000)
  if (preset === 'overdue') return diff < 0
  if (preset === 'today') return diff === 0
  if (preset === 'week') return diff >= 0 && diff <= 7
  return day.getMonth() === today.getMonth() && day.getFullYear() === today.getFullYear()
}

// ¿El filtro tiene algo elegido? (los vacíos no filtran)
export function isActive(f: ColFilter): boolean {
  return !!(f.values?.length || f.text?.trim() || f.date || f.bool !== undefined)
}

function matches(t: Task, f: ColFilter, col: ColDef): boolean {
  const v = col.value(t)
  switch (col.kind) {
    case 'options': {
      if (!f.values?.length) return true
      const arr = Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [String(v)]
      if (arr.length === 0) return f.values.includes(EMPTY_VALUE)
      return arr.some((x) => f.values!.includes(x))
    }
    case 'date':
      return f.date ? matchDate(v, f.date) : true
    case 'checkbox':
      return f.bool === undefined ? true : (v === true) === f.bool
    default: {
      const q = f.text?.trim().toLowerCase()
      return q ? asText(v).toLowerCase().includes(q) : true
    }
  }
}

export function applyView(tasks: Task[], view: TableView, cols: ColDef[]): Task[] {
  const byKey = new Map(cols.map((c) => [c.key, c]))
  const filters = view.filters.filter((f) => byKey.has(f.col) && isActive(f))
  let out = filters.length
    ? tasks.filter((t) => filters.every((f) => matches(t, f, byKey.get(f.col)!)))
    : tasks.slice()

  const rules = view.sorts
    .map((r) => ({ col: byKey.get(r.col), mul: r.dir === 'asc' ? 1 : -1 }))
    .filter((r): r is { col: ColDef; mul: 1 | -1 } => !!r.col)
  if (rules.length) {
    out = out
      .map((t, i) => ({ t, i, v: rules.map((r) => r.col.sortValue(t)) }))
      .sort((a, b) => {
        for (let k = 0; k < rules.length; k++) {
          const x = a.v[k]
          const y = b.v[k]
          // Vacíos siempre al final, en cualquier dirección
          if (x === null && y === null) continue
          if (x === null) return 1
          if (y === null) return -1
          const c =
            typeof x === 'number' && typeof y === 'number'
              ? x - y
              : String(x).localeCompare(String(y), 'es', { numeric: true })
          if (c !== 0) return c * rules[k].mul
        }
        return a.i - b.i
      })
      .map((x) => x.t)
  }
  return out
}

// Texto corto del filtro para mostrar en su chip
export function describeFilter(f: ColFilter, col: ColDef): string {
  if (col.kind === 'options') {
    const labels = (f.values ?? []).map((v) =>
      v === EMPTY_VALUE ? 'Vacío' : (col.options?.find((o) => o.value === v)?.label ?? v)
    )
    if (labels.length === 0) return 'cualquiera'
    return labels.length <= 2 ? labels.join(', ') : `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`
  }
  if (col.kind === 'date') return DATE_PRESETS.find((d) => d.value === f.date)?.label ?? 'cualquiera'
  if (col.kind === 'checkbox') return f.bool === undefined ? 'cualquiera' : f.bool ? 'Sí' : 'No'
  return f.text?.trim() ? `contiene "${f.text.trim()}"` : 'cualquiera'
}
