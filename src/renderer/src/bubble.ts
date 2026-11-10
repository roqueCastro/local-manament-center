// Script de la burbuja flotante. Solo captura el puntero y avisa al main:
// el main calcula el arrastre con la posición real del cursor (evita problemas
// de escalado y de que la ventana se mueva bajo el puntero).

const bubbleEl = document.getElementById('bubble') as HTMLDivElement
const badgeEl = document.getElementById('badge') as HTMLDivElement

let pressed = false
let frame = 0

bubbleEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  pressed = true
  bubbleEl.setPointerCapture(e.pointerId) // seguir recibiendo eventos aunque el cursor salga de la ventana
  bubbleEl.classList.add('pressed')
  window.api.bubble.dragStart()
})

bubbleEl.addEventListener('pointermove', () => {
  if (!pressed || frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    window.api.bubble.dragMove()
  })
})

function release(e: PointerEvent): void {
  if (!pressed) return
  pressed = false
  if (frame) {
    cancelAnimationFrame(frame)
    frame = 0
  }
  if (bubbleEl.hasPointerCapture(e.pointerId)) bubbleEl.releasePointerCapture(e.pointerId)
  bubbleEl.classList.remove('pressed')
  window.api.bubble.dragEnd()
}

bubbleEl.addEventListener('pointerup', release)
bubbleEl.addEventListener('pointercancel', release)

window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.api.bubble.contextMenu()
})

window.api.bubble.onBadge((pending) => {
  badgeEl.hidden = pending <= 0
  badgeEl.textContent = pending > 99 ? '99+' : String(pending)
})
