/** @type {import('tailwindcss').Config} */

// Colores estilo Google (Material 3) definidos como variables CSS en index.css,
// para que cambien solos entre tema claro y oscuro.
const token = (name) => `rgb(var(--md-${name}) / <alpha-value>)`

module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        surface: token('surface'), // fondo de la ventana
        'surface-1': token('surface-1'), // contenedores suaves
        'surface-2': token('surface-2'),
        'surface-3': token('surface-3'),
        card: token('card'),
        ink: token('ink'), // texto principal
        'ink-2': token('ink-2'), // texto secundario
        line: token('line'), // bordes suaves
        'line-strong': token('line-strong'),
        primary: token('primary'),
        'on-primary': token('on-primary'),
        'primary-soft': token('primary-soft'),
        'on-primary-soft': token('on-primary-soft'),
        danger: token('danger'),
        'danger-soft': token('danger-soft')
      },
      fontFamily: {
        sans: ['Roboto', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        'elev-1': '0 1px 2px rgba(0,0,0,.3), 0 1px 3px 1px rgba(0,0,0,.15)',
        'elev-2': '0 1px 2px rgba(0,0,0,.3), 0 2px 6px 2px rgba(0,0,0,.15)',
        'elev-3': '0 4px 8px 3px rgba(0,0,0,.15), 0 1px 3px rgba(0,0,0,.3)'
      }
    }
  },
  plugins: []
}
