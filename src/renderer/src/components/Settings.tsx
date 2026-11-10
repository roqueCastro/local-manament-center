import { useState } from 'react'
import { useTasks } from '../store'
import { Switch } from '../ui/Switch'

export function Settings(): JSX.Element {
  const notion = useTasks((s) => s.notion)
  const sync = useTasks((s) => s.syncState)
  const connectNotion = useTasks((s) => s.connectNotion)
  const disconnectNotion = useTasks((s) => s.disconnectNotion)
  const setProjectEnabled = useTasks((s) => s.setProjectEnabled)
  const syncNow = useTasks((s) => s.syncNow)
  const setView = useTasks((s) => s.setView)
  const ai = useTasks((s) => s.ai)
  const setAiKey = useTasks((s) => s.setAiKey)
  const clearAiKey = useTasks((s) => s.clearAiKey)

  const [token, setToken] = useState('')
  const [dbId, setDbId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [groqKey, setGroqKey] = useState('')

  const connected = notion?.connected
  const activeCount = notion?.databases.filter((d) => d.enabled).length ?? 0

  async function saveGroq(): Promise<void> {
    if (!groqKey.trim()) return
    await setAiKey(groqKey.trim())
    setGroqKey('')
  }

  async function handleConnect(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await connectNotion(token, dbId)
      if (!res.ok) setError(res.error ?? 'No se pudo conectar.')
      else {
        setToken('')
        setDbId('')
      }
    } catch (e) {
      setError(`Error inesperado: ${(e as Error)?.message ?? String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-surface text-ink">
      <header
        className="flex items-center gap-1 px-2 py-2"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <button
          onClick={() => setView('tasks')}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="icon-btn"
          aria-label="Volver"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>
        <h1 className="text-lg font-normal">Ajustes</h1>
      </header>

      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto px-4 pb-6 text-sm">
        {/* --- Notion --- */}
        <section className="card space-y-4 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-on-primary-soft">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.99 5.99 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-medium">Notion</h2>
              <p className="text-xs text-ink-2">
                {connected
                  ? `Conectado · ${activeCount} de ${notion?.databases.length ?? 0} proyectos activos`
                  : 'Sin conectar'}
              </p>
            </div>
            {connected && (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#c4eed0] px-3 text-xs font-medium text-[#0d652d] dark:bg-[#0f5223] dark:text-[#c4eed0]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#1e8e3e]" />
                Activo
              </span>
            )}
          </div>

          {connected ? (
            <>
              {!notion?.encryptionAvailable && (
                <p className="rounded-xl bg-[#fdefc3] p-3 text-xs text-[#6d5000] dark:bg-[#5c4300] dark:text-[#fdefc3]">
                  El keychain no está disponible: el token se guarda sin cifrar.
                </p>
              )}

              <div>
                <p className="mb-1 text-sm font-medium">Proyectos a mostrar</p>
                <p className="mb-3 text-xs leading-snug text-ink-2">
                  Activá solo los proyectos que querés traer a la app. Los desactivados no se
                  sincronizan ni aparecen en las listas.
                </p>
                <div className="overflow-hidden rounded-2xl border border-line">
                  {notion?.databases.map((d, i) => (
                    <div
                      key={d.id}
                      className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-line' : ''}`}
                    >
                      <div className={`min-w-0 flex-1 ${d.enabled ? '' : 'opacity-50'}`}>
                        <p className="flex items-center gap-2 truncate text-sm font-medium">
                          <span className="truncate">{d.title}</span>
                          {d.isDefault && (
                            <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-primary-soft px-2 text-[10px] font-medium text-on-primary-soft">
                              Por defecto
                            </span>
                          )}
                        </p>
                        {d.enabled && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <PropTag label="Estado" value={d.mapping.statusProp} />
                            <PropTag label="Fecha" value={d.mapping.dueProp} />
                            <PropTag label="Prioridad" value={d.mapping.priorityProp} />
                            {d.schema.length > 0 && (
                              <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 text-[11px] text-ink-2">
                                {d.schema.length} columnas
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <Switch
                        checked={d.enabled}
                        label={`Mostrar ${d.title}`}
                        disabled={d.enabled && activeCount === 1}
                        onChange={(v) => setProjectEnabled(d.id, v)}
                      />
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-snug text-ink-2">
                  ¿Falta un proyecto? En Notion abrí la database (o la página que las contiene) →
                  ··· → Conexiones → agregá tu integración, y tocá «Sincronizar ahora».
                </p>
              </div>

              {sync?.status === 'error' && sync.lastError && (
                <p className="rounded-xl bg-danger-soft/60 p-3 text-xs text-danger">{sync.lastError}</p>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={() => disconnectNotion()} className="btn btn-outlined">
                  Desconectar
                </button>
                <button
                  onClick={() => syncNow()}
                  disabled={sync?.status === 'syncing'}
                  className="btn btn-filled"
                >
                  <svg viewBox="0 0 24 24" className={`h-4 w-4 ${sync?.status === 'syncing' ? 'animate-spin' : ''}`} fill="currentColor">
                    <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0020 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 004 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
                  </svg>
                  {sync?.status === 'syncing' ? 'Sincronizando…' : 'Sincronizar ahora'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs leading-snug text-ink-2">
                Pegá el token de tu integración. Cada database de Notion compartida con la
                integración aparece como un proyecto. El token se guarda cifrado con el keychain
                del sistema.
              </p>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-2">Token de integración</span>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ntn_…"
                  className="field"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-2">
                  Database por defecto <span className="font-normal">(opcional)</span>
                </span>
                <input
                  type="text"
                  value={dbId}
                  onChange={(e) => setDbId(e.target.value)}
                  placeholder="https://notion.so/…  o  32 caracteres"
                  className="field"
                />
              </label>

              {error && <p className="rounded-xl bg-danger-soft/60 p-3 text-xs text-danger">{error}</p>}

              <div className="flex justify-end">
                <button onClick={handleConnect} disabled={busy || !token} className="btn btn-filled">
                  {busy ? 'Conectando…' : 'Conectar'}
                </button>
              </div>
            </>
          )}
        </section>

        {/* --- IA por voz (Groq) --- */}
        <section className="card space-y-3 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ffdad6] text-[#b3261e] dark:bg-[#8c1d18] dark:text-[#ffdad6]">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z" />
              </svg>
            </span>
            <div className="flex-1">
              <h2 className="text-base font-medium">IA por voz</h2>
              <p className="text-xs text-ink-2">Groq · dictá tareas y la IA las organiza</p>
            </div>
          </div>
          {ai?.hasKey ? (
            <div className="flex items-center justify-between rounded-xl bg-surface-1 px-4 py-2.5">
              <span className="text-sm text-ink-2">API key configurada</span>
              <button onClick={() => clearAiKey()} className="btn btn-sm btn-danger">
                Quitar
              </button>
            </div>
          ) : (
            <>
              <p className="text-xs text-ink-2">
                Pegá tu API key de Groq para dictar tareas por voz. Se guarda cifrada.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={groqKey}
                  onChange={(e) => setGroqKey(e.target.value)}
                  placeholder="gsk_…"
                  className="field"
                />
                <button onClick={saveGroq} disabled={!groqKey.trim()} className="btn btn-filled">
                  Guardar
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function PropTag({ label, value }: { label: string; value: string | null }): JSX.Element {
  return (
    <span
      title={value ? `${label}: ${value}` : `${label}: no encontrada`}
      className={`inline-flex h-6 max-w-[180px] items-center gap-1 truncate rounded-full px-2.5 text-[11px] ${
        value ? 'bg-primary-soft/70 text-on-primary-soft' : 'bg-surface-2 text-ink-2/70 line-through'
      }`}
    >
      <span className="font-medium">{label}:</span>
      <span className="truncate">{value ?? '—'}</span>
    </span>
  )
}
