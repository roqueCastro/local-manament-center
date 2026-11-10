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
    return <span className="text-[11px] text-gray-400">Sin Notion</span>
  }

  const status = sync?.status ?? 'idle'
  const dot =
    status === 'syncing'
      ? 'bg-amber-400 animate-pulse'
      : status === 'error'
        ? 'bg-red-500'
        : 'bg-emerald-500'

  const label =
    status === 'syncing'
      ? 'Sincronizando…'
      : status === 'error'
        ? 'Error de sync'
        : `Sync ${timeAgo(sync?.lastSyncTime ?? notion.lastSyncTime)}`

  return (
    <span className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  )
}
