/** What lowering answers with: one POU's IR, or the refusals that say why it could not — each with its taxonomy. */
import type { Span } from "../../../frontend/syntax/index.js"
import type { IrPou } from "../../ir/index.js"
import { type LowerCodeKind, lowerCodeKind } from "./codes.js"

/**
 * A construct the lowering could not represent. Lowering is TOTAL — it never throws — so an untestable POU
 * is reported, never silently wrong, and `scripts/lower-completeness.ts` can measure coverage over the corpus.
 */
export interface LowerDiagnostic {
  /** Stable slug for the blocking construct — what the coverage report groups by. */
  code: string
  /**
   * WHAT THE REFUSAL ASKS OF THE PERSON WHO HIT IT — `invalid` (fix your ST), `not-modelled` (valid, not built
   * yet), `not-measured` (valid and compiles, behaviour unrecorded so it is not guessed).
   *
   * `index.ts` declares this three-way split as the whole refusal taxonomy and nothing carried it, so every
   * refusal reached a user as an undifferentiated slug — and those three ask for completely different things.
   * It is resolved from `codes.ts` inside `bail`/`fail` rather than passed at each call site, because a
   * field 98 call sites each have to remember is a field that will disagree with itself.
   */
  kind: LowerCodeKind
  message: string
  span: Span
}

export interface LoweredPou {
  /** Present only when the POU lowered with no diagnostics. */
  pou?: IrPou
  diagnostics: readonly LowerDiagnostic[]
}

/**
 * A refusal, with its taxonomy filled in from the registry.
 *
 * Every `LowerDiagnostic` in the transpiler is built here or by `Lowering.bail`, which calls the same lookup.
 * That is the whole point: `kind` answers a question the user asks ("is this my bug or yours?"), and a field
 * assembled independently at a hundred call sites answers it a hundred slightly different ways.
 */
export function lowerDiagnostic(code: string, message: string, span: Span): LowerDiagnostic {
  return { code, kind: lowerCodeKind(code) ?? "unclassified", message, span }
}
