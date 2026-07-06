/**
 * Shared utilities for the per-check modules under `analysis/checks/`. The underscore marks
 * "internal to the checks tree". `DiagnosticItem` lives here (a leaf) so the orchestrator and every
 * check import it without a cycle.
 */
import { isGraphicalBody, type BodySpan, type Span, type TopLevel } from "../../syntax/index.js"
import type { Scope } from "../../symbols/index.js"

export interface DiagnosticItem {
  severity: "error" | "warning" | "information" | "hint"
  span: Span
  source: string
  code: string
  message: string
}

/** Source tag on every DiagnosticItem this LSP emits. */
export const SOURCE = "volt-lsp-iec"

/**
 * True when a symbol comes from a referenced-library SIGNATURE (a `Library Manager` folder), not
 * project source. Library signatures flatten member sections, so section-keyed checks must skip them.
 */
export function isLibrarySymbol(sym: { uri: string }): boolean {
  return sym.uri.includes("Library Manager")
}

export function getUnitName(unit: TopLevel): { text: string; span: Span } | undefined {
  switch (unit.kind) {
    case "function_block":
    case "program":
    case "function":
    case "method":
    case "action":
    case "property":
    case "interface":
    case "type_decl":
      return { text: unit.name.text, span: unit.name.span }
    default:
      return undefined
  }
}

/** The ST statement body of a unit (POU body only; graphical bodies excluded), or undefined. */
export function getBody(unit: TopLevel): BodySpan | undefined {
  const body = getAnyBody(unit)
  return body !== undefined && !isGraphicalBody(body) ? body : undefined
}

/** The single POU statement body of a unit regardless of sublanguage (no property accessors). */
export function getAnyBody(unit: TopLevel): BodySpan | undefined {
  switch (unit.kind) {
    case "function_block":
    case "program":
    case "function":
    case "method":
    case "action":
      return unit.body
    default:
      return undefined
  }
}

// Scope-for-unit and scope-by-name are pure scope navigation — their home is `symbols/scope-nav`
// (Layer B). Re-exported here so the checks keep a stable `_shared` import.
export { scopeForUnit as findScopeForUnit, findScopeByName } from "../../symbols/index.js"
