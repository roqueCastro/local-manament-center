import { useCallback, useEffect, useRef, useState } from 'react'
import {
  TIPOS_LOG,
  type AccionServicio,
  type EstadoServicio,
  type ServicioEstado,
  type ServidorConfig,
  type ServiciosResumen,
  type TipoLog
} from '../../../shared/types'
import { Switch } from '../ui/Switch'

// Ventana "Servicios": Docker compose (Graylog, webhook) y captura de cada servidor
// (systemd --user). El estado se consulta cada 5 s mientras la ventana está visible.

const ESTADO: Record<EstadoServicio, { texto: string; punto: string; chip: string }> = {
  activo: { texto: 'Encendido', punto: 'bg-[#1e8e3e]', chip: 'bg-[#1e8e3e]/15 text-[#137333] dark:text-[#81c995]' },
  parcial: { texto: 'A medias', punto: 'bg-[#f9ab00]', chip: 'bg-[#f9ab00]/20 text-[#b06000] dark:text-[#fdd663]' },
  iniciando: { texto: 'Cambiando…', punto: 'bg-primary animate-pulse', chip: 'bg-primary-soft text-on-primary-soft' },
  fallo: { texto: 'Con fallo', punto: 'bg-danger', chip: 'bg-danger-soft text-danger' },
  detenido: { texto: 'Apagado', punto: 'bg-line-strong', chip: 'bg-surface-3 text-ink-2' },
  desconocido: { texto: 'Sin dato', punto: 'bg-line-strong', chip: 'bg-surface-3 text-ink-2' }
}

const NOMBRE_TIPO: Record<TipoLog, string> = {
  nginx: 'nginx',
  mysql: 'MySQL slow',
  laravellog: 'laravel.log',
  fpmslow: 'FPM slowlog',
  fpmlog: 'FPM log'
}

function hace(iso: string | null): string {
  if (!iso) return ''
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  const hora = new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  if (min < 1) return `desde ${hora} (recién)`
  if (min < 60) return `desde ${hora} (hace ${min} min)`
  const h = Math.floor(min / 60)
  if (h < 48) return `desde ${hora} (hace ${h} h ${min % 60} min)`
  return `desde ${hora} (hace ${Math.floor(h / 24)} días)`
}

function Punto({ estado }: { estado: EstadoServicio }): JSX.Element {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ESTADO[estado].punto}`} />
}

function Chip({ estado }: { estado: EstadoServicio }): JSX.Element {
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${ESTADO[estado].chip}`}>
      <Punto estado={estado} />
      {ESTADO[estado].texto}
    </span>
  )
}

