# Guía del Proyecto: Centro de Control de Tareas

> App de escritorio multiplataforma (macOS, Linux, Windows) con icono flotante de acceso rápido, sincronización con Notion e integración de IA por voz (Groq).

---

## 1. Visión general

Una aplicación ligera que vive en la **barra de menú / bandeja del sistema** (system tray). Al pulsar su icono flotante se despliega un panel rápido donde puedes:

- Ver tareas **pendientes** y **hechas**.
- Crear, editar, completar y borrar tareas en segundos.
- Sincronizar todo con **Notion** (tu "nube" / fuente de verdad en la nube).
- **Dictar tareas por voz** y que una **IA (Groq)** las interprete, las limpie y las estructure automáticamente ("mañana comprar pan y llamar al dentista" → 2 tareas con fecha).

### Objetivos de diseño
1. **Velocidad ante todo**: abrir el panel y crear una tarea debe tomar menos de 3 segundos.
2. **Siempre accesible**: atajo de teclado global + icono en la bandeja.
3. **Offline-first**: funciona sin conexión y sincroniza cuando vuelve internet.
4. **Multiplataforma real**: un solo código base para los 3 sistemas.

### Decisiones ya tomadas
- **Stack**: **Electron + React + TypeScript** (todo en JS/TS, sin Rust).
- **IA**: **Groq** (API gratuita y rápida).
- **Voz**: **Web Speech API** para el MVP; Whisper local como mejora futura.
- **Alcance inicial**: **una sola lista global + etiquetas**. Proyectos/listas múltiples en una fase posterior.

---

## 2. Stack tecnológico

### Elegido: **Electron + React + TypeScript**

Se eligió Electron porque permite construir toda la app en **JavaScript/TypeScript**, sin necesidad de aprender Rust. Es el framework de escritorio más maduro, con documentación enorme y soporte nativo para tray, atajos globales y empaquetado en los 3 sistemas.

| Capa | Tecnología | Por qué |
|------|-----------|---------|
| Framework de escritorio | **Electron** | Todo en JS/TS. Tray, global shortcuts y empaquetado multiplataforma listos de fábrica. |
| Andamiaje / build | **Electron + Vite** (`electron-vite`) | Arranque rápido, hot-reload, build moderno. |
| UI | **React + TypeScript** | Ecosistema maduro, rápido de iterar. |
| Estilos | **Tailwind CSS** | Prototipado veloz de un panel compacto. |
| Estado | **Zustand** | Estado simple y ligero. |
| Base local | **SQLite** vía `better-sqlite3` | Almacenamiento offline-first, síncrono y rápido. |
| Proceso principal (main) | **Node.js (Electron main)** | Aquí viven las llamadas seguras a Notion y Groq, y el guardado de claves. |

> **Nota sobre el peso**: Electron produce apps más pesadas (~100-150 MB) que Tauri, pero evita Rust por completo. Es el trade-off correcto dado tu perfil. Si en el futuro quisieras apps ultraligeras, se podría migrar la UI (React) a Tauri reutilizando casi todo el frontend.

### Requisitos previos
- Node.js 18+ y `pnpm` (o npm/yarn).
- Git.

```bash
# Crear el proyecto base
pnpm create @quick-start/electron
# Elegir: React + TypeScript
```

---

## 3. Arquitectura

```
┌─────────────────────────────────────────────┐
│          Icono en bandeja / Tray             │
│   (click o atajo global → abre el panel)     │
└───────────────────┬─────────────────────────┘
                    │
          ┌─────────▼──────────┐
          │  Renderer (React)   │  ← la interfaz (UI)
          │  - Lista tareas     │
          │  - Botón de voz 🎤  │
          │  - Input rápido     │
          └─────────┬──────────┘
                    │ IPC (ipcRenderer ↔ ipcMain)
          ┌─────────▼──────────┐
          │  Main process       │  ← Node.js, lógica segura
          │  - Guarda claves    │
          │  - SQLite           │
          │  - Clientes API     │
          └───┬─────────┬──────┘
              │         │
      ┌───────▼───┐ ┌───▼─────────────┐
      │  SQLite   │ │  APIs externas  │
      │  (local)  │ │ Notion / Groq   │
      └───────────┘ └─────────────────┘
```

