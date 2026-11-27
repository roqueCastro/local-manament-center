import { execFile } from 'child_process'

export interface Salida {
  codigo: number // 0 = bien; -1 = no se pudo ejecutar o se pasó del tiempo
  stdout: string
  stderr: string
}

// Ejecuta un programa SIN shell (los argumentos van tal cual, nada se interpreta), con tiempo
// límite. Nunca lanza: los errores vuelven en `codigo` y `stderr`.
export function ejecutar(
  programa: string,
  args: string[],
  opciones: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}
): Promise<Salida> {
  return new Promise((resolve) => {
    execFile(
      programa,
      args,
      {
        cwd: opciones.cwd,
        env: { ...process.env, LC_ALL: 'C.UTF-8', ...opciones.env },
        timeout: opciones.timeoutMs ?? 30_000,
        maxBuffer: 16 * 1024 * 1024
      },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null
        let codigo = 0
        if (e) codigo = typeof e.code === 'number' ? e.code : -1
        let errTxt = String(stderr ?? '')
        if (e && e.killed) errTxt += `\n(se canceló: tardó más de ${Math.round((opciones.timeoutMs ?? 30_000) / 1000)} s)`
        else if (e && typeof e.code === 'string') errTxt += `\n${e.message}`
        resolve({ codigo, stdout: String(stdout ?? ''), stderr: errTxt.trim() })
      }
    )
  })
}

// Últimas líneas de un error, para mostrarlo en la ventana sin un muro de texto
export function resumirError(s: Salida, max = 6): string {
  const txt = (s.stderr || s.stdout).trim()
  if (!txt) return `terminó con código ${s.codigo}`
  return txt.split('\n').slice(-max).join('\n')
}
