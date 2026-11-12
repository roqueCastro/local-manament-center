import { app } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// Iniciar la app con el sistema (para que los recordatorios suenen aunque no la abras).
// - macOS / Windows: API nativa de Electron.
// - Linux: archivo .desktop en ~/.config/autostart (estándar de GNOME, KDE, etc.).

const DESKTOP_FILE = 'local-management-center.desktop'

function linuxAutostartPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'autostart', DESKTOP_FILE)
}

// Comando que arranca esta app. Empaquetada: el ejecutable (o el AppImage).
// En desarrollo: Electron + la carpeta del proyecto (usa la última compilación, `npm run build`).
function launchCommand(): string {
  const q = (s: string): string => `"${s.replace(/(["\\$`])/g, '\\$1')}"`
  if (process.env.APPIMAGE) return q(process.env.APPIMAGE)
  if (app.isPackaged) return q(process.execPath)
  return `${q(process.execPath)} ${q(app.getAppPath())}`
}

export function getAutostart(): boolean {
  if (process.platform === 'linux') return existsSync(linuxAutostartPath())
  return app.getLoginItemSettings().openAtLogin
}

export function setAutostart(on: boolean): boolean {
  if (process.platform === 'linux') {
    const file = linuxAutostartPath()
    if (on) {
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(
        file,
        [
          '[Desktop Entry]',
          'Type=Application',
          'Name=Centro de Control de Tareas',
          'Comment=Tareas, Notion y recordatorios',
          `Exec=${launchCommand()}`,
          'X-GNOME-Autostart-enabled=true',
          'X-GNOME-Autostart-Delay=5',
          'Terminal=false',
          ''
        ].join('\n'),
        'utf-8'
      )
    } else if (existsSync(file)) {
      rmSync(file)
    }
  } else {
    app.setLoginItemSettings({ openAtLogin: on })
  }
  return getAutostart()
}
