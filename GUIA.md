# Guía del Proyecto: Centro de Control de Tareas

> App de escritorio (Linux, macOS, Windows) para gestionar las tareas de **todos tus proyectos de Notion**: burbuja flotante siempre a mano, gestor en tabla con todas las propiedades editables, funcionamiento offline y dictado por voz con IA (Groq).

---

## 1. Visión general

La app vive en segundo plano y se usa desde tres puntos de entrada:

| Entrada | Qué hace |
|---|---|
| **Burbuja flotante** | Botón redondo siempre encima de cualquier ventana, arrastrable y que se pega al borde. Clic → abre/oculta el **gestor de tareas** pegado a la burbuja. Clic derecho → menú. Muestra un contador de pendientes. |
| **Bandeja del sistema** | Menú: Abrir panel, Abrir gestor de tareas, Mostrar burbuja (on/off), Salir. En Linux (AppIndicator) el icono no recibe clic, por eso todo va por menú. |
| **Atajo global** | `Ctrl+Shift+Space` abre/cierra el **panel rápido** desde cualquier app. |

### Panel rápido vs. gestor

- **Panel rápido** (420×600): lista compacta de pendientes/hechas, alta rápida, micrófono y ajustes. Se oculta al perder el foco.
- **Gestor de tareas** (1320×840): tabla con las tareas de todos los proyectos, filtros, orden, edición completa de cada tarea y administración de columnas/opciones. Se comporta como un **modal**: sin marco, siempre encima, se cierra al hacer **clic fuera** o con **Esc**. Al cerrarlo solo se oculta, así reabre al instante con el proyecto que tenías elegido.

### Objetivos de diseño
1. **Velocidad**: abrir y crear una tarea en menos de 3 segundos.
2. **Siempre accesible**: burbuja + atajo global + bandeja.
3. **Offline-first**: todo se lee y escribe en SQLite; Notion se sincroniza en segundo plano.
4. **Notion como fuente de verdad**: cada database es un proyecto y se respetan sus columnas tal cual.

---

## 2. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Escritorio | **Electron 37** |
| Build / dev | **electron-vite** (hot-reload del renderer; el proceso principal requiere reiniciar) |
| UI | **React 18 + TypeScript** |
| Estilos | **Tailwind CSS** con tokens **Material 3** (variables CSS, modo claro/oscuro) y fuente **Roboto** (`@fontsource/roboto`) |
| Estado | **Zustand** (un store por ventana) |
| Base local | **SQLite** con `better-sqlite3` |
| Nube | **API de Notion** (`Notion-Version: 2022-06-28`) |
| IA y voz | **Groq**: Whisper para voz→texto y un LLM elegido automáticamente para texto→tareas |
| Secretos | `safeStorage` de Electron (token de Notion y API key de Groq cifrados) |

### Comandos

```bash
npm install          # instala dependencias (recompila better-sqlite3 para Electron)
npm run dev          # desarrollo
npm run typecheck    # tipos de main y renderer
npm run build        # build de producción (out/)
npm run rebuild      # recompilar better-sqlite3 si falla al cargar
npm run dist         # instalador para el sistema actual → release/<versión>/ (requiere Node 22)
npm run dist:linux   # solo el .deb (también dist:win y dist:mac)
```

> Cambios en `src/main/` o `src/preload/` necesitan reiniciar `npm run dev` (Ctrl+C y volver a lanzar). Solo el renderer se recarga en caliente.

La app usa **instancia única**: si se lanza otra vez, la segunda se cierra y la primera muestra el panel.

---

## 3. Arquitectura

```
 ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐
 │   Burbuja    │  │ Panel rápido │  │  Gestor de tareas   │   ← ventanas (renderer)
 │ bubble.html  │  │ index.html   │  │ index.html#manager  │
 └──────┬───────┘  └──────┬───────┘  └──────────┬──────────┘
        │   IPC (preload: window.api, contextIsolation)
 ┌──────▼──────────────────▼─────────────────────▼─────────┐
 │                 Proceso principal (Node)                 │
 │  index.ts  window.ts  bubble.ts  manager.ts              │
 │  ipc.ts → tasks.ts (servicio)  → db.ts (SQLite)          │
 │  sync.ts ↔ notion.ts        ai.ts → groq.ts              │
 │  settings.ts (settings.json + safeStorage)               │
 └──────────┬───────────────────────────┬──────────────────┘
            │                           │
     ┌──────▼──────┐            ┌───────▼────────┐
     │ tasks.sqlite│            │ Notion / Groq  │
     └─────────────┘            └────────────────┘
```