**Clave de seguridad en Electron**: el **renderer** (React) NUNCA habla directo con Notion/Groq ni toca las claves. Todo pasa por el **main process** vía **IPC**. Se usa `contextIsolation: true` y un `preload.ts` que expone solo funciones concretas (`window.api.createTask(...)`, etc.).

**Flujo de datos**: la UI siempre lee/escribe en SQLite (instantáneo). Un proceso en segundo plano sincroniza SQLite ↔ Notion periódicamente y al arrancar.

---

## 4. Funcionalidades clave y cómo implementarlas

### 4.1 Icono flotante en la bandeja (System Tray)

Electron trae `Tray` nativo.

```ts
// main/tray.ts (esbozo)
import { app, Tray, BrowserWindow, nativeImage } from 'electron'

let tray: Tray
let panel: BrowserWindow

function createTray() {
  const icon = nativeImage.createFromPath('assets/trayIcon.png')
  tray = new Tray(icon)
  tray.on('click', () => togglePanel())
}

function togglePanel() {
  if (panel.isVisible()) panel.hide()
  else { positionNearTray(panel, tray); panel.show(); panel.focus() }
}
```

- El panel es un `BrowserWindow` con `frame: false`, `alwaysOnTop: true`, `skipTaskbar: true`, `resizable: false`.
- Se posiciona junto al icono de la bandeja (con `tray.getBounds()`).
- Se oculta al perder el foco (`panel.on('blur', () => panel.hide())`) → comportamiento tipo "popover".

### 4.2 Atajo de teclado global

```ts
// main/index.ts
import { globalShortcut } from 'electron'

app.whenReady().then(() => {
  globalShortcut.register('CommandOrControl+Shift+Space', togglePanel)
})
```

Así abres el panel sin tocar el ratón, desde cualquier app.

### 4.3 Gestión de tareas (modelo de datos)

El modelo ya deja preparadas las **etiquetas** y un futuro campo de **proyecto**, aunque el MVP use una sola lista global.

```sql
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,      -- uuid local
  notion_id   TEXT,                  -- id en Notion (null si aún no sincroniza)
  title       TEXT NOT NULL,
  status      TEXT DEFAULT 'pending',-- 'pending' | 'done'
  due_date    TEXT,                  -- ISO 8601, opcional
  priority    INTEGER DEFAULT 0,     -- 0-3
  tags        TEXT,                  -- CSV o JSON de etiquetas, ej: "casa,urgente"
  project_id  TEXT,                  -- reservado para fase de proyectos (null por ahora)
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  synced      INTEGER DEFAULT 0      -- 0 = pendiente de subir a Notion
);
```

**Alcance inicial (MVP)**: una sola lista global. Las **etiquetas** (`tags`) permiten filtrar ("urgente", "casa", "trabajo") sin la complejidad de múltiples listas.

**Fase posterior (proyectos)**: activar `project_id` + una tabla `projects` para separar listas por proyecto. El modelo ya lo contempla, así que migrar será sencillo.

Operaciones básicas: crear, marcar hecha/pendiente, editar título/fecha/etiquetas, borrar. Todo contra SQLite = instantáneo.

### 4.4 Integración con Notion

1. Crear una **integración** en https://www.notion.so/my-integrations → obtienes un `NOTION_TOKEN` (secret).
2. Crear una **base de datos (database)** en Notion con propiedades: `Name` (title), `Status` (status/select), `Due` (date), `Priority` (number), `Tags` (multi-select).
3. **Compartir** esa database con tu integración.
4. Desde el **main process** (no desde React), usar la API REST de Notion:

