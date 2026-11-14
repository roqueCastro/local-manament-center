import { useEffect, useState } from 'react'
import type { UpdateState } from '../../../shared/types'

// Ajustes → versión instalada y actualizaciones (las busca sola al arrancar y cada 4 h).
export function UpdatesSection(): JSX.Element {
  const [s, setS] = useState<UpdateState | null>(null)

  useEffect(() => {
    void window.api.updates.get().then(setS)
    window.api.updates.onState(setS)
    return () => window.api.updates.offState()
  }, [])

  const checkedAt = s?.checkedAt
    ? new Date(s.checkedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
    : null

  let text: string
  switch (s?.status) {
    case 'dev':
      text = 'Modo desarrollo: las actualizaciones solo funcionan en la app instalada.'
      break
    case 'checking':
      text = 'Buscando actualizaciones…'
      break
    case 'none':
      text = `Tienes la última versión${checkedAt ? ` · revisado ${checkedAt}` : ''}.`
      break
    case 'downloading':
      text = `Descargando la versión ${s.version}… ${s.percent ?? 0}%`
      break
    case 'ready':
      text = `La versión ${s.version} está lista. Se instala al reiniciar (o al salir de la app).`
      break
    case 'manual':
      text = `Hay una versión nueva (${s.version}). En Mac se descarga e instala a mano.`
      break
    case 'error':
      text = `No se pudo buscar: ${s.message ?? 'error desconocido'}`
      break
    default:
      text = 'Se buscan solas al abrir la app y cada 4 horas.'
  }

  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3e3fd] text-[#0b57d0] dark:bg-[#0842a0] dark:text-[#d3e3fd]">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M12 4V1L8 5l4 4V6a6 6 0 016 6 6 6 0 01-.7 2.8l1.46 1.46A8 8 0 0020 12a8 8 0 00-8-8zm0 14a6 6 0 01-6-6c0-1 .25-1.97.7-2.8L5.24 7.74A8 8 0 004 12a8 8 0 008 8v3l4-4-4-4v3z" />
          </svg>
        </span>
        <div className="flex-1">
          <h2 className="text-base font-medium">Actualizaciones</h2>
          <p className="text-xs text-ink-2">Versión instalada {s?.current ?? '…'}</p>
        </div>
      </div>

      <div className="space-y-3 rounded-xl bg-surface-1 px-4 py-3">
        <p className={`text-sm ${s?.status === 'error' ? 'text-danger' : ''}`}>{text}</p>
        {s?.status === 'downloading' && (
          <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
            <div className="h-full bg-primary transition-all" style={{ width: `${s.percent ?? 0}%` }} />
          </div>
        )}
        <div className="flex justify-end gap-2">
          {s?.status === 'ready' ? (
            <button onClick={() => window.api.updates.install()} className="btn btn-sm btn-filled">
              Reiniciar y actualizar
            </button>
          ) : s?.status === 'manual' ? (
            <button onClick={() => window.api.updates.openDownload()} className="btn btn-sm btn-filled">
              Descargar
            </button>
          ) : (
            <button
              onClick={() => void window.api.updates.check().then(setS)}
              disabled={!s || s.status === 'dev' || s.status === 'checking' || s.status === 'downloading'}
              className="btn btn-sm btn-tonal disabled:opacity-40"
            >
              Buscar actualizaciones
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
