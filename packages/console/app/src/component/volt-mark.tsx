import type { JSX } from "solid-js"
import { MARK_PATH, MARK_VIEWBOX } from "./volt-mark-path"

// VOLT: Volt's mark, inline so it inherits `currentColor`.
//
// Volt-added rather than a new export in component/icon.tsx: that barrel is vendored opencode source with nine
// importers, and the audit's rule is to repoint consumers instead of editing shared vendored files. It replaces
// opencode's IconWorkspaceLogo (the square-with-a-hole mark) in the authed header and on the 404 page.
//
// Inline, not <img src="/volt-mark.svg">, for the same reason opencode's was inline: currentColor. The header
// styles it with `color: var(--color-text)` and the 404 inherits the page colour, so one component reads correctly
// in light and dark. An <img> would pin it to the file's own fill and go invisible in one of the two.
//
// The geometry comes from ./volt-mark-path, the single source `scripts/gen-favicon.ts` also generates
// public/volt-mark.svg (the favicon) and the brand PNGs from — so the mark cannot drift between surfaces again.
export function VoltMark(props: JSX.SvgSVGAttributes<SVGSVGElement>) {
  return (
    <svg
      width={MARK_VIEWBOX.w}
      height={MARK_VIEWBOX.h}
      viewBox={`0 0 ${MARK_VIEWBOX.w} ${MARK_VIEWBOX.h}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d={MARK_PATH} fill="currentColor" />
    </svg>
  )
}