export default function ServiciosApp(): JSX.Element {
  const [resumen, setResumen] = useState<ServiciosResumen | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  // Formulario: null = cerrado; { original: null } = servidor nuevo
  const [form, setForm] = useState<{ original: ServidorConfig | null } | null>(null)

  const cargar = useCallback(async () => {
    const r = await window.api.servicios.estado()
    setResumen(r)
    setSel((s) => (s && r.servicios.some((x) => x.id === s) ? s : (r.servicios[0]?.id ?? null)))
  }, [])

  useEffect(() => {
    void cargar()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void cargar()
    }, 5000)
    window.api.servicios.onCambio(() => void cargar())
    window.api.servicios.onSeleccionar((id) => {
      setForm(null)
      setSel(id)
      void cargar()
    })
    return () => {
      clearInterval(t)
      window.api.servicios.offCambio()
    }
  }, [cargar])

  if (!resumen) return <div className="flex h-full items-center justify-center text-sm text-ink-2">Consultando servicios…</div>
  if (!resumen.disponible)
    return <div className="flex h-full items-center justify-center text-sm text-ink-2">Los servicios solo están disponibles en Linux.</div>

  const docker = resumen.servicios.filter((s) => s.tipo === 'docker')
  const capturas = resumen.servicios.filter((s) => s.tipo === 'captura')
  const actual = resumen.servicios.find((s) => s.id === sel) ?? null

  return (
    <div className="flex h-full flex-col bg-surface text-ink">
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <h1 className="text-xl font-normal">Servicios</h1>
        <span className={`text-xs ${resumen.dockerOk ? 'text-ink-2' : 'text-danger'}`}>
          {resumen.dockerOk ? 'Docker conectado' : 'Docker no responde'}
        </span>
        <div className="flex-1" />
        <button className="btn btn-sm btn-text" onClick={() => window.api.servicios.abrirConfig()} title={resumen.configPath}>
          Abrir servicios.json
        </button>
        <button className="icon-btn" onClick={() => void cargar()} aria-label="Actualizar" title="Actualizar">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
          </svg>
        </button>
      </header>

      {resumen.avisos.length > 0 && (
        <div className="space-y-2 px-5 pt-3">
          {resumen.avisos.map((a) => (
            <div key={a} className="rounded-xl bg-[#f9ab00]/15 px-4 py-2.5 text-[13px] leading-snug text-ink">
              ⚠️ {a}
            </div>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4 p-5">
        {/* Lista */}
        <aside className="scroll-thin flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto overflow-x-hidden">
          <Seccion titulo="Docker">
            {docker.length === 0 && <Vacio texto='Sin proyectos. Agrégalos en "docker" de servicios.json.' />}
            {docker.map((s) => (
              <Item key={s.id} s={s} activo={s.id === sel && !form} onClick={() => (setForm(null), setSel(s.id))} />
            ))}
          </Seccion>
          <Seccion
            titulo="Servidores (captura)"
            accion={
              <button className="btn btn-sm btn-text -mr-3" onClick={() => setForm({ original: null })}>
                + Agregar
              </button>
            }
          >
            {capturas.length === 0 && <Vacio texto="Sin servidores todavía." />}
            {capturas.map((s) => (
              <Item key={s.id} s={s} activo={s.id === sel && !form} onClick={() => (setForm(null), setSel(s.id))} />
            ))}
          </Seccion>
        </aside>

        {/* Detalle */}
        <main className="card scroll-thin min-w-0 flex-1 overflow-y-auto p-6">
          {form ? (
            <FormServidor
              original={form.original}
              onCerrar={(idGuardado) => {
                setForm(null)
                if (idGuardado) setSel(`srv:${idGuardado}`)
                void cargar()
              }}
            />
          ) : actual ? (
            <Detalle
              key={actual.id}
              s={actual}
              recargar={cargar}
              onEditar={() => actual.servidor && setForm({ original: actual.servidor })}
            />
          ) : (
            <Vacio texto="Elige un servicio." />
          )}
        </main>
      </div>
    </div>
  )
}

function Seccion({ titulo, accion, children }: { titulo: string; accion?: React.ReactNode; children: React.ReactNode }): JSX.Element {
  return (
    <section>
      <div className="mb-2 flex h-8 items-center justify-between px-1">
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink-2">{titulo}</h2>
        {accion}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

function Vacio({ texto }: { texto: string }): JSX.Element {
  return <p className="px-1 py-2 text-[13px] text-ink-2">{texto}</p>
}

function Item({ s, activo, onClick }: { s: ServicioEstado; activo: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-left transition-colors ${
        activo ? 'bg-primary-soft text-on-primary-soft' : 'bg-card hover:bg-surface-2'
      }`}
    >
      <span className="pt-1.5">
        <Punto estado={s.estado} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{s.etiqueta}</span>
          {s.alIniciar && (
            <span className="shrink-0 rounded-full bg-ink/10 px-2 text-[11px] leading-5" title="Se enciende al arrancar el PC">
              con el PC
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs opacity-75">
          {ESTADO[s.estado].texto} · {s.detalle}
        </span>
      </span>
    </button>
  )
}

function Detalle({ s, recargar, onEditar }: { s: ServicioEstado; recargar: () => Promise<void>; onEditar: () => void }): JSX.Element {
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null)
  const [contenedor, setContenedor] = useState<string | null>(null)

  const encendido = s.estado === 'activo' || s.estado === 'parcial' || s.estado === 'iniciando'
  const nombreTipo = s.tipo === 'docker' ? 'el proyecto Docker' : 'la captura'

  async function hacer(acc: AccionServicio): Promise<void> {
    if (acc === 'detener' && !confirm(`¿Apagar ${nombreTipo} "${s.etiqueta}"?`)) return
    setOcupado(acc === 'iniciar' ? 'Encendiendo…' : acc === 'detener' ? 'Apagando…' : 'Reiniciando…')
    setMensaje(null)
    const r = await window.api.servicios.accion(s.id, acc)
    setOcupado(null)
    if (!r.ok) setMensaje({ ok: false, texto: r.mensaje ?? 'No se pudo.' })
    await recargar()
  }

  async function reiniciarCont(nombre: string): Promise<void> {
    setOcupado(`Reiniciando ${nombre}…`)
    setMensaje(null)
    const r = await window.api.servicios.reiniciarContenedor(s.id, nombre)
    setOcupado(null)
    setMensaje(r.ok ? { ok: true, texto: `${nombre} reiniciado.` } : { ok: false, texto: r.mensaje ?? 'No se pudo.' })
    await recargar()
  }

  async function eliminar(): Promise<void> {
    if (!confirm(`¿Eliminar el servidor "${s.etiqueta}"? Se apaga su captura y se borra su servicio de systemd. Los datos en Graylog no se tocan.`)) return
    const r = await window.api.servicios.eliminarServidor(s.id)
    if (!r.ok) setMensaje({ ok: false, texto: r.mensaje ?? 'No se pudo.' })
    await recargar()
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-normal">{s.etiqueta}</h2>
        <Chip estado={s.estado} />
        <span className="text-[13px] text-ink-2">{hace(s.desde)}</span>
      </div>
      <p className="-mt-3 text-sm text-ink-2">{s.detalle}</p>

      <div className="flex flex-wrap items-center gap-2">
        {s.estado !== 'activo' && (
          <button className="btn btn-filled" disabled={!!ocupado} onClick={() => void hacer('iniciar')}>
            Encender
          </button>
        )}
        {encendido && (
          <button className="btn btn-tonal" disabled={!!ocupado} onClick={() => void hacer('reiniciar')}>
            Reiniciar
          </button>
        )}
        {(encendido || s.estado === 'fallo') && (
          <button className="btn btn-outlined" disabled={!!ocupado} onClick={() => void hacer('detener')}>
            Apagar
          </button>
        )}
        {ocupado && <span className="text-sm text-ink-2">{ocupado}</span>}
        <div className="flex-1" />
        <label className="flex items-center gap-3 text-sm">
          Encender con el PC
          <Switch
            checked={s.alIniciar}
            label="Encender con el PC"
            onChange={(v) => void window.api.servicios.setAlIniciar(s.id, v).then(recargar)}
          />
        </label>
      </div>

      {mensaje && (
        <pre
          className={`whitespace-pre-wrap rounded-xl px-4 py-3 font-sans text-[13px] ${
            mensaje.ok ? 'bg-primary-soft text-on-primary-soft' : 'bg-danger-soft text-danger'
          }`}
        >
          {mensaje.texto}
        </pre>
      )}

      {s.tipo === 'docker' && (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-1 text-left text-xs text-ink-2">
              <tr>
                <th className="px-4 py-2 font-medium">Contenedor</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(s.contenedores ?? []).length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-ink-2">
                    Sin contenedores (se crean al encender).
                  </td>
                </tr>
              )}
              {(s.contenedores ?? []).map((c) => {
                const e: EstadoServicio = c.estado === 'running' ? 'activo' : c.estado === 'restarting' ? 'fallo' : 'detenido'
                return (
                  <tr key={c.nombre} className={`border-t border-line ${contenedor === c.nombre ? 'bg-primary/5' : ''}`}>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2">
                        <Punto estado={e} />
                        <span className="font-medium">{c.nombre}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2 text-ink-2">{c.detalle}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      <button className="btn btn-sm btn-text" onClick={() => setContenedor(contenedor === c.nombre ? null : c.nombre)}>
                        {contenedor === c.nombre ? 'Todos los logs' : 'Ver log'}
                      </button>
                      <button className="btn btn-sm btn-text" disabled={!!ocupado} onClick={() => void reiniciarCont(c.nombre)}>
                        Reiniciar
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {s.tipo === 'captura' && s.servidor && (
        <div className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-2.5 rounded-xl border border-line px-5 py-4 text-[13px]">
          <span className="text-ink-2">Servidor</span>
          <span className="font-medium">{s.servidor.nombre}</span>
          <span className="text-ink-2">IP</span>
          <span className="font-mono">{s.servidor.ip}</span>
          <span className="text-ink-2">Logs</span>
          <span className="flex flex-wrap gap-1.5">
            {s.servidor.tipos.length === 0 && <span className="text-ink-2">ninguno</span>}
            {s.servidor.tipos.map((t) => (
              <span key={t} className="rounded-full bg-surface-2 px-2.5 leading-6">
                {NOMBRE_TIPO[t]}
              </span>
            ))}
          </span>
          <span className="text-ink-2">Métricas</span>
          <span>{s.servidor.metricas ? 'CPU, RAM y PHP-FPM cada 5 s' : 'No'}</span>
          <span className="text-ink-2">Último minuto</span>
          <span className="font-mono text-xs leading-5">{s.ultimoMinuto ?? '—'}</span>
          <span className="text-ink-2">Servicio</span>
          <span className="font-mono text-xs leading-5">centro-captura-{s.servidor.id}.service</span>
          <span />
          <span className="flex gap-2 pt-1">
            <button className="btn btn-sm btn-outlined" onClick={onEditar}>
              Editar
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => void eliminar()}>
              Eliminar
            </button>
          </span>
        </div>
      )}

      <PanelLogs id={s.id} contenedor={contenedor} titulo={s.tipo === 'docker' ? (contenedor ?? 'todo el proyecto (últimas 40 por contenedor)') : 'captura (journalctl)'} />
    </div>
  )
}

function PanelLogs({ id, contenedor, titulo }: { id: string; contenedor: string | null; titulo: string }): JSX.Element {
  const [texto, setTexto] = useState('')
  const [cargando, setCargando] = useState(false)
  const [auto, setAuto] = useState(true)
  const caja = useRef<HTMLPreElement>(null)
  const pegadoAbajo = useRef(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const t = await window.api.servicios.logs(id, contenedor)
    setCargando(false)
    setTexto(t)
  }, [id, contenedor])

  useEffect(() => {
    pegadoAbajo.current = true
    void cargar()
  }, [cargar])

  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void cargar()
    }, 5000)
    return () => clearInterval(t)
  }, [auto, cargar])

  // Seguir el final del log salvo que el usuario haya subido a leer
  useEffect(() => {
    const el = caja.current
    if (el && pegadoAbajo.current) el.scrollTop = el.scrollHeight
  }, [texto])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-medium">Log — {titulo}</h3>
        {cargando && <span className="text-xs text-ink-2">cargando…</span>}
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-xs text-ink-2">
          Actualizar cada 5 s
          <Switch checked={auto} onChange={setAuto} label="Actualizar cada 5 s" />
        </label>
        <button className="btn btn-sm btn-text" onClick={() => void cargar()}>
          Actualizar
        </button>
      </div>
      <pre
        ref={caja}
        onScroll={(e) => {
          const el = e.currentTarget
          pegadoAbajo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        className="scroll-thin h-[340px] select-text overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-1 px-4 py-3 font-mono text-[11.5px] leading-[1.55] text-ink"
      >
        {texto}
      </pre>
    </div>
  )
}

function FormServidor({ original, onCerrar }: { original: ServidorConfig | null; onCerrar: (idGuardado?: string) => void }): JSX.Element {
  const [s, setS] = useState<ServidorConfig>(
    original ?? { id: '', nombre: '', etiqueta: '', ip: '', tipos: ['nginx', 'mysql', 'laravellog', 'fpmslow', 'fpmlog'], metricas: true, alIniciar: false }
  )
  // En un servidor nuevo el identificador se sugiere a partir del nombre hasta que se edite a mano
  const [idManual, setIdManual] = useState(!!original)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  function cambiar(patch: Partial<ServidorConfig>): void {
    setS((prev) => {
      const nuevo = { ...prev, ...patch }
      if (!idManual && patch.nombre !== undefined) nuevo.id = patch.nombre
      return nuevo
    })
  }

  async function guardar(): Promise<void> {
    setGuardando(true)
    setError(null)
    const r = await window.api.servicios.guardarServidor(s, original?.id ?? null)
    setGuardando(false)
    if (!r.ok) {
      setError(r.mensaje ?? 'No se pudo guardar.')
      return
    }
    if (r.mensaje) alert(r.mensaje)
    onCerrar(s.id)
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-5">
      <h2 className="text-2xl font-normal">{original ? `Editar ${original.etiqueta}` : 'Agregar servidor'}</h2>

      <div className="grid grid-cols-2 gap-4">
        <Campo etiqueta="Etiqueta" ayuda="Lo que se ve en la lista (ej. Ultra)">
          <input className="field" value={s.etiqueta} onChange={(e) => cambiar({ etiqueta: e.target.value })} autoFocus />
        </Campo>
        <Campo etiqueta="IP o host" ayuda="Se entra como root con tu llave SSH">
          <input className="field font-mono" value={s.ip} onChange={(e) => cambiar({ ip: e.target.value.trim() })} placeholder="203.0.113.10" />
        </Campo>
        <Campo etiqueta="Nombre del servidor" ayuda="Como aparece en Graylog y en log_ingest/ (a-z, 0-9, _)">
          <input
            className="field font-mono"
            value={s.nombre}
            onChange={(e) => cambiar({ nombre: e.target.value.toLowerCase().trim() })}
            placeholder="miempresa_web"
          />
        </Campo>
        <Campo etiqueta="Identificador" ayuda={`Servicio: centro-captura-${s.id || '…'}.service`}>
          <input
            className="field font-mono"
            value={s.id}
            onChange={(e) => {
              setIdManual(true)
              setS({ ...s, id: e.target.value.toLowerCase().trim() })
            }}
            placeholder="web"
          />
        </Campo>
      </div>

      <Campo etiqueta="Logs a capturar (último minuto, cada minuto)">
        <div className="flex flex-wrap gap-2">
          {TIPOS_LOG.map((t) => {
            const on = s.tipos.includes(t)
            return (
              <button
                key={t}
                type="button"
                className={`chip ${on ? 'chip-on' : ''}`}
                onClick={() => cambiar({ tipos: on ? s.tipos.filter((x) => x !== t) : TIPOS_LOG.filter((x) => x === t || s.tipos.includes(x)) })}
              >
                {on ? '✓ ' : ''}
                {NOMBRE_TIPO[t]}
              </button>
            )
          })}
        </div>
      </Campo>

      <div className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            Métricas de CPU, RAM y PHP-FPM
            <span className="block text-xs text-ink-2">Deja 2 conexiones SSH abiertas (vmstat cada 5 s)</span>
          </span>
          <Switch checked={s.metricas} onChange={(v) => cambiar({ metricas: v })} label="Métricas" />
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>Encender con el PC</span>
          <Switch checked={s.alIniciar} onChange={(v) => cambiar({ alIniciar: v })} label="Encender con el PC" />
        </label>
      </div>

      {!original && (
        <p className="rounded-xl border border-line px-4 py-3 text-[13px] leading-relaxed text-ink-2">
          El servidor debe tener los logs en las mismas rutas que los de MasControl (nginx{' '}
          <code>/var/log/nginx/proyecto-laravel_access.log</code>, MySQL <code>/var/log/mysql/mysql-slow.log</code>, Laravel{' '}
          <code>/var/www/html/storage/logs/laravel.log</code>, PHP 8.2-FPM). Los filebeat lo toman solos; las listas de
          servidores del dashboard, el diagnóstico y el importador todavía hay que actualizarlas a mano.
        </p>
      )}

      {error && <pre className="whitespace-pre-wrap rounded-xl bg-danger-soft px-4 py-3 font-sans text-[13px] text-danger">{error}</pre>}

      <div className="flex gap-2">
        <button className="btn btn-filled" disabled={guardando} onClick={() => void guardar()}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button className="btn btn-text" onClick={() => onCerrar()}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium">{etiqueta}</span>
      {children}
      {ayuda && <span className="text-xs text-ink-2">{ayuda}</span>}
    </label>
  )
}
