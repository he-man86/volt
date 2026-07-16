// Rasterize the Volt mark (public/volt-mark.svg) to opaque brand PNGs — zero deps.
// The mark is a single straight-line polygon, so a scanline fill is all it takes.
// Re-run if volt-mark.svg or the brand colors change: `bun scripts/gen-favicon.ts`.
import { deflateSync } from "node:zlib"
import { writeFileSync } from "node:fs"

// volt-mark.svg path in its 24x28 viewBox (all L commands → one closed polygon).
const POLY: [number, number][] = [
  [14, 1], [4, 15], [11, 15], [9, 27], [20, 11], [13, 11], [14, 1],
]
const VB = { w: 24, h: 28 }
const BG = [0xf7, 0xf6, 0xf3] // --color-bg
const FG = [0xd9, 0x77, 0x06] // --color-accent

function render(size: number): Buffer {
  // Fit the mark into the center with 18% padding (iOS/PWA safe zone).
  const pad = size * 0.18
  const box = size - pad * 2
  const scale = Math.min(box / VB.w, box / VB.h)
  const offX = (size - VB.w * scale) / 2
  const offY = (size - VB.h * scale) / 2
  const pts = POLY.map(([x, y]) => [x * scale + offX, y * scale + offY] as [number, number])

  const px = Buffer.alloc(size * size * 3)
  for (let i = 0; i < size * size; i++) px.set(BG, i * 3)

  // 4x supersampled coverage for smooth edges.
  const SS = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++)
          if (inside(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, pts)) hits++
      if (hits === 0) continue
      const a = hits / (SS * SS)
      const o = (y * size + x) * 3
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(FG[c] * a + px[o + c] * (1 - a))
    }
  }
  return encodePNG(size, size, px)
}

// even-odd point-in-polygon
function inside(x: number, y: number, pts: [number, number][]): boolean {
  let win = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) win = !win
  }
  return win
}

function encodePNG(w: number, h: number, rgb: Buffer): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  // raw scanlines, filter byte 0 per row
  const raw = Buffer.alloc(h * (w * 3 + 1))
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
  const idat = deflateSync(raw)
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))])
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0, 0)
  return Buffer.concat([len, body, crc])
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const dir = new URL("../public/", import.meta.url)
for (const [name, size] of [
  ["apple-touch-icon.png", 180],
  ["web-app-manifest-192x192.png", 192],
  ["web-app-manifest-512x512.png", 512],
] as const) {
  writeFileSync(new URL(name, dir), render(size))
  console.log("wrote", name, size)
}
