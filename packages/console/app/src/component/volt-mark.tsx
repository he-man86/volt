import type { JSX } from "solid-js"

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
// The public/volt-mark.svg file still exists and is still the favicon (ui.tsx) — same geometry, but it is a
// standalone asset, so it carries the accent colour literally.
export function VoltMark(props: JSX.SvgSVGAttributes<SVGSVGElement>) {
  return (
    <svg width="24" height="28" viewBox="0 0 24 28" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M14 1 L4 15 L11 15 L9 27 L20 11 L13 11 L14 1 Z" fill="currentColor" />
    </svg>
  )
}
