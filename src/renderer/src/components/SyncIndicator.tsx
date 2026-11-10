import { useTasks } from '../store'

function timeAgo(iso: string | null): string {
  if (!iso) return 'nunca'
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} d`
}

export function SyncIndicator(): JSX.Element | null {
  const sync = useTasks((s) => s.syncState)
  const notion = useTasks((s) => s.notion)
  if (!notion) return null

  if (!notion.connected) {
    return <span className="text-xs text-ink-2">Sin Notion</span>
  }

  const status = sync?.status ?? 'idle'
  const dot =
    status === 'syncing'
      ? 'bg-[#f9ab00] animate-pulse'
      : status === 'error'
        ? 'bg-[#d93025]'
        : 'bg-[#1e8e3e]'

  const label =
    status === 'syncing'
      ? 'Sincronizando…'
      : status === 'error'
        ? 'Error de sync'
        : `Sync ${timeAgo(sync?.lastSyncTime ?? notion.lastSyncTime)}`

  return (
    <span
      title={status === 'error' ? (sync?.lastError ?? '') : undefined}
      className="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-xs text-ink-2"
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  )
}