**Reglas**:
- El renderer **nunca** habla con Notion/Groq ni toca claves; todo pasa por IPC al proceso principal.
- Tras cada cambio local (`afterMutation`): se agenda un sync con debounce, se actualiza el contador de la burbuja y se avisa a todas las ventanas (`data:changed`) para que se refresquen.

### Datos en disco (`app.getPath('userData')`)

| Archivo | Contenido |
|---|---|
| `tasks.sqlite` | Tareas, borrados pendientes (`tombstones`) y proyectos |
| `settings.json` | Token de Notion y key de Groq **cifrados**, databases descubiertas con su mapeo y esquema, proyectos desactivados, posición de la burbuja y preferencias del gestor |

La carpeta se fija en `index.ts`: la app instalada usa `<appData>/local-management-center` (en Linux `~/.config/local-management-center`) y **`npm run dev` usa `local-management-center-dev`**, así no comparten la base de datos ni el bloqueo de instancia única y pueden abrirse a la vez. La primera vez que se arranca en desarrollo se copian ahí `settings.json` y `tasks.sqlite` de la carpeta normal.

---

## 4. Funcionalidades

### 4.1 Burbuja flotante (`src/main/bubble.ts`)
- `BrowserWindow` de 64 px, transparente, `alwaysOnTop`, `focusable: false`.
- El arrastre se calcula en el proceso principal con `screen.getCursorScreenPoint()` (funciona aunque la ventana no tenga foco).
- Al soltarla se pega al borde más cercano con animación; la posición se guarda en `settings.json`.
- Clic → `toggleManager()`; clic derecho → el mismo menú de la bandeja.
- Se puede ocultar desde el menú ("Mostrar burbuja").

### 4.2 Gestor de tareas (`src/main/manager.ts` + `src/renderer/src/manager/`)
- Se abre **pegado a la burbuja**, del lado que da al centro de la pantalla y alineado con su altura. Sin burbuja, centrado en la pantalla del cursor.
- **Modal**: ventana sin marco (`frame: false`, `alwaysOnTop`) que se oculta al perder el foco. `Esc` cierra primero el menú abierto, luego el detalle y por último el gestor. Se arrastra desde el título "Gestor de tareas".
- Las confirmaciones (borrar tarea, eliminar opción/columna) son **dentro de la app**: un `window.confirm` nativo le quitaría el foco y cerraría el gestor.
- **Barra lateral de proyectos**: "Todos" o un proyecto concreto. Las tareas nuevas se crean en el proyecto seleccionado (o en el elegido en el selector de la barra de alta).
- **Tabla**: Tarea, Proyecto (en "Todos"), Estado y Prioridad como chips con los colores de Notion, fecha y **todas las demás columnas** de la database (Cliente, Contacto, Correo, Plan…).
- **Filtros por columna** ("Filtro"): opciones múltiples (incluido "Vacío"), fechas (vencida, hoy, próximos 7 días, este mes, con/sin fecha), texto "contiene…" y casillas Sí/No.
- **Orden por varias columnas**: cada clic en un encabezado agrega esa columna como siguiente nivel (ascendente → descendente → se quita); el encabezado muestra su número de nivel. El chip de orden abre un editor para cambiar columna, dirección, subir/bajar niveles o agregar/quitar. La primera columna manda y las siguientes desempatan. Los vacíos siempre al final; Estado se ordena según el flujo de Notion. (Vistas antiguas con un solo `sort` se migran solas a `sorts`.)
- **Persistencia**: proyecto seleccionado, filtro Pendientes/Hechas/Todas y los filtros + orden **de cada proyecto** (y de "Todos") se guardan en `settings.json` (`ui.manager`), así sobreviven a reinicios. No afectan al panel rápido.
- **Texto completo / Compacto**: por defecto la tabla muestra todo el texto de cada tarea y columna (con saltos de línea); "Compacto" lo recorta a 2 líneas. Se recuerda en `ui.manager.compact`. En el detalle, el título y los textos largos crecen hasta verse completos.
- **Abrir el detalle**: con el botón junto al título de cada fila (el mismo botón lo cierra). Hacer clic en la fila **no** lo abre, para poder seleccionar y copiar texto de las celdas.
- **Detalle de tarea**: edición de todas las propiedades editables según su tipo (texto, número, select, status, multi-select, fecha, checkbox, URL, email, teléfono). Se puede cambiar el proyecto de una tarea.
- Buscador y micrófono integrados.
- Las columnas de **selección, selección múltiple y estado** se editan directamente en la tabla.

