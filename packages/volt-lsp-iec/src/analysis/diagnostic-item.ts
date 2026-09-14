/**
 * The diagnostic an analysis produces and the source tag it carries — a leaf the checks, the shared rules and the
 * orchestrator all import without a cycle. It lived in `checks/_shared.ts` (consolidate-lsp-structure C3).
 */
import type { Span } from "../syntax/index.js"

export interface DiagnosticItem {
  severity: "error" | "warning" | "information" | "hint"
  span: Span
  source: string
  code: string
  message: string
}

/** Source tag on every DiagnosticItem this LSP emits. */
export const SOURCE = "volt-lsp-iec"
