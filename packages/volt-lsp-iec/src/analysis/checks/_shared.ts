/**
 * Shared utilities for the per-check modules under `analysis/checks/`. The underscore marks
 * "internal to the checks tree". `DiagnosticItem` lives here (a leaf) so the orchestrator and every
 * check import it without a cycle.
 */
import type { Span } from "../../syntax/index.js"

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