```
POST   https://api.notion.com/v1/pages                 → crear tarea
PATCH  https://api.notion.com/v1/pages/{id}            → actualizar/editar
POST   https://api.notion.com/v1/databases/{id}/query  → listar tareas
```

Headers: `Authorization: Bearer {token}`, `Notion-Version: 2022-06-28`.

> **Importante**: guarda el token en el almacenamiento seguro del SO (keychain) usando `safeStorage` de Electron o `keytar`. **Nunca** en el frontend ni en el repositorio.

**Estrategia de sincronización (two-way)**:
- Al crear/editar local → marcar `synced = 0` → el worker empuja a Notion.
- Al arrancar y cada N minutos → traer cambios de Notion (`last_edited_time`) → resolver conflictos por "última edición gana".

### 4.5 IA + Voz (dictado y asistente de tareas)

Dos piezas separadas: **(A) convertir voz → texto** y **(B) texto → tareas estructuradas con IA**.

#### A) Voz a texto (Speech-to-Text) → **Web Speech API** en el MVP

El renderer de Electron es Chromium, que soporta `webkitSpeechRecognition`. Es gratis y sin librerías.

```ts
// renderer, al pulsar el botón 🎤
const recognition = new (window as any).webkitSpeechRecognition()
recognition.lang = 'es-ES'
recognition.onresult = (e: any) => {
  const texto = e.results[0][0].transcript
  // enviar 'texto' al main para que lo procese con Groq
  window.api.parseTasksFromVoice(texto)
}
recognition.start()
```

> **Limitación**: la Web Speech API en Chromium envía el audio a servidores de Google (requiere internet). Para privacidad total y uso offline, la **mejora futura** es **whisper.cpp** (modelo Whisper local, gratis). Se deja para una fase posterior.

#### B) Texto a tareas estructuradas (IA) → **Groq**

Usamos **Groq**: API gratuita, muy rápida (modelos Llama 3.x), llamada desde el **main process**. API key gratuita en https://console.groq.com/.

```
POST https://api.groq.com/openai/v1/chat/completions
Headers: Authorization: Bearer {GROQ_API_KEY}
Body: modelo (ej. "llama-3.3-70b-versatile") + mensajes + response_format: json_object
```

**Patrón**: envías el texto dictado + un *prompt* que pide salida en JSON:

```
Prompt del sistema:
"Eres un parser de tareas. Devuelve SOLO un JSON array.
Cada tarea: { title, due_date (ISO o null), priority (0-3), tags (array) }.
Interpreta fechas relativas (ej: 'mañana') respecto a la fecha actual: {HOY}."

Entrada del usuario (voz transcrita):
"mañana comprar pan y el viernes llamar al dentista que es urgente"

Salida esperada:
[
  { "title": "Comprar pan", "due_date": "2026-11-10", "priority": 1, "tags": ["casa"] },
  { "title": "Llamar al dentista", "due_date": "2026-11-13", "priority": 3, "tags": ["urgente","salud"] }
]
```

Luego insertas esas tareas en SQLite y disparas la sincronización con Notion.

**Editar por voz** mismo patrón: "marca comprar pan como hecha" / "cambia la fecha del dentista al lunes" → la IA devuelve una acción (`update`, `complete`, `delete`) + los campos.

> La clave de Groq se guarda en el main / keychain, nunca en el frontend.

---

## 5. Roadmap de desarrollo (fases)

### Fase 0 — Preparación
- [ ] Instalar Node y `pnpm`.
- [ ] Crear el proyecto base con `create @quick-start/electron` (React + TS).
- [ ] Configurar Tailwind + estructura de carpetas + `contextIsolation`/`preload`.

### Fase 1 — MVP local (sin nube, sin IA)
- [ ] Icono en la bandeja + ventana popover.
- [ ] Atajo de teclado global.
- [ ] SQLite (`better-sqlite3`) con CRUD de tareas vía IPC.
- [ ] UI: lista de pendientes/hechas + input rápido + etiquetas.

