/**
 * The diagnostic an analysis produces and the source tag it carries — a leaf the checks, the shared rules and the
 * orchestrator all import without a cycle. It lived in the old `checks/_shared` module (consolidate-lsp-structure C3).
 */
import type { Span } from "../../frontend/syntax/index.js"

export interface DiagnosticItem {
  severity: "error" | "warning" | "information" | "hint"
  span: Span
  source: string
  code: string
  message: string
  /** What the reporting check offers to fix it, from the facts it already resolved — absent when they do not suffice
   *  (openspec lsp-quick-fixes design.md §2). The code-action service only renders these; it re-derives nothing. */
  fixes?: readonly Fix[]
}

/**
 * One quick fix: edits applied together as one WorkspaceEdit. A fix ships only with a recorded AFTER the compiler builds
 * clean (design.md §3, `services/assist/code-actions.test.ts`).
 */
export interface Fix {
  /** "Wrap in TO_INT(…)", "Declare 'x' : INT", "Change to 'counter'" */
  title: string
  edits: readonly FixEdit[]
  /** Only where no OTHER edit builds clean with a different meaning — never on a choice (design.md §3). */
  preferred?: true
  /** Safe to apply with every other `fixAll` fix of the file (design.md §5). */
  fixAll?: true
}

/** One text edit of a fix, in the reporting document: every quick fix is a local edit (design.md §1), so an edit names no
 *  document of its own. */
export interface FixEdit {
  span: Span
  /** The text `span` held when the fix was made. A client may hand back a diagnostic published before its latest edit;
   *  the renderer offers the fix only while the document still holds this text there (`services/assist/code-actions`). */
  replaces: string
  newText: string
}

/** Source tag on every DiagnosticItem this LSP emits. */
export const SOURCE = "volt-lsp-iec"

/** Append one finding — the one helper every check uses instead of a local `push()` of its own (analysis-conformance 1.9). */
export function emit(
  out: DiagnosticItem[],
  span: Span,
  code: string,
  message: string,
  severity: DiagnosticItem["severity"] = "error",
  fixes?: readonly (Fix | undefined)[],
): void {
  out.push(withFixes({ severity, span, source: SOURCE, code, message }, fixes))
}

/** `item` offering `fixes` — the item itself when there are none, so a finding without a fix carries no `fixes` key. */
export function withFixes(item: DiagnosticItem, fixes: readonly (Fix | undefined)[] | undefined): DiagnosticItem {
  const offered = (fixes ?? []).filter((f): f is Fix => f !== undefined)
  return offered.length === 0 ? item : { ...item, fixes: offered }
}

/**
 * The findings with every fix withdrawn that cannot reach a clean build: one whose edit (in the reporting document) holds
 * ANOTHER error inside the text it rewrites. That error survives the edit — `out := -b` is refused for the store and for
 * the operand (`unary_minus_on_bool`), and `out := TO_BOOL(-b)` still carries the operand's — so the fix answers its own
 * finding and leaves the statement broken (design.md §3). Only an edit that KEEPS the text it rewrites (`newText` holds
 * `replaces`, as a wrap does) can carry an error through: one that replaces or removes the text removes the error with it
 * — the uses C0237's rename edits are each "not defined", and the rename is what defines them (`qf_c0237_change`).
 * Run once over a document's findings, after the policy.
 */
export function withdrawBlockedFixes(items: readonly DiagnosticItem[]): DiagnosticItem[] {
  const errors = items.filter((d) => d.severity === "error")
  return items.map((item) => {
    if (item.fixes === undefined) return item
    const blocked = (fix: Fix): boolean =>
      fix.edits.some(
        (e) =>
          e.replaces !== "" &&
          e.newText.includes(e.replaces) &&
          errors.some((d) => d !== item && d.span.start >= e.span.start && d.span.end <= e.span.end && !sameFinding(d, item)),
      )
    const kept = item.fixes.filter((f) => !blocked(f))
    if (kept.length === item.fixes.length) return item
    const { fixes: _withdrawn, ...bare } = item
    return kept.length === 0 ? bare : { ...bare, fixes: kept }
  })
}

/**
 * The same finding reported twice (an FB's initializer — `pushForDeclaration`): not another error. Only that: an error of
 * another code on the same span is another error — `F_R(v := lr + b)` is refused for the operand AND for the argument on
 * the one value span, and `TO_REAL(lr + b)` keeps the operand's. (A rename's follow-on — C0046's "no valid assignment
 * target" on the same name — needs no exemption: a rename replaces the text, so it is never blocked.)
 */
const sameFinding = (a: DiagnosticItem, b: DiagnosticItem): boolean =>
  a.code === b.code && a.message === b.message && a.span.start === b.span.start && a.span.end === b.span.end

/**
 * Push a diagnostic about a DECLARATION'S INITIALIZER, as often as the IDE reports it.
 *
 * CODESYS reports such a warning TWICE when the declaration is in a FUNCTION_BLOCK and ONCE when it is in a PROGRAM —
 * measured at every count that could have explained it (conformance `ir_initializer_warning_*`): no instance 0, one
 * instance 2, TWO instances still 2, an instance nested in another FB 2, a PROGRAM 1. So it is not per-instance; an
 * FB's declaration is simply checked twice, once for the type and once for the instance initialisation the compiler
 * generates, and a PROGRAM has only the one. Around 20 fixtures differed from the IDE in nothing but this count.
 *
 * A VAR CONSTANT is the exception, and it follows from that same explanation: a constant is folded at compile time,
 * not stored on the instance, so there is no instance initialisation to check it a second time (conformance
 * `co_any_to_conversions`, whose `cLimit : DINT := 16#80000000` in an FB warns exactly once).
 */
export function pushForDeclaration(
  out: DiagnosticItem[],
  owner: { kind: string },
  section: { constant?: boolean },
  diagnostic: DiagnosticItem,
): void {
  out.push(diagnostic)
  if (initializerWarnedTwice(owner, section)) out.push(diagnostic)
}

/** Does the IDE say a warning about a declaration's initializer twice — in a FUNCTION_BLOCK, outside VAR CONSTANT? (see
 *  `pushForDeclaration`) */
export function initializerWarnedTwice(owner: { kind: string }, section: { constant?: boolean }): boolean {
  return owner.kind === "function_block" && section.constant !== true
}
