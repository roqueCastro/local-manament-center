import { useEffect, useState } from 'react'
import { useTasks } from '../store'
import type { NotionDatabaseSummary, PropValue, VoiceTask } from '../../../shared/types'
import { ChipSelect } from '../ui/ChipSelect'
import { PRIORITY_LEVELS } from '../ui/colors'
import { PropEditor } from '../manager/PropEditor'

// Revisión de las tareas dictadas antes de crearlas.
// - variant "overlay": ocupa todo el panel rápido.
// - variant "dialog": ventana flotante centrada (gestor de tareas).
export function VoiceReview({ variant = 'overlay' }: { variant?: 'overlay' | 'dialog' }): JSX.Element | null {
  const voiceState = useTasks((s) => s.voiceState)
  const voiceTasks = useTasks((s) => s.voiceTasks)
  const voiceError = useTasks((s) => s.voiceError)
  const projects = useTasks((s) => s.projects)
  const confirmVoice = useTasks((s) => s.confirmVoice)
  const cancelVoice = useTasks((s) => s.cancelVoice)
  const notion = useTasks((s) => s.notion)

  // Database (proyecto) de cada tarea propuesta, para mostrar y editar sus columnas
  const dbFor = (project: string | null): NotionDatabaseSummary | undefined =>
    notion?.connected && project ? notion.databases.find((d) => d.enabled && d.title === project) : undefined

  const [draft, setDraft] = useState<VoiceTask[]>([])
  const [saving, setSaving] = useState(false)

  // Copiar las propuestas a un borrador editable cuando llegan
  useEffect(() => {
    setDraft(voiceTasks)
  }, [voiceTasks])

  if (voiceState === 'idle') return null

  function patch(i: number, p: Partial<VoiceTask>): void {
    setDraft((d) => d.map((t, idx) => (idx === i ? { ...t, ...p } : t)))
  }

  function removeRow(i: number): void {
    setDraft((d) => d.filter((_, idx) => idx !== i))
  }

  function setProp(i: number, name: string, value: PropValue | undefined): void {
    setDraft((d) =>
      d.map((t, idx) => {
        if (idx !== i) return t
        const props = { ...(t.props ?? {}) }
        if (value === undefined) delete props[name]
        else props[name] = value
        return { ...t, props }
      })
    )
  }

  async function create(): Promise<void> {
    setSaving(true)
    // Solo las columnas que existen en el proyecto elegido (pudo cambiarse en la revisión)
    const clean = draft.map((t) => {
      const db = dbFor(t.project)
      if (!db || !t.props) return { ...t, props: undefined }
      const names = new Set(db.schema.filter((p) => p.editable).map((p) => p.name))
      return {
        ...t,
        props: Object.fromEntries(Object.entries(t.props).filter(([k, v]) => names.has(k) && v !== null))
      }
    })
    await confirmVoice(clean)
    setSaving(false)
  }

  const body = (
    <div
      className={`flex flex-col bg-surface ${
        variant === 'dialog'
          ? 'max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-[28px] shadow-elev-3'
          : 'absolute inset-0 z-20'
      }`}
    >
      <header className="flex items-center justify-between px-5 pb-2 pt-4">
        <div>
          <h2 className="text-lg font-normal">
            {voiceState === 'processing'
              ? 'Interpretando…'
              : voiceState === 'error'
                ? 'No se pudo'
                : `Revisar ${draft.length} tarea${draft.length === 1 ? '' : 's'}`}
          </h2>
          {voiceState === 'review' && (
            <p className="text-xs text-ink-2">
              La IA llenó las columnas que reconoció. Ajusta lo que haga falta antes de crearlas.
            </p>
          )}
        </div>
        <button onClick={cancelVoice} className="icon-btn" aria-label="Cerrar">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="scroll-thin flex-1 space-y-2.5 overflow-y-auto px-4 py-2">
        {voiceState === 'processing' && (
          <div className="flex flex-col items-center gap-3 py-10 text-sm text-ink-2">
            <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
            La IA está armando tus tareas…
          </div>
        )}

        {voiceState === 'error' && (
          <p className="rounded-2xl bg-danger-soft/60 p-3 text-sm text-danger">{voiceError}</p>
        )}

        {voiceState === 'review' &&
          draft.map((t, i) => (
            <div key={i} className="space-y-2.5 rounded-2xl bg-surface-1 p-3">
              <div className="flex items-start gap-2">
                <input
                  value={t.title}
                  onChange={(e) => patch(i, { title: e.target.value })}
                  className="flex-1 rounded-lg bg-transparent px-1 py-0.5 text-sm font-medium outline-none focus:bg-card"
                />
                <button
                  onClick={() => removeRow(i)}
                  className="icon-btn h-7 w-7"
                  aria-label="Quitar"
                  title="Quitar"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              {(() => {
                const db = dbFor(t.project)
                return (
                  <>
                    {projects.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <ChipSelect
                          value={t.project}
                          allowEmpty
                          placeholder="Sin proyecto"
                          options={projects.map((p) => ({ value: p, label: p, color: 'purple' }))}
                          onChange={(v) => patch(i, { project: v })}
                        />
                      </div>
                    )}
                    {db ? (
                      <FieldsEditor db={db} task={t} onSet={(name, v) => setProp(i, name, v)} />
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="date"
                          value={t.dueDate ?? ''}
                          onChange={(e) => patch(i, { dueDate: e.target.value || null })}
                          className="h-7 rounded-full bg-surface-2 px-3 text-xs outline-none"
                        />
                        <ChipSelect
                          value={String(t.priority)}
                          options={PRIORITY_LEVELS.map((p) => ({
                            value: String(p.value),
                            label: p.label,
                            color: p.color
                          }))}
                          onChange={(v) => patch(i, { priority: Number(v ?? 0) })}
                        />
                        {t.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex h-6 items-center rounded-full bg-primary-soft px-2.5 text-xs text-on-primary-soft"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          ))}
      </div>

      {voiceState === 'review' && (
        <div className="flex justify-end gap-2 px-4 pb-4 pt-2">
          <button onClick={cancelVoice} className="btn btn-text">
            Cancelar
          </button>
          <button
            onClick={create}
            disabled={saving || draft.length === 0}
            className="btn btn-filled"
          >
            {saving ? 'Creando…' : `Crear ${draft.length}`}
          </button>
        </div>
      )}
    </div>
  )

  if (variant === 'dialog') {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6">
        {body}
      </div>
    )
  }
  return body
}

// Columnas que llenó la IA (editables) + "Agregar campo" para las demás.
function FieldsEditor({
  db,
  task,
  onSet
}: {
  db: NotionDatabaseSummary
  task: VoiceTask
  onSet: (name: string, value: PropValue | undefined) => void
}): JSX.Element {
  const editable = db.schema.filter((p) => p.editable && p.type !== 'title')
  const props = task.props ?? {}
  const shown = editable.filter((p) => p.name in props)
  const rest = editable.filter((p) => !(p.name in props))

  return (
    <div className="space-y-1">
      {shown.length === 0 && (
        <p className="px-1 text-xs text-ink-2">La IA no reconoció datos para otras columnas.</p>
      )}
      {shown.map((p) => (
        <div key={p.name} className="grid grid-cols-[120px_1fr_28px] items-start gap-2">
          <p className="truncate pt-1.5 text-[13px] text-ink-2" title={p.name}>
            {p.name}
          </p>
          <div className="min-w-0">
            <PropEditor schema={p} db={db} value={props[p.name]} onChange={(v) => onSet(p.name, v)} />
          </div>
          <button
            onClick={() => onSet(p.name, undefined)}
            className="icon-btn mt-0.5 h-7 w-7"
            aria-label={`Quitar ${p.name}`}
            title="Quitar este campo"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
      {rest.length > 0 && (
        <div className="pt-1">
          <ChipSelect
            value={null}
            placeholder="+ Agregar campo"
            options={rest.map((p) => ({ value: p.name, label: p.name, color: 'default' }))}
            onChange={(v) => {
              const p = rest.find((x) => x.name === v)
              if (p) onSet(p.name, p.type === 'checkbox' ? false : p.type === 'multi_select' ? [] : null)
            }}
          />
        </div>
      )}
    </div>
  )
}
