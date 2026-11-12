import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Tarjeta flotante anclada a un elemento (menús y editores de filtro).
// Usa position: fixed para no quedar recortada por contenedores con scroll.
export function Popover({
  anchor,
  onClose,
  width = 288,
  children
}: {
  anchor: HTMLElement | null
  onClose: () => void
  width?: number
  children: React.ReactNode
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchor) return
    // Se recoloca si cambia el contenido (ej. al abrir el editor de una opción)
    const place = (): void => {
      const r = anchor.getBoundingClientRect()
      const h = ref.current?.offsetHeight ?? 300
      const up = r.bottom + h + 8 > window.innerHeight && r.top > h + 8
      const top = up ? r.top - h - 4 : r.bottom + 4
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(top, window.innerHeight - h - 8))
      })
    }
    place()
    const ro = new ResizeObserver(place)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [anchor, width])

  useEffect(() => {
    const inside = (t: EventTarget | null): boolean =>
      !!t && (!!ref.current?.contains(t as Node) || !!anchor?.contains(t as Node))
    const onDown = (e: MouseEvent): void => {
      if (!inside(e.target)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      // Esc cierra solo este menú (no llega al gestor, que se cerraría entero)
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onScroll = (e: Event): void => {
      if (!inside(e.target)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [anchor, onClose])

  if (!anchor) return null
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }}
      className="scroll-thin fixed z-50 max-h-[420px] overflow-y-auto rounded-2xl bg-surface-1 p-2 shadow-elev-3"
    >
      {children}
    </div>
  )
}
