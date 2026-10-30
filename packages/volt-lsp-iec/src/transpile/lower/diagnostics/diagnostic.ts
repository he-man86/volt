/** What lowering answers with: one POU's IR, or the refusals that say why it could not — each with its taxonomy. */
import type { Span } from "../../../frontend/syntax/index.js"
import type { IrPou } from "../../ir/index.js"
import { emittedKind, type LowerCodeKind } from "./codes.js"
import { LoweringBug } from "../../semantics/faults.js"

/**
 * A construct the lowering could not represent. Lowering is TOTAL on its input — any ST answers an IR or refusals,
 * never a throw — so an untestable POU is reported, never silently wrong, and `scripts/lower-completeness.ts` can
 * measure coverage over the corpus. It throws only on a bug of its own: `LoweringBug` (`semantics/faults.ts`), e.g. a
 * refusal code `codes.ts` does not register (`emittedKind`, task 1.7.16).
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
  /** THE FILE `span` IS IN (openspec `lowering-diagnostic-uri`) — the main source, a sibling POU, a GVL, a library: the
   *  file that holds the cause. A span alone names no file, and a program lowered from several cannot be read without it. */
  uri: string
}

/** The 1-based line the offset `at` stands on in `source` — a line ends at CR LF, LF or a lone CR, as the lexer reads it
 *  (the `*_cr` fixtures end their lines with a CR alone). */
const lineAt = (source: string, at: number): number => source.slice(0, at).split(/\r\n|\r|\n/).length

/**
 * EACH DIAGNOSTIC THAT IS NOT WHERE IT SAYS (openspec `lowering-diagnostic-uri`), said by name: its uri is none of `sources`
 * (the lowering's files' text, by uri), or its span is not a span of that file — outside it, or its start on another line
 * than the span says. A span carried over from another file (a callee's refusal at the call site, a GVL's at the POU)
 * almost never lands on a consistent line of the file named. Asked of every `lowerSource` answer and of every corpus POU.
 */
export function misplaced(diagnostics: readonly LowerDiagnostic[], sources: (uri: string) => string | undefined): string[] {
  return diagnostics.flatMap((d) => {
    const source = sources(d.uri)
    if (source === undefined) return [`${d.code}: ${d.uri} is none of the lowering's files`]
    const { start, end, startLine } = d.span
    if (start > end || end > source.length) return [`${d.code}: ${start}..${end} is outside ${d.uri} (${source.length} characters)`]
    const line = lineAt(source, start)
    return line === startLine ? [] : [`${d.code}: offset ${start} is on line ${line} of ${d.uri}, the span says ${startLine}`]
  })
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
export function lowerDiagnostic(code: string, message: string, span: Span, uri: string | undefined): LowerDiagnostic {
  // a refusal in no file is a lowering made without one — a bug of lowering's, never a diagnostic with its file left out
  if (uri === undefined) throw new LoweringBug(`${code} ("${message}") was refused by a lowering that names no file`)
  return { code, kind: emittedKind(code), message, span, uri }
}