### 4.2.1 Columnas y opciones (como en Notion) (`src/main/schema.ts`)
Se aplican **directamente en Notion** (requiere conexión) con `PATCH /databases/{id}` y luego se ajustan los datos locales.

| Dónde | Qué se puede hacer |
|---|---|
| Menú de un chip (Estado, Prioridad, Plan…) | **Buscar o crear** una opción escribiendo su nombre. En Estado se elige el grupo (Por hacer / En curso / Completado). Botón **⋯** de cada opción: renombrar, cambiar color, eliminar. |
| Encabezado de la tabla (**⋮** al pasar el ratón) | Renombrar la columna, editar sus opciones, eliminar la columna. |
| Botón **+** al final de los encabezados | Crear una columna: Selección, Selección múltiple, Texto, Número, Fecha, Casilla, URL, Correo o Teléfono (con opciones iniciales). |
| Detalle de la tarea | Pulsar el nombre de un campo abre el mismo menú de columna; "Agregar columna" al final. |

- En "Todos los proyectos" no hay menú de encabezado (las columnas mezclan varias databases): se usa el detalle de una tarea, que sabe a qué database pertenece.
- **Renombrar una opción**: la API de Notion no lo permite, así que la app crea la opción nueva (mismo color y grupo), pasa a ella las páginas que usaban la vieja y elimina la vieja.
- Al **eliminar una opción**, Notion la quita de todas las tareas; al **eliminar una columna**, se pierden sus datos en todas las tareas de esa database.
- Las opciones existentes se envían por `id` (así Notion las conserva); las omitidas se eliminan.
- La integración necesita la capacidad **"Actualizar contenido"** en Notion para editar el esquema.

### 4.3 Proyectos = databases de Notion
- Al conectar, la app busca **todas las databases compartidas con la integración** (`/search`) y cada una pasa a ser un proyecto.
- **Mapeo automático** (`mapDatabase` en `notion.ts`): detecta título, estado (status/select/checkbox), fecha de vencimiento ("límite", "venc", "due"; excluye creación/finalización), prioridad (número o select) y etiquetas; guarda el esquema completo con opciones y colores.
- En **Ajustes** cada proyecto tiene un **interruptor** para traerlo o no. Los desactivados no se sincronizan, no se listan y no cuentan en la burbuja.
- Para que aparezca una database nueva: en Notion → `•••` → **Conexiones** → añadir la integración. Se descubre en el siguiente sync.

### 4.4 Sincronización (`src/main/sync.ts`)
- Al arrancar, cada **5 minutos** y ~1,5 s después de cada cambio local (debounce). También manual desde el indicador de sync.
- **Push**: solo se suben las propiedades modificadas (columna `dirty`). Las tareas nuevas se crean con todas sus propiedades.
- **Mover de proyecto**: Notion no mueve páginas entre databases, así que se crea la página en la nueva y se archiva la antigua.
- **Borrar**: se archiva la página en Notion (tabla `tombstones` mientras no haya conexión).
- **Pull**: trae todas las páginas de las databases activas; lo que ya no existe en Notion se borra en local.
- Conflictos: "última edición gana".

### 4.5 Voz + IA (`ai.ts`, `groq.ts`)

