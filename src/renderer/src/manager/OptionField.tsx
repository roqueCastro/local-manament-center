import type { NotionDatabaseSummary, PropSchema, PropValue } from '../../../shared/types'
import { useTasks } from '../store'
import { ChipSelect, MultiChipSelect } from '../ui/ChipSelect'
import type { OptionManager } from '../ui/OptionMenu'
import { chipOptions } from './PropEditor'

export const OPTION_PROP_TYPES = ['select', 'status', 'multi_select']

// Administrador de opciones de una columna de Notion (o undefined si no aplica).
export function useOptionManager(
  db: NotionDatabaseSummary | undefined,
  schema: PropSchema | undefined
): OptionManager | undefined {
  const updateSchema = useTasks((s) => s.updateSchema)
  if (!db || !schema || !schema.editable || !OPTION_PROP_TYPES.includes(schema.type)) return undefined
  const prop = schema.name
  return {
    kind: schema.type,
    groups: schema.groups,
    groupNames: schema.groupNames,
    create: (name, group) => updateSchema(db.id, { kind: 'addOption', prop, name, group }),
    update: (option, change) => updateSchema(db.id, { kind: 'updateOption', prop, option, ...change }),
    remove: (option) => updateSchema(db.id, { kind: 'deleteOption', prop, option })
  }
}

// Valor de una columna de selección (select / status / multi_select) editable, con
// gestión de opciones como en Notion.
export function OptionField({
  db,
  schema,
  value,
  onChange,
  placeholder
}: {
  db: NotionDatabaseSummary | undefined
  schema: PropSchema
  value: PropValue | undefined
  onChange: (v: PropValue) => void
  placeholder?: string
}): JSX.Element {
  const manage = useOptionManager(db, schema)
  if (schema.type === 'multi_select') {
    return (
      <MultiChipSelect
        value={Array.isArray(value) ? value : []}
        options={chipOptions(schema)}
        placeholder={placeholder}
        manage={manage}
        onChange={onChange}
      />
    )
  }
  return (
    <ChipSelect
      value={typeof value === 'string' && value ? value : null}
      options={chipOptions(schema)}
      allowEmpty={schema.type !== 'status'}
      placeholder={placeholder}
      manage={manage}
      // El estado no puede quedar vacío
      onChange={(v) => (schema.type === 'status' && !v ? undefined : onChange(v))}
    />
  )
}
