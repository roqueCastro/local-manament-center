import { useState } from 'react'
import { useTasks } from '../store'

export function Settings(): JSX.Element {
  const notion = useTasks((s) => s.notion)
  const sync = useTasks((s) => s.syncState)
  const connectNotion = useTasks((s) => s.connectNotion)
  const disconnectNotion = useTasks((s) => s.disconnectNotion)
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
    <div className="flex h-full flex-col bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <header
        className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <button
          onClick={() => setView('tasks')}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
          aria-label="Volver"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="text-sm font-semibold">Ajustes · Notion</h1>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto p-4 space-y-4 text-sm">
        {connected ? (
          <>
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3">
              <p className="font-medium text-emerald-700 dark:text-emerald-300">✓ Conectado</p>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                Database: <strong>{notion?.databaseTitle}</strong>
              </p>
              {!notion?.encryptionAvailable && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  ⚠ El keychain no está disponible: el token se guarda sin cifrar.
                </p>
              )}
            </div>

            {notion?.mapping && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-1 text-xs">
                <p className="font-medium mb-1">Propiedades detectadas</p>
                <Row label="Título" value={notion.mapping.title} />
                <Row
                  label="Estado"
                  value={
                    notion.mapping.statusProp
                      ? `${notion.mapping.statusProp} (${notion.mapping.statusKind})`
                      : '— no encontrada'
                  }
                />
                <Row label="Fecha" value={notion.mapping.dueProp ?? '— no encontrada'} />
                <Row label="Prioridad" value={notion.mapping.priorityProp ?? '— no encontrada'} />
                <Row label="Etiquetas" value={notion.mapping.tagsProp ?? '— no encontrada'} />
                <Row label="Proyecto" value={notion.mapping.projectProp ?? '— no encontrada'} />
              </div>
            )}

            {sync?.status === 'error' && sync.lastError && (
              <p className="rounded-lg bg-red-50 dark:bg-red-900/20 p-2 text-xs text-red-600 dark:text-red-400">
                {sync.lastError}
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => syncNow()}
                disabled={sync?.status === 'syncing'}
                className="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-2 text-white font-medium"
              >
                {sync?.status === 'syncing' ? 'Sincronizando…' : 'Sincronizar ahora'}
              </button>
              <button
                onClick={() => disconnectNotion()}
                className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Desconectar
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Pegá el token de tu integración y el ID (o la URL) de la database. El token se
              guarda cifrado con el keychain del sistema.
            </p>

            <label className="block">
              <span className="text-xs font-medium">Token de integración</span>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ntn_…"
                className="mt-1 w-full rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium">ID o URL de la database</span>
              <input
                type="text"
                value={dbId}
                onChange={(e) => setDbId(e.target.value)}
                placeholder="https://notion.so/…  o  32 caracteres"
                className="mt-1 w-full rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>

            {error && (
              <p className="rounded-lg bg-red-50 dark:bg-red-900/20 p-2 text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <button
              onClick={handleConnect}
              disabled={busy || !token || !dbId}
              className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-2 text-white font-medium"
            >
              {busy ? 'Conectando…' : 'Conectar'}
            </button>
          </>
        )}

        {/* --- IA por voz (Groq) --- */}
        <div className="pt-4 mt-2 border-t border-gray-200 dark:border-gray-700 space-y-2">
          <h2 className="text-sm font-semibold">IA por voz (Groq)</h2>
          {ai?.hasKey ? (
            <div className="flex items-center justify-between rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3">
              <span className="text-xs text-emerald-700 dark:text-emerald-300">
                ✓ API key configurada
              </span>
              <button
                onClick={() => clearAiKey()}
                className="text-xs text-gray-500 hover:text-red-500"
              >
                Quitar
              </button>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Pegá tu API key de Groq para dictar tareas por voz. Se guarda cifrada.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={groqKey}
                  onChange={(e) => setGroqKey(e.target.value)}
                  placeholder="gsk_…"
                  className="flex-1 rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={saveGroq}
                  disabled={!groqKey.trim()}
                  className="rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-2 text-white font-medium"
                >
                  Guardar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-mono text-right">{value}</span>
    </div>
  )
}
