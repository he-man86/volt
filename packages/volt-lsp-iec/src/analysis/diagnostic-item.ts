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

/**
 * Push a diagnostic about a DECLARATION'S INITIALIZER, as often as the IDE reports it.
 *
 * CODESYS reports such a warning TWICE when the declaration is in a FUNCTION_BLOCK and ONCE when it is in a PROGRAM —
 * measured at every count that could have explained it (conformance `ir_initializer_warning_*`): no instance 0, one
 * instance 2, TWO instances still 2, an instance nested in another FB 2, a PROGRAM 1. So it is not per-instance; an
 * FB's declaration is simply checked twice, once for the type and once for the instance initialisation the compiler
 * generates, and a PROGRAM has only the one. Around 20 fixtures differed from the IDE in nothing but this count.
 */
export function pushForDeclaration(out: DiagnosticItem[], owner: { kind: string }, diagnostic: DiagnosticItem): void {
  out.push(diagnostic)
  if (owner.kind === "function_block") out.push(diagnostic)
}