**Texto con IA en "Nueva tarea"** (gestor y panel rápido): con el interruptor **IA** activo (por defecto, si hay key de Groq; preferencia compartida por ambas ventanas en `ui.manager.aiText`), lo que escribes se envía a Groq junto con las **columnas del proyecto** (nombre, tipo y opciones válidas). La IA devuelve un valor por cada columna mencionada (Cliente, Contacto, Correo, Plan, Prioridad, Estado, fechas…), la app los **valida contra el esquema** (opciones exactas, fechas `YYYY-MM-DD`, números, casillas) y muestra la **revisión** con esos campos editables antes de crear. Con el interruptor apagado, el texto se guarda tal cual como título (con `!` para prioridad). Lo dictado por **voz** pasa por el mismo proceso.

1. El micrófono graba con `MediaRecorder` en el renderer.
2. El audio va al proceso principal → **Whisper** de Groq (`whisper-large-v3-turbo`, con `whisper-large-v3` de respaldo).
3. El texto va a un **LLM de Groq** que devuelve un JSON con las tareas: título, proyecto y `fields` (valor para cada columna del proyecto).
4. Se muestran en una **pantalla de revisión** con las columnas llenas, editables (y "Agregar campo"), antes de crearlas.

Detalles importantes:
- **Elección automática de modelo**: se consulta `/models` de la cuenta y se usa el primero disponible de la lista de preferencia (`openai/gpt-oss-120b`, `llama-3.3-70b-versatile`, `llama-4-maverick`, `qwen3-32b`, `gpt-oss-20b`…), con caché de 6 h. Si Groq retira un modelo, se refresca la lista y se reintenta con el siguiente.
- Si el modelo no soporta `response_format: json_object`, se reintenta sin él y se extrae el JSON de la respuesta.
- El prompt incluye la **fecha local de hoy** y un **calendario de los próximos 14 días** (evita errores con "el viernes", "el lunes"), además de los nombres de los proyectos activos para asignar cada tarea.
- La API key se obtiene gratis en https://console.groq.com/ y se pega en Ajustes.

### 4.6 Diseño (Material 3)
- Tokens en `tailwind.config.js` + variables CSS en `index.css` (claro y oscuro según el sistema).
- Clases base: `.btn` (`-filled`, `-tonal`, `-outlined`, `-text`, `-danger`), `.icon-btn`, `.field`, `.pill-input`, `.chip`, `.card`.
- Componentes reutilizables en `src/renderer/src/ui/`: `ChipSelect` (menú de opciones con color), `Switch`, `Popover`, `colors.ts` (colores de Notion → clases).

---

### 4.7 Recordatorios (`reminders.ts`, `autostart.ts`, `renderer/src/reminder/`)
- **Columna «Recordatorio»** (fecha y hora) en la database de Notion. Si un proyecto no la tiene, el gestor muestra **"Activar recordatorios"**, que la crea. Se detecta por nombre (`recordatorio`, `reminder`, `alarma`, `aviso`) y nunca se toma como fecha límite.
- Se edita con fecha **y hora** en la tabla (celda con campanita), en el detalle y desde la IA ("recuérdame mañana a las 3…"). Se guarda en Notion con el desfase local (ej. `2026-11-12T15:00:00-05:00`), así se ve igual en Notion y en **Notion Calendar** (si conectas allí la database). Solo con día, suena a las 9:00.
- **Aviso a la hora exacta**: notificación del sistema + ventanita siempre encima (esquina inferior derecha, sin robar el foco) con **sonido** y botones **Abrir** (gestor con el detalle), **Hecha**, **Posponer** (5 min, 15 min, 1 hora, mañana 9:00) y descartar (✕).
- **Avisos perdidos**: si la app estaba cerrada, al abrirla avisa los de los últimos 7 días, marcados como «Perdido».
- Solo para tareas **pendientes** de proyectos activos. Lo avisado y lo pospuesto se guarda en `settings.json` (`reminders`); si cambias la hora de un recordatorio, vuelve a armarse.
- **Iniciar con el sistema** (Ajustes → Recordatorios): en Linux crea `~/.config/autostart/local-management-center.desktop`; en macOS/Windows usa `setLoginItemSettings`. En desarrollo arranca la última compilación (`npm run build`); conviene no activarlo mientras desarrollas con `npm run dev` (la instancia única haría que el `dev` se cierre).
- La API de Notion no permite crear los recordatorios nativos de Notion; el aviso lo da esta app.

