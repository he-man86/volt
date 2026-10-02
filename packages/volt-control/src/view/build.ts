/**
 * How a build diagnostic is stated, once, for both shells — the same text `volt build` prints (`Program.Where`).
 * Node-free (types only).
 *
 * The two shells each built `name:line` themselves and ignored `member`. That was harmless while no diagnostic named
 * a member; since openspec `codesys-diagnostic-child-names` a diagnostic inside a method/action/property names the
 * PARENT item and carries the child as `member`, and on TwinCAT its `line` is counted inside that member (DIALECT
 * D36). Printed bare, `FB_Motor.pou:6` sends the engineer to the wrong line of the right file.
 *
 * Neither shell navigates to a build diagnostic (they print it); a future "go to" must treat `line` as a position
 * only together with `member`, never as a line of the item's file.
 */
import type { BuildDiagnostic } from "../bridge/actions.js"

/** `FB_Motor.pou(Execute):6:2 ` — the location prefix, empty when the diagnostic names no item. The position rides on
 *  the NAME (a line with no item reads as a truncated path), the member sits between them because it is the frame of
 *  the line, and a column appears only with a line. */
export function buildDiagnosticWhere(d: BuildDiagnostic): string {
  if (!d.name) return ""
  const name = d.member ? `${d.name}(${d.member})` : d.name
  if (!d.line) return `${name} `
  return `${name}:${d.line}${d.column ? `:${d.column}` : ""} `
}

/** One line for a build diagnostic: position, the vendor's code, the message. Severity is the shell's to show. */
export function describeBuildDiagnostic(d: BuildDiagnostic): string {
  return `${buildDiagnosticWhere(d)}${d.code ? `${d.code}: ` : ""}${d.message}`
}
