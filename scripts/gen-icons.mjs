// Genera iconos PNG sin dependencias externas (PNG construido a mano + zlib).
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

// Dibuja un "check" dentro de un cuadrado redondeado. draw(x,y) -> [r,g,b,a]
function makePng(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let p = 0
  for (let y = 0; y < size; y++) {
    raw[p++] = 0 // filtro none por fila
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size)
      raw[p++] = r
      raw[p++] = g
      raw[p++] = b
      raw[p++] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// --- formas ---
function roundedSquareAlpha(x, y, size) {
  const r = size * 0.22
  const inset = size * 0.08
  const minX = inset
  const minY = inset
  const maxX = size - inset
  const maxY = size - inset
  // distancia a la caja redondeada
  const cx = Math.min(Math.max(x, minX + r), maxX - r)
  const cy = Math.min(Math.max(y, minY + r), maxY - r)
  const dx = x - cx
  const dy = y - cy
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (x < minX || x > maxX || y < minY || y > maxY) return 0
  if (x > minX + r && x < maxX - r) return 1
  if (y > minY + r && y < maxY - r) return 1
  return dist <= r ? 1 : 0
}

function checkMask(x, y, size) {
  // trazo de un check sencillo
  const stroke = size * 0.1
  // dos segmentos
  const segs = [
    [size * 0.3, size * 0.55, size * 0.45, size * 0.68],
    [size * 0.45, size * 0.68, size * 0.72, size * 0.36]
  ]
  for (const [x1, y1, x2, y2] of segs) {
    const vx = x2 - x1
    const vy = y2 - y1
    const len2 = vx * vx + vy * vy
    let t = ((x - x1) * vx + (y - y1) * vy) / len2
    t = Math.max(0, Math.min(1, t))
    const px = x1 + t * vx
    const py = y1 + t * vy
    const d = Math.hypot(x - px, y - py)
    if (d <= stroke / 2) return true
  }
  return false
}

// Icono de bandeja: template (negro + alfa) para que macOS lo adapte al tema
function trayTemplateDraw(x, y, size) {
  const bg = roundedSquareAlpha(x, y, size)
  if (!bg) return [0, 0, 0, 0]
  if (checkMask(x, y, size)) return [0, 0, 0, 0] // hueco del check
  return [0, 0, 0, Math.round(255 * bg)]
}

// Icono de app a color (indigo con check blanco)
function appDraw(x, y, size) {
  const bg = roundedSquareAlpha(x, y, size)
  if (!bg) return [0, 0, 0, 0]
  if (checkMask(x, y, size)) return [255, 255, 255, Math.round(255 * bg)]
  return [79, 70, 229, Math.round(255 * bg)] // indigo-600
}

const resourcesDir = join(root, 'resources')
const buildDir = join(root, 'build')
mkdirSync(resourcesDir, { recursive: true })
mkdirSync(buildDir, { recursive: true })

// Tray: 22px (macOS) — template image
writeFileSync(join(resourcesDir, 'trayTemplate.png'), makePng(22, trayTemplateDraw))
writeFileSync(join(resourcesDir, 'trayTemplate@2x.png'), makePng(44, trayTemplateDraw))
// Tray a color para Linux/Windows (no soportan template images; el negro no se ve en barras oscuras)
writeFileSync(join(resourcesDir, 'trayColor.png'), makePng(32, appDraw))
// Icono de app
writeFileSync(join(resourcesDir, 'icon.png'), makePng(512, appDraw))
writeFileSync(join(buildDir, 'icon.png'), makePng(512, appDraw))

console.log('Iconos generados en resources/ y build/')
