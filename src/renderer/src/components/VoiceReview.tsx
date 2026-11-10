import { useEffect, useState } from 'react'
import { useTasks } from '../store'
import type { VoiceTask } from '../../../shared/types'

const priorityLabels = ['Normal', 'Baja', 'Media', 'Alta']

export function VoiceReview(): JSX.Element | null {
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

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white dark:bg-gray-900">
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold">
          {voiceState === 'processing'
            ? 'Interpretando…'
            : voiceState === 'error'
              ? 'No se pudo'
              : `Revisar ${draft.length} tarea${draft.length === 1 ? '' : 's'}`}
        </h2>
        <button
          onClick={cancelVoice}
          className="text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm"
        >
          Cerrar
        </button>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-3 space-y-3">
        {voiceState === 'processing' && (
          <p className="py-8 text-center text-sm text-gray-400">
            La IA está armando tus tareas…
          </p>
        )}

        {voiceState === 'error' && (
          <p className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-600 dark:text-red-400">
            {voiceError}
          </p>
        )}

        {voiceState === 'review' &&
          draft.map((t, i) => (
            <div
              key={i}
              className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5 space-y-2"
            >
              <div className="flex items-start gap-2">
                <input
                  value={t.title}
                  onChange={(e) => patch(i, { title: e.target.value })}
                  className="flex-1 bg-transparent text-sm font-medium outline-none border-b border-transparent focus:border-indigo-500"
                />
                <button
                  onClick={() => removeRow(i)}
                  className="text-gray-400 hover:text-red-500 text-xs"
                  aria-label="Quitar"
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <input
                  type="date"
                  value={t.dueDate ?? ''}
                  onChange={(e) => patch(i, { dueDate: e.target.value || null })}
                  className="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-1 outline-none"
                />
                <select
                  value={t.priority}
                  onChange={(e) => patch(i, { priority: Number(e.target.value) })}
                  className="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-1 outline-none"
                >
                  {priorityLabels.map((lbl, p) => (
                    <option key={p} value={p}>
                      {lbl}
                    </option>
                  ))}
                </select>
                <select
                  value={t.project ?? ''}
                  onChange={(e) => patch(i, { project: e.target.value || null })}
                  className="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-1 outline-none max-w-[110px]"
                >
                  <option value="">(sin proyecto)</option>
                  {projects.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                {t.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-indigo-100 dark:bg-indigo-900/40 px-1.5 py-0.5 text-indigo-700 dark:text-indigo-300"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
      </div>

      {voiceState === 'review' && (
        <div className="flex gap-2 border-t border-gray-200 dark:border-gray-700 p-3">
          <button
            onClick={create}
            disabled={saving || draft.length === 0}
            className="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-2 text-sm font-medium text-white"
          >
            {saving ? 'Creando…' : `Crear ${draft.length}`}
          </button>
          <button
            onClick={cancelVoice}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
