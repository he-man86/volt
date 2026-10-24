/**
 * How a build diagnostic is stated, once, for both shells — the same text `volt build` prints (`Program.Where`).
 * Node-free (types only).
 *
 * `line` is a line of the item's file (wire-final-shape 3.6b: the bridge places the vendor's line in the fetched text),
 * so the position is `name:line[:column]`, as a compiler prints it; a diagnostic inside a method/action/property names
 * that child as `member`, printed after the position.
 */
import type { BuildDiagnostic } from "../bridge/actions.js"

/** `FB_Motor.pou:51:2 (Execute) ` — the location prefix, empty when the diagnostic names no item. The position rides on
 *  the NAME (a line with no item reads as a truncated path), a column appears only with a line, and the member follows. */
export function buildDiagnosticWhere(d: BuildDiagnostic): string {
  if (!d.name) return ""
  const at = d.line ? `${d.name}:${d.line}${d.column ? `:${d.column}` : ""}` : d.name
  return d.member ? `${at} (${d.member}) ` : `${at} `
}

/** One line for a build diagnostic: position, the vendor's code, the message. Severity is the shell's to show. */
export function describeBuildDiagnostic(d: BuildDiagnostic): string {
  return `${buildDiagnosticWhere(d)}${d.code ? `${d.code}: ` : ""}${d.message}`
}
