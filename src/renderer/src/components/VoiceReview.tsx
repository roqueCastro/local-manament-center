import { useEffect, useState } from 'react'
import { useTasks } from '../store'
import type { VoiceTask } from '../../../shared/types'
import { ChipSelect } from '../ui/ChipSelect'
import { PRIORITY_LEVELS } from '../ui/colors'

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

  async function create(): Promise<void> {
    setSaving(true)
    await confirmVoice(draft)
    setSaving(false)
  }

  const body = (
    <div
      className={`flex flex-col bg-surface ${
        variant === 'dialog'
          ? 'max-h-[80vh] w-full max-w-xl overflow-hidden rounded-[28px] shadow-elev-3'
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
            <p className="text-xs text-ink-2">Ajustá lo que haga falta antes de crearlas.</p>
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
                {projects.length > 0 && (
                  <ChipSelect
                    value={t.project}
                    allowEmpty
                    placeholder="Sin proyecto"
                    options={projects.map((p) => ({ value: p, label: p, color: 'purple' }))}
                    onChange={(v) => patch(i, { project: v })}
                  />
                )}
                {t.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex h-6 items-center rounded-full bg-primary-soft px-2.5 text-xs text-on-primary-soft"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
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