### 4.8 Instaladores y actualizaciones (`electron-builder.yml`, `updater.ts`, `.github/workflows/release.yml`)

**Instaladores** (electron-builder):

| Sistema | Archivo | Se actualiza solo |
|---|---|---|
| Linux | `local-management-center_X.Y.Z_amd64.deb` | Sí; al instalar pide la contraseña (pkexec) |
| Windows | `local-management-center-X.Y.Z-setup.exe` (un clic, sin administrador) | Sí, en silencio |
| macOS | `local-management-center-X.Y.Z-arm64.dmg` / `-x64.dmg` | **No**: sin firma de Apple solo avisa y abre la página de descarga |

- Las versiones se publican en **GitHub Releases** de este mismo repositorio (debe ser **público** para que la app instalada las vea sin token).
- macOS va con firma *ad-hoc*: la primera vez se abre con **clic derecho → Abrir**. Si dice que "está dañada", ejecutar `xattr -cr "/Applications/Centro de Control de Tareas.app"`. Para que se actualice sola hace falta una cuenta de Apple Developer (firma + notarización).
- Windows sin certificado: SmartScreen avisa la primera vez ("Más información → Ejecutar de todas formas").

**Publicar una versión nueva:**
```bash
npm version patch            # 0.1.0 → 0.1.1 (o minor / major): cambia package.json, hace commit y crea la etiqueta v0.1.1
git push && git push --tags  # la etiqueta dispara la GitHub Action
```
La Action (pestaña **Actions** en GitHub) crea la versión como **borrador**, arma el `.deb` (Ubuntu), el `.exe` (Windows) y los `.dmg` (macOS), los sube y recién entonces la **publica**. Si un sistema falla, queda en borrador (nadie la recibe) y se puede relanzar. La etiqueta debe coincidir con `version` de `package.json`.

**En la app instalada** (`updater.ts`, con `electron-updater`):
- Busca versión nueva **15 s después de abrir** y **cada 4 horas**; también con **Ajustes → Actualizaciones → Buscar actualizaciones**.
- Windows/Linux: la descarga en segundo plano y avisa con una notificación; se instala con **"Reiniciar y actualizar"** (Ajustes, notificación o menú de la bandeja) o sola **al salir** de la app.
- macOS: notificación + botón **Descargar** (abre la página de la versión).
- Las tareas, el token y los ajustes se conservan entre versiones (viven en la carpeta de datos, no en la instalación).
- En `npm run dev` no se busca nada (Ajustes muestra "Modo desarrollo").

## 5. Modelo de datos (SQLite)

```sql
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,      -- uuid local
  notion_id   TEXT,                  -- id de la página en Notion
  notion_db   TEXT,                  -- database (proyecto) a la que pertenece
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'done'
  due_date    TEXT,
  priority    INTEGER NOT NULL DEFAULT 0,       -- 0-3
  tags        TEXT,
  project     TEXT,                  -- nombre del proyecto (título de la database)
  props       TEXT,                  -- JSON con TODAS las propiedades de Notion
  dirty       TEXT,                  -- JSON con las propiedades cambiadas pendientes de subir
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  synced      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE tombstones (notion_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);
CREATE TABLE projects   (name TEXT PRIMARY KEY);
```

Los campos principales (`title`, `status`, `due_date`, `priority`, `tags`) se mantienen sincronizados con sus propiedades equivalentes dentro de `props` (`tasks.ts`). Las columnas nuevas se añaden con migraciones al arrancar.

---

## 6. Estructura de carpetas

