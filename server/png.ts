// Minimal 8-bit greyscale PNG encoder + a tiny drawing surface. The Even SDK
// accepts encoded PNG bytes for image containers and converts to 4-bit grey
// on the phone, so this is all an image tab needs to draw charts and icons.
import { deflateSync } from 'node:zlib'

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** Encode a width*height Uint8Array of 0..255 grey values as PNG. */
export function encodeGreyPng(width: number, height: number, pixels: Uint8Array): Buffer {
  if (pixels.length !== width * height) throw new Error('pixel buffer size mismatch')
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0 // filter: none
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ])
}

// 3x5 pixel glyphs for a tiny label font (digits, a few symbols, upper-case).
const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
  '%': ['101', '001', '010', '100', '101'], '.': ['000', '000', '000', '000', '010'],
  ':': ['000', '010', '000', '010', '000'], '-': ['000', '000', '111', '000', '000'],
  ' ': ['000', '000', '000', '000', '000'], '/': ['001', '001', '010', '100', '100'],
  'A': ['111', '101', '111', '101', '101'], 'B': ['110', '101', '110', '101', '110'],
  'C': ['111', '100', '100', '100', '111'], 'D': ['110', '101', '101', '101', '110'],
  'E': ['111', '100', '111', '100', '111'], 'F': ['111', '100', '111', '100', '100'],
  'G': ['111', '100', '101', '101', '111'], 'H': ['101', '101', '111', '101', '101'],
  'I': ['111', '010', '010', '010', '111'], 'J': ['001', '001', '001', '101', '111'],
  'K': ['101', '101', '110', '101', '101'], 'L': ['100', '100', '100', '100', '111'],
  'M': ['101', '111', '111', '101', '101'], 'N': ['110', '101', '101', '101', '101'],
  'O': ['111', '101', '101', '101', '111'], 'P': ['111', '101', '111', '100', '100'],
  'Q': ['111', '101', '101', '111', '001'], 'R': ['111', '101', '110', '101', '101'],
  'S': ['111', '100', '111', '001', '111'], 'T': ['111', '010', '010', '010', '010'],
  'U': ['101', '101', '101', '101', '111'], 'V': ['101', '101', '101', '101', '010'],
  'W': ['101', '101', '111', '111', '101'], 'X': ['101', '101', '010', '101', '101'],
  'Y': ['101', '101', '010', '010', '010'], 'Z': ['111', '001', '010', '100', '111'],
}

/**
 * Greyscale drawing surface. Pixel values are 0 (off/transparent on the
 * glasses) to 255 (brightest green). Image containers are capped by firmware
 * at 288x144.
 */
export class Canvas {
  readonly width: number
  readonly height: number
  readonly px: Uint8Array
  constructor(width: number, height: number) {
    if (width < 20 || width > 288 || height < 20 || height > 144) {
      throw new Error('image container must be 20..288 x 20..144')
    }
    this.width = width; this.height = height
    this.px = new Uint8Array(width * height)
  }
  clear(v = 0): this { this.px.fill(v); return this }
  set(x: number, y: number, v = 255): this {
    x |= 0; y |= 0
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.px[y * this.width + x] = v
    return this
  }
  rect(x: number, y: number, w: number, h: number, v = 255): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, v)
    return this
  }
  frame(x: number, y: number, w: number, h: number, v = 255): this {
    this.rect(x, y, w, 1, v); this.rect(x, y + h - 1, w, 1, v)
    this.rect(x, y, 1, h, v); this.rect(x + w - 1, y, 1, h, v)
    return this
  }
  line(x0: number, y0: number, x1: number, y1: number, v = 255): this {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
      this.set(x0, y0, v)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) { err += dy; x0 += sx }
      if (e2 <= dx) { err += dx; y0 += sy }
    }
    return this
  }
  circle(cx: number, cy: number, r: number, v = 255, fill = false): this {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = x * x + y * y
      if (fill ? d <= r * r : d <= r * r && d >= (r - 1) * (r - 1)) this.set(cx + x, cy + y, v)
    }
    return this
  }
  /** Tiny 3x5 label font (upper-case, digits, % . : - /). `scale` multiplies. */
  text(x: number, y: number, str: string | number, v = 255, scale = 1): this {
    let cx = x
    for (const ch of String(str).toUpperCase()) {
      const g = FONT[ch] || FONT[' ']
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (g[r][c] === '1') this.rect(cx + c * scale, y + r * scale, scale, scale, v)
      }
      cx += 4 * scale
    }
    return this
  }
  /** Plot a series scaled into the given box. */
  sparkline(values: number[], x: number, y: number, w: number, h: number, v = 255): this {
    if (!values.length) return this
    const min = Math.min(...values), max = Math.max(...values)
    const span = max - min || 1
    let prev: [number, number] | null = null
    values.forEach((val, i) => {
      const px = x + Math.round((i / Math.max(1, values.length - 1)) * (w - 1))
      const py = y + h - 1 - Math.round(((val - min) / span) * (h - 1))
      if (prev) this.line(prev[0], prev[1], px, py, v)
      prev = [px, py]
    })
    return this
  }
  toPng(): Buffer { return encodeGreyPng(this.width, this.height, this.px) }
}
