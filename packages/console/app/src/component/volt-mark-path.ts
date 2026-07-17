// VOLT: the mark's geometry and brand colours — the SINGLE source for every place it is drawn.
//
// There are three consumers and they used to each carry their own copy: this shape lived in `volt-mark.tsx`, again
// in `public/volt-mark.svg`, and a third time as a coordinate array in `scripts/gen-favicon.ts`. That drifts
// silently and already did: the volt-www brand port changed --color-accent to #f54e00 and the mark + every favicon
// stayed on the old #d97706, because nothing connected them. Now `gen-favicon.ts` GENERATES the svg and the pngs
// from this file, and the component reads it directly — change the mark here and every surface follows.
//
// Plain .ts on purpose (no JSX): `scripts/gen-favicon.ts` imports it, and that script must stay dependency-free.

/** The mark in its 24×28 viewBox. All-straight-line path (`M`/`L` + `Z`), which is what lets the rasterizer fill it. */
export const MARK_PATH = "M14 1 L4 15 L11 15 L9 27 L20 11 L13 11 L14 1 Z"

export const MARK_VIEWBOX = { w: 24, h: 28 }

/** Brand colours, mirroring style/volt-theme.css (which is itself the port of volt-www's tokens). */
export const MARK_FG = "#f54e00" // --color-accent
export const MARK_BG = "#f7f7f4" // --color-bg

/** `MARK_PATH` as polygon points, for the rasterizer. Throws rather than mis-drawing if the path stops being all-L. */
export function markPolygon(): [number, number][] {
  const body = MARK_PATH.trim().replace(/\s*Z\s*$/i, "")
  return body.split(/(?=[ML])/i).map((seg) => {
    const [x, y] = seg.slice(1).trim().split(/[\s,]+/).map(Number)
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`volt-mark: unsupported path segment "${seg}"`)
    return [x, y] as [number, number]
  })
}
