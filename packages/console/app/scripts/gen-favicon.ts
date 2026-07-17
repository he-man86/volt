// Generate every rasterized/standalone form of the Volt mark from ONE source — zero deps.
// Emits: public/volt-mark.svg (the favicon) + the opaque brand PNGs (apple-touch, PWA manifest).
// The mark is a single straight-line polygon, so a scanline fill is all it takes.
//
// The geometry and colours come from src/component/volt-mark-path.ts, which the VoltMark component also reads —
// so the header/404 mark, the favicon and the PNGs cannot disagree. They used to be three hand-maintained copies,
// and they did drift: the brand port moved --color-accent to #f54e00 and left the svg + this script on #d97706.
// Re-run after changing volt-mark-path.ts: `bun scripts/gen-favicon.ts`.
import { deflateSync } from "node:zlib"
import { writeFileSync } from "node:fs"
import { MARK_BG, MARK_FG, MARK_PATH, MARK_VIEWBOX, markPolygon } from "../src/component/volt-mark-path"

const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

const POLY = markPolygon()
const VB = MARK_VIEWBOX
const BG = hex(MARK_BG)
const FG = hex(MARK_FG)

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

// The favicon itself (ui.tsx links it, and it is the one form that ships as a standalone file rather than inline).
// Generated from the same source as the component and the rasters below — this is what stops the three drifting.
writeFileSync(
  new URL("volt-mark.svg", dir),
  `<svg width="${VB.w * 5}" height="${VB.h * 5}" viewBox="0 0 ${VB.w} ${VB.h}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="${MARK_PATH}" fill="${MARK_FG}"></path>
</svg>
`,
)
console.log("wrote volt-mark.svg")

for (const [name, size] of [
  ["apple-touch-icon.png", 180],
  ["web-app-manifest-192x192.png", 192],
  ["web-app-manifest-512x512.png", 512],
] as const) {
  writeFileSync(new URL(name, dir), render(size))
  console.log("wrote", name, size)
}
