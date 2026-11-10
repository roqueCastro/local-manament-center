// Colores de chips según el color de la opción en Notion, con tonos estilo Google
// (contenedor suave + texto oscuro en claro; contenedor profundo + texto claro en oscuro).

const CHIP: Record<string, string> = {
  default: 'bg-[#e9eef6] text-[#444746] dark:bg-[#333537] dark:text-[#c4c7c5]',
  gray: 'bg-[#e9eef6] text-[#444746] dark:bg-[#333537] dark:text-[#c4c7c5]',
  brown: 'bg-[#f2e3d6] text-[#6b4423] dark:bg-[#4a3426] dark:text-[#f2e3d6]',
  orange: 'bg-[#ffdcc2] text-[#8a3c00] dark:bg-[#6b2f00] dark:text-[#ffdcc2]',
  yellow: 'bg-[#fdefc3] text-[#6d5000] dark:bg-[#5c4300] dark:text-[#fdefc3]',
  green: 'bg-[#c4eed0] text-[#0d652d] dark:bg-[#0f5223] dark:text-[#c4eed0]',
  blue: 'bg-[#d3e3fd] text-[#0842a0] dark:bg-[#0842a0] dark:text-[#d3e3fd]',
  purple: 'bg-[#e9ddff] text-[#5a2ca0] dark:bg-[#4a2580] dark:text-[#e9ddff]',
  pink: 'bg-[#ffd8ec] text-[#8c1d58] dark:bg-[#6e1745] dark:text-[#ffd8ec]',
  red: 'bg-[#ffdad6] text-[#b3261e] dark:bg-[#8c1d18] dark:text-[#ffdad6]'
}

const DOT: Record<string, string> = {
  default: 'bg-[#8e918f]',
  gray: 'bg-[#8e918f]',
  brown: 'bg-[#a1704a]',
  orange: 'bg-[#e8710a]',
  yellow: 'bg-[#f9ab00]',
  green: 'bg-[#1e8e3e]',
  blue: 'bg-[#1a73e8]',
  purple: 'bg-[#9334e6]',
  pink: 'bg-[#e52592]',
  red: 'bg-[#d93025]'
}

const base = (c?: string): string => (c ?? 'default').replace(/_background$/, '')

export function chipClass(color?: string): string {
  return CHIP[base(color)] ?? CHIP.default
}

export function dotClass(color?: string): string {
  return DOT[base(color)] ?? DOT.default
}

// Prioridad numérica (0-3) cuando la database no tiene colores propios
export const PRIORITY_LEVELS = [
  { value: 0, label: 'Sin prioridad', color: 'default' },
  { value: 1, label: 'Baja', color: 'green' },
  { value: 2, label: 'Media', color: 'yellow' },
  { value: 3, label: 'Alta', color: 'red' }
]