```
local-manament-center/
├── src/
│   ├── main/                    # Proceso principal (Node)
│   │   ├── index.ts             # arranque, instancia única, atajo global, burbuja, auto-sync
│   │   ├── window.ts            # panel rápido, bandeja y menú de la app
│   │   ├── bubble.ts            # burbuja flotante (arrastre, pegado al borde, contador)
│   │   ├── manager.ts           # ventana del gestor (ubicación junto a la burbuja)
│   │   ├── ipc.ts               # handlers IPC
│   │   ├── tasks.ts             # servicio de tareas (crear/editar/completar)
│   │   ├── db.ts                # SQLite + migraciones
│   │   ├── sync.ts              # sincronización con Notion, descubrimiento de proyectos
│   │   ├── notion.ts            # cliente Notion, mapeo de esquema y propiedades
│   │   ├── schema.ts            # crear/renombrar/eliminar columnas y opciones en Notion
│   │   ├── reminders.ts         # recordatorios: programación, aviso, posponer, perdidos
│   │   ├── autostart.ts         # iniciar con el sistema
│   │   ├── updater.ts           # actualizaciones (electron-updater + GitHub Releases)
│   │   ├── ai.ts                # flujo de voz → tareas
│   │   ├── groq.ts              # cliente Groq (Whisper + LLM, elección de modelo)
│   │   └── settings.ts          # settings.json + safeStorage
│   ├── preload/index.ts         # expone window.api
│   ├── shared/types.ts          # tipos compartidos main ↔ renderer
│   ├── shared/dates.ts          # fechas con hora en zona local (recordatorios)
│   └── renderer/
│       ├── index.html           # panel y gestor (#manager)
│       ├── bubble.html          # burbuja
│       └── src/
│           ├── main.tsx         # elige App (panel) o ManagerApp según el hash
│           ├── App.tsx          # panel rápido
│           ├── store.ts         # Zustand
│           ├── bubble.ts        # lógica de la burbuja (arrastre, clic)
│           ├── components/      # TaskItem, QuickAdd, ProjectBar, Settings, VoiceButton, VoiceReview…
│           ├── reminder/        # ventanita de avisos (#reminder)
│           ├── manager/         # ManagerApp, FilterBar, tableView, TaskDetail, PropEditor,
│           │                    # OptionField (selecciones con gestión de opciones), ColumnMenus
│           └── ui/              # ChipSelect/MultiChipSelect, OptionMenu, Switch, Popover, colors
├── resources/                   # iconos (icon.png, trayColor.png…)
├── build/icon.png               # icono de los instaladores
├── scripts/gen-icons.mjs        # genera los iconos
├── .github/workflows/release.yml # arma y publica los instaladores al crear una etiqueta vX.Y.Z
├── electron-builder.yml         # configuración de los instaladores
├── electron.vite.config.ts
├── tailwind.config.js
└── package.json
```

---

## 7. Seguridad y buenas prácticas

- `contextIsolation: true`, `nodeIntegration: false`; el preload expone solo funciones concretas.
- Token de Notion y key de Groq cifrados con `safeStorage`; nunca en el renderer ni en el repositorio.
- La salida JSON de la IA se valida y sanea antes de proponer tareas, y el usuario las revisa antes de crearlas.
- Fechas "de hoy" y "fecha de creación" siempre en **hora local** (no UTC).
- Commits sin líneas de atribución a herramientas de IA.

---

## 8. Estado y roadmap

### ✅ Hecho
- [x] Proyecto base Electron + React + TS con electron-vite, Tailwind y preload seguro.
- [x] Bandeja (compatible con Linux/AppIndicator), panel rápido y atajo global.
- [x] SQLite offline-first con CRUD vía IPC.
- [x] Sincronización bidireccional con Notion e indicador de estado.
- [x] **Todos los proyectos de Notion** con activación por interruptor.
- [x] Esquema de Notion detectado automáticamente; todas las propiedades visibles y editables.
- [x] **Burbuja flotante** siempre encima, arrastrable, con contador.
- [x] **Gestor de tareas** en tabla, pegado a la burbuja, con filtros y orden guardados por proyecto.
- [x] Voz con Whisper (Groq) + IA que estructura tareas, con pantalla de revisión.
- [x] Elección automática del modelo de Groq y calendario en el prompt.
- [x] Rediseño Material 3 (chips, botones redondos, modo oscuro).
- [x] Gestor como **modal** (clic fuera o Esc para cerrar).
- [x] Crear/renombrar/eliminar **columnas** y **opciones** (selección, múltiple y estado) desde la app.
- [x] **IA llena las columnas** del proyecto a partir del texto o la voz.
- [x] **Orden por varias columnas** en la tabla del gestor.
- [x] **Instaladores** (`.deb`, `.exe`, `.dmg`) armados por GitHub Actions y publicados en GitHub Releases.
- [x] **Actualizaciones automáticas** (`electron-updater`) en Linux y Windows; aviso de versión nueva en macOS.

