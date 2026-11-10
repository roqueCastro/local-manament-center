import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// Captador global: muestra cualquier error no controlado en pantalla
// (en vez de dejar la ventana en blanco) para poder diagnosticarlo.
function showFatal(title: string, detail: string): void {
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML = `<div style="font-family:monospace;padding:16px;color:#b91c1c;white-space:pre-wrap;font-size:12px;line-height:1.5">
      <strong>${title}</strong>\n\n${detail}</div>`
  }
}

window.addEventListener('error', (e) => {
  showFatal('Error de renderer', `${e.message}\n${e.error?.stack ?? ''}`)
})
window.addEventListener('unhandledrejection', (e) => {
  showFatal('Promesa rechazada', String(e.reason?.stack ?? e.reason))
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
