// Interruptor estilo Material 3 (Google).
export function Switch({
  checked,
  onChange,
  disabled = false,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-8 w-[52px] shrink-0 items-center rounded-full border-2 transition-colors disabled:opacity-40 ${
        checked ? 'border-primary bg-primary' : 'border-line-strong bg-surface-3'
      }`}
    >
      <span
        className={`absolute flex items-center justify-center rounded-full transition-all ${
          checked
            ? 'left-[22px] h-6 w-6 bg-on-primary text-primary'
            : 'left-[6px] h-4 w-4 bg-line-strong'
        }`}
      >
        {checked && (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  )
}