### ⏳ Pendiente
- [ ] Comandos de voz para **editar** tareas ("marca X como hecha", "cambia la fecha de Y").
- [x] **Recordatorios** con fecha y hora: aviso con sonido, posponer, perdidos e inicio con el sistema.
- [ ] Preferencias: cambiar el atajo.
- [ ] Firma de código en macOS (Apple Developer) para que también se actualice sola, y en Windows para evitar SmartScreen.
- [ ] Whisper local (`whisper.cpp`) para voz sin conexión.

---

## 9. Problemas conocidos y soluciones

| Síntoma | Causa / solución |
|---|---|
| Un cambio en `src/main` no se ve | El proceso principal no recarga en caliente: reiniciar `npm run dev`. |
| No aparece un proyecto de Notion | Compartir la database con la integración (`•••` → Conexiones) y sincronizar. |
| "El modelo … no existe / no tienes acceso" (Groq) | Ya se resuelve solo eligiendo otro modelo disponible; si persiste, revisar la key en Ajustes. |
| `better-sqlite3` no carga | `npm run rebuild`. |
| El icono de bandeja no responde al clic en Linux | Es normal con AppIndicator: usar el menú o la burbuja. |
| `npm run dist` falla con `The "paths[0]" argument must be of type string` | electron-builder 26 requiere **Node 22**: `nvm use 22` (hay `.nvmrc`). |
| "Aún no hay versiones publicadas" en Ajustes | No hay ninguna versión publicada en GitHub Releases (o el repositorio es privado). |
| El `.deb` instalado no abre (`GLIBC_2.38 not found` al lanzarlo desde la terminal) | El instalador se armó en un Ubuntu más nuevo que el del equipo: `better-sqlite3` se compila contra la glibc del runner. La Action arma Linux en `ubuntu-22.04` para que sirva desde 22.04 en adelante. Desde la 0.1.1, si el arranque falla, la app muestra el error y se cierra. |
| Ubuntu 24.04+: el `.deb` instalado no abre (`The SUID sandbox helper binary was found, but is not configured correctly` al lanzarlo desde la terminal) | Ubuntu 24.04 restringe los *user namespaces* que usa el sandbox de Chromium: la app necesita el perfil `/etc/apparmor.d/local-management-center` o `chrome-sandbox` con SUID. Desde la 0.1.2 el instalador (`build/linux/after-install.tpl`) deja las dos cosas y la actualización ya no borra el perfil (`build/linux/after-remove.tpl`). Arreglo a mano: `sudo cp "/opt/Centro de Control de Tareas/resources/apparmor-profile" /etc/apparmor.d/local-management-center && sudo apparmor_parser -r /etc/apparmor.d/local-management-center`, o bien `sudo chown root:root "/opt/Centro de Control de Tareas/chrome-sandbox" && sudo chmod 4755 "/opt/Centro de Control de Tareas/chrome-sandbox"`. |
| macOS: "la app está dañada" | Falta firma de Apple: `xattr -cr "/Applications/Centro de Control de Tareas.app"`. |

---

## 10. Recursos

- Electron: https://www.electronjs.org/
- electron-vite: https://electron-vite.org/
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3
- Notion API: https://developers.notion.com/
- Groq: https://console.groq.com/
- electron-builder: https://www.electron.build/
- whisper.cpp (futuro): https://github.com/ggerganov/whisper.cpp
