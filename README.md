# Centro de Control de Tareas

App de escritorio (macOS, Linux, Windows) con icono flotante en la bandeja, tareas
offline-first y —en próximas fases— sincronización con Notion e IA por voz (Groq).

> Diseño y decisiones del proyecto: ver [`GUIA.md`](./GUIA.md).

## Stack

- **Electron + Vite + React + TypeScript**
- **better-sqlite3** para almacenamiento local
- **Tailwind CSS** + **Zustand**

## Requisitos

- Node.js 18+
- En macOS: Xcode Command Line Tools (para compilar `better-sqlite3`).

> **Nota sobre la versión de Electron**: se usa **Electron 37** a propósito.
> Electron 31.7.7 lo elimina XProtect de macOS (falso positivo conocido) y
> Electron 44+ exige Node 20/22+. Electron 37 es la versión más alta compatible
> con Node 18 y libre de ese falso positivo. Si subís a Electron 44+, primero
> actualizá Node a 20/22 LTS y luego `npx electron-rebuild -f -w better-sqlite3`.

## Puesta en marcha

```bash
npm install        # instala deps y recompila better-sqlite3 para Electron
npm run dev        # arranca en modo desarrollo
```

Al arrancar aparece un **icono en la bandeja del sistema**. Haz clic en él
(o pulsa **Cmd/Ctrl + Shift + Space**) para abrir el panel.

## Uso del panel (Fase 1)

- **Añadir tarea**: escribe abajo y pulsa Enter.
  - `#etiqueta` añade etiquetas (ej: `comprar pan #casa`).
  - `!`, `!!`, `!!!` fijan prioridad (baja/media/alta).
- **Completar / reactivar**: clic en el círculo.
- **Editar**: doble clic sobre el título.
- **Borrar**: icono de papelera al pasar el ratón.
- **Filtros**: Pendientes / Hechas / Todas.
- **Cerrar panel**: Esc o clic fuera.

Los datos se guardan localmente en SQLite (`tasks.sqlite` dentro de la carpeta de
datos de usuario de la app).

## Scripts

| Comando | Qué hace |
|---------|----------|
| `npm run dev` | Desarrollo con hot-reload |
| `npm run build` | Compila main, preload y renderer |
| `npm run rebuild` | Recompila better-sqlite3 contra Electron |
| `npm run typecheck` | Chequeo de tipos (node + web) |

## Roadmap

- **Fase 1 (actual)**: MVP local — tray, atajo global, CRUD de tareas. ✅
- **Fase 2**: sincronización con Notion.
- **Fase 3**: voz (Web Speech API) + IA (Groq).
- **Fase 4**: empaquetado y distribución.
- **Fase 5**: proyectos/listas múltiples + Whisper local.