### Fase 2 — Nube con Notion
- [ ] Pantalla de ajustes para pegar el token de Notion y el ID de la database (guardados con `safeStorage`).
- [ ] Push local → Notion.
- [ ] Pull Notion → local + resolución de conflictos.
- [ ] Indicador de estado de sincronización.

### Fase 3 — Voz + IA (Groq)
- [ ] Botón de micrófono con Web Speech API (`es-ES`).
- [ ] Integración con Groq desde el main process.
- [ ] Parser de tareas (texto → JSON → SQLite).
- [ ] Comandos de voz para editar/completar.

### Fase 4 — Pulido y distribución
- [ ] Preferencias (atajos, tema claro/oscuro, inicio con el sistema con `app.setLoginItemSettings`).
- [ ] Empaquetado con **electron-builder**:
  - macOS: `.dmg` / `.app` (firma y notarización).
  - Windows: `.exe` (instalador NSIS).
  - Linux: `.AppImage` / `.deb`.
- [ ] Actualizaciones automáticas (`electron-updater`).

### Fase 5 (opcional) — Proyectos/listas múltiples
- [ ] Tabla `projects` + activar `project_id`.
- [ ] Selector de proyecto en la UI.
- [ ] Whisper local para voz offline.

---

## 6. Seguridad y buenas prácticas

- `contextIsolation: true`, `nodeIntegration: false`, y exponer solo lo necesario vía `preload`.
- **Nunca** commitear tokens ni claves. Usar `safeStorage` / `keytar` (keychain del SO).
- Añadir `.env`, certificados y secretos al `.gitignore`.
- Validar y sanear la salida JSON de la IA antes de insertar en la base.
- Manejar errores de red con reintentos y cola offline.
- Pedir permisos de micrófono de forma explícita.

---

## 7. Estructura de carpetas propuesta

```
local-management-center/
├── src/
│   ├── main/                 # Proceso principal (Node)
│   │   ├── index.ts          # arranque, globalShortcut
│   │   ├── tray.ts           # icono de bandeja + panel
│   │   ├── db.ts             # SQLite (better-sqlite3)
│   │   ├── notion.ts         # cliente Notion
│   │   ├── groq.ts           # cliente IA
│   │   └── ipc.ts            # handlers IPC
│   ├── preload/
│   │   └── index.ts          # expone window.api (seguro)
│   └── renderer/             # Frontend React
│       ├── components/       # Panel, TaskList, TaskItem, VoiceButton...
│       ├── store/            # Zustand
│       └── App.tsx
├── GUIA.md                   # este archivo
├── electron.vite.config.ts
└── package.json
```

---

## 8. Recursos útiles

- Electron: https://www.electronjs.org/
- electron-vite: https://electron-vite.org/
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3
- electron-builder: https://www.electron.build/
- Notion API: https://developers.notion.com/
- Groq (IA gratis): https://console.groq.com/
- Web Speech API: https://developer.mozilla.org/docs/Web/API/Web_Speech_API
- Whisper.cpp (voz local, futuro): https://github.com/ggerganov/whisper.cpp

---

## 9. Resumen de decisiones

| Tema | Decisión | Estado |
|------|----------|--------|
| Framework | **Electron + React + TS** (sin Rust) | ✅ Decidido |
| Base local | SQLite (`better-sqlite3`), offline-first | ✅ Decidido |
| Nube | Notion (API oficial) | ✅ Decidido |
| IA | **Groq** (gratis, nube) | ✅ Decidido |
| Voz | Web Speech API (MVP) → Whisper (futuro) | ✅ Decidido |
| Alcance inicial | Una lista global + etiquetas | ✅ Decidido |
| Proyectos/listas | Fase 5 (modelo ya preparado) | ⏳ Diferido |

> **Siguiente paso sugerido**: montar la **Fase 1 (MVP local)** y validar el flujo de velocidad (tray + atajo + crear tarea) antes de añadir nube e IA.
```