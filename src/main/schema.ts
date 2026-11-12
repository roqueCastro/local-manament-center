import type { NewPropType, PropValue, SchemaChange, SchemaResult } from '../shared/types'
import { NOTION_COLORS } from '../shared/types'
import { rewriteLocalProps } from './db'
import {
  getDatabaseRaw,
  mapDatabase,
  NotionError,
  patchDatabaseProperties,
  queryPages,
  updatePage
} from './notion'
import {
  getNotionDatabases,
  getNotionToken,
  getUiSettings,
  saveUiSettings,
  setNotionDatabases,
  type NotionDatabase
} from './settings'
import { getConnection, requestSync } from './sync'
import { databaseFor } from './tasks'

// Edición del esquema de una database de Notion desde la app: crear/renombrar/eliminar
// columnas y crear/recolorear/renombrar/eliminar opciones de selección y estado.
// Se aplica directamente en Notion (requiere conexión) y luego se ajustan los datos locales.

const OPTION_TYPES = ['select', 'multi_select', 'status']

class SchemaError extends Error {}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

function propDef(raw: any, prop: string): any {
  const def = raw.properties?.[prop]
  if (!def) throw new SchemaError(`La columna «${prop}» ya no existe en Notion.`)
  return def
}

function optionsOf(def: any): any[] {
  if (!OPTION_TYPES.includes(def.type)) {
    throw new SchemaError('Esta columna no tiene opciones.')
  }
  return def[def.type]?.options ?? []
}

// Opciones existentes tal cual (por id) para que Notion las conserve
const keep = (opts: any[]): any[] => opts.map((o) => ({ id: o.id, name: o.name }))

function groupOf(def: any, optionId: string): string | undefined {
  const g = (def.status?.groups ?? []).find((x: any) => (x.option_ids ?? []).includes(optionId))
  return g?.name
}

// Color que aún no se usa (como hace Notion al crear opciones)
export function nextColor(used: string[]): string {
  const free = NOTION_COLORS.filter((c) => c !== 'default' && !used.includes(c))
  const pool = free.length ? free : NOTION_COLORS.filter((c) => c !== 'default')
  return pool[Math.floor(Math.random() * pool.length)]
}

function newPropertyDef(type: NewPropType, options: { name: string; color?: string }[] = []): any {
  switch (type) {
    case 'select':
    case 'multi_select': {
      const used: string[] = []
      const opts = options
        .filter((o) => o.name.trim())
        .map((o) => {
          const color = o.color ?? nextColor(used)
          used.push(color)
          return { name: o.name.trim(), color }
        })
      return { [type]: { options: opts } }
    }
    case 'number':
      return { number: { format: 'number' } }
    default:
      return { [type]: {} }
  }
}

// Valor de la propiedad en una página, con una opción reemplazada (para "renombrar")
function replacedValue(type: string, page: any, prop: string, from: string, to: string): any {
  const p = page.properties?.[prop]
  if (type === 'multi_select') {
    const names: string[] = (p?.multi_select ?? []).map((o: any) => o.name as string)
    return { multi_select: names.map((n) => ({ name: n === from ? to : n })) }
  }
  return { [type]: { name: to } }
}

// Tareas locales de una database (incluidas las nuevas aún sin subir)
const inDb = (dbId: string) => (t: Parameters<typeof databaseFor>[0]) => databaseFor(t)?.id === dbId

function mapOptionValue(v: PropValue | undefined, fn: (o: string) => string | null): PropValue {
  if (Array.isArray(v)) return v.map(fn).filter((x): x is string => !!x)
  if (typeof v === 'string') return fn(v)
  return v ?? null
}

// Columnas renombradas: actualizar también los filtros/orden guardados del gestor
function renameInViews(oldName: string, newName: string): void {
  const m = getUiSettings().manager
  if (!m?.views) return
  const from = `prop:${oldName}`
  const to = `prop:${newName}`
  const views = JSON.parse(JSON.stringify(m.views).split(JSON.stringify(from)).join(JSON.stringify(to)))
  saveUiSettings({ manager: { ...m, views } })
}

async function apply(token: string, dbId: string, change: SchemaChange): Promise<NotionDatabase> {
  const raw = await getDatabaseRaw(token, dbId)

  switch (change.kind) {
    case 'addOption': {
      const name = change.name.trim()
      if (!name) throw new SchemaError('Escribe un nombre para la opción.')
      const def = propDef(raw, change.prop)
      const opts = optionsOf(def)
      if (opts.some((o) => same(o.name, name))) throw new SchemaError(`Ya existe la opción «${name}».`)
      if (name.includes(',') && def.type !== 'status') {
        throw new SchemaError('El nombre de una opción no puede llevar comas.')
      }
      const opt: any = { name, color: change.color ?? nextColor(opts.map((o) => o.color)) }
      if (def.type === 'status' && change.group) opt.group = change.group
      return (
        await patchDatabaseProperties(token, dbId, {
          [change.prop]: { [def.type]: { options: [...keep(opts), opt] } }
        })
      ).db
    }

    case 'updateOption': {
      const def = propDef(raw, change.prop)
      const opts = optionsOf(def)
      const cur = opts.find((o) => o.name === change.option)
      if (!cur) throw new SchemaError(`La opción «${change.option}» ya no existe.`)
      const newName = change.name?.trim()
      let latest: { raw: any; db: NotionDatabase } | null = null

      if (change.color && change.color !== cur.color) {
        latest = await patchDatabaseProperties(token, dbId, {
          [change.prop]: {
            [def.type]: {
              options: opts.map((o) =>
                o.id === cur.id ? { id: o.id, name: o.name, color: change.color } : { id: o.id, name: o.name }
              )
            }
          }
        })
      }

      if (newName && newName !== cur.name) {
        if (same(newName, cur.name)) {
          throw new SchemaError('Notion no permite cambiar solo mayúsculas/minúsculas desde la app; hazlo en Notion.')
        }
        if (opts.some((o) => same(o.name, newName))) {
          throw new SchemaError(`Ya existe la opción «${newName}».`)
        }
        if (newName.includes(',') && def.type !== 'status') {
          throw new SchemaError('El nombre de una opción no puede llevar comas.')
        }
        // La API de Notion no renombra opciones: se crea la nueva (mismo color y grupo),
        // se pasan a ella las páginas que usaban la vieja y se elimina la vieja.
        const color = change.color ?? cur.color
        const opt: any = { name: newName, color }
        const group = def.type === 'status' ? groupOf(def, cur.id) : undefined
        if (group) opt.group = group
        const step1 = await patchDatabaseProperties(token, dbId, {
          [change.prop]: { [def.type]: { options: [...keep(opts), opt] } }
        })

        const filter =
          def.type === 'multi_select'
            ? { property: change.prop, multi_select: { contains: cur.name } }
            : { property: change.prop, [def.type]: { equals: cur.name } }
        const pages = await queryPages(token, dbId, filter)
        let moved = 0
        try {
          for (const page of pages) {
            await updatePage(token, page.id, {
              [change.prop]: replacedValue(def.type, page, change.prop, cur.name, newName)
            })
            moved++
          }
        } catch (e) {
          throw new SchemaError(
            `Se creó «${newName}» y se movieron ${moved} de ${pages.length} tareas, pero falló el resto ` +
              `(${(e as Error).message}). La opción «${cur.name}» se conservó; reintenta.`
          )
        }

        const afterOpts = optionsOf(propDef(step1.raw, change.prop)).filter((o) => o.name !== cur.name)
        latest = await patchDatabaseProperties(token, dbId, {
          [change.prop]: { [def.type]: { options: keep(afterOpts) } }
        })

        // Local: mismo cambio (también en cambios aún sin subir)
        rewriteLocalProps(inDb(dbId), (props, dirty) => {
          if (change.prop in props) {
            props[change.prop] = mapOptionValue(props[change.prop], (o) => (o === cur.name ? newName : o))
          }
          return { props, dirty }
        })
      }

      if (!latest) return { id: dbId, ...mapDatabase(raw) }
      return latest.db
    }

    case 'deleteOption': {
      const def = propDef(raw, change.prop)
      const opts = optionsOf(def)
      if (!opts.some((o) => o.name === change.option)) {
        throw new SchemaError(`La opción «${change.option}» ya no existe.`)
      }
      if (def.type === 'status' && opts.length <= 1) {
        throw new SchemaError('Un estado debe tener al menos una opción.')
      }
      const updated = await patchDatabaseProperties(token, dbId, {
        [change.prop]: { [def.type]: { options: keep(opts.filter((o) => o.name !== change.option)) } }
      })
      rewriteLocalProps(inDb(dbId), (props, dirty) => {
        if (change.prop in props) {
          props[change.prop] = mapOptionValue(props[change.prop], (o) => (o === change.option ? null : o))
        }
        return { props, dirty }
      })
      return updated.db
    }

    case 'addProperty': {
      const name = change.name.trim()
      if (!name) throw new SchemaError('Escribe un nombre para la columna.')
      if (Object.keys(raw.properties ?? {}).some((k) => same(k, name))) {
        throw new SchemaError(`Ya existe la columna «${name}».`)
      }
      return (
        await patchDatabaseProperties(token, dbId, {
          [name]: newPropertyDef(change.type, change.options)
        })
      ).db
    }

    case 'renameProperty': {
      const name = change.name.trim()
      if (!name) throw new SchemaError('Escribe un nombre para la columna.')
      propDef(raw, change.prop)
      if (name === change.prop) return { id: dbId, ...mapDatabase(raw) }
      if (Object.keys(raw.properties ?? {}).some((k) => k !== change.prop && same(k, name))) {
        throw new SchemaError(`Ya existe la columna «${name}».`)
      }
      const updated = await patchDatabaseProperties(token, dbId, { [change.prop]: { name } })
      rewriteLocalProps(inDb(dbId), (props, dirty) => {
        if (change.prop in props) {
          props[name] = props[change.prop]
          delete props[change.prop]
        }
        return { props, dirty: dirty.map((d) => (d === change.prop ? name : d)) }
      })
      renameInViews(change.prop, name)
      return updated.db
    }

    case 'deleteProperty': {
      const def = propDef(raw, change.prop)
      if (def.type === 'title') throw new SchemaError('La columna del título no se puede eliminar.')
      const updated = await patchDatabaseProperties(token, dbId, { [change.prop]: null })
      rewriteLocalProps(inDb(dbId), (props, dirty) => {
        delete props[change.prop]
        return { props, dirty: dirty.filter((d) => d !== change.prop) }
      })
      return updated.db
    }
  }
}

function friendly(e: unknown): string {
  if (e instanceof SchemaError) return e.message
  if (e instanceof NotionError) {
    if (e.status === 401) return 'El token de Notion no es válido.'
    if (e.status === 403 || e.code === 'restricted_resource') {
      return 'La integración no tiene permiso para editar esta database (en Notion, revisa que tenga la capacidad «Actualizar contenido»).'
    }
    if (e.status === 404) return 'Notion no encuentra la database. ¿Sigue compartida con la integración?'
    return `Notion: ${e.message}`
  }
  if (e instanceof TypeError) return 'Sin conexión con Notion. Revisa tu internet e inténtalo de nuevo.'
  return (e as Error)?.message ?? 'Error desconocido.'
}

export async function updateSchema(dbId: string, change: SchemaChange): Promise<SchemaResult> {
  const token = getNotionToken()
  if (!token) return { ok: false, error: 'Conecta Notion para editar columnas y opciones.' }
  const current = getNotionDatabases().find((d) => d.id === dbId)
  if (!current) return { ok: false, error: 'Proyecto no encontrado.' }
  try {
    const updated = await apply(token, dbId, change)
    setNotionDatabases(
      getNotionDatabases().map((d) => (d.id === dbId ? { ...updated, id: dbId } : d))
    )
    // Traer de Notion los valores actualizados (y recalcular estado/prioridad)
    requestSync(300)
    return { ok: true, connection: getConnection() }
  } catch (e) {
    return { ok: false, error: friendly(e) }
  }
}
