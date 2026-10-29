/**
 * empty-block (C0013 + C0426 · flow/). A control-flow block or CASE arm with an empty body — CODESYS:
 * "At least one statement is expected". Verified live against CODESYS 3.5.21 for empty IF-THEN / ELSIF / ELSE /
 * FOR / WHILE / REPEAT bodies AND empty CASE arms.
 *
 * An empty CASE ARM (`1:\n2: stmt`) is a WARNING with the same words: it builds and runs, the arm doing nothing —
 * before another arm, last, and before ELSE (`stmt_case_empty_arm`, `_last`, `_before_else`, both vendors 2026-10-02,
 * `record:exec` too). A note of 2026-07-21 called it an error; the recordings say otherwise. It is no fall-through:
 * a matched empty arm runs nothing (the comma list `1, 2: stmt` shares a body).
 *
 * Zero-FP, two guards:
 *   1. A lone `;` parses to an `empty` statement (body length 1), so `IF b THEN ; END_IF` never fires.
 *   2. A COMMENT-only body is legal in CODESYS but strips to zero parsed statements — so when the body is empty we
 *      skip if the block's source span contains a comment marker (conservative: a comment anywhere in the block
 *      suppresses, trading a rare missed error for guaranteed no false positive).
 * CASE `ELSE` is intentionally excluded — an empty CASE `ELSE` is a parse error in CODESYS, not this diagnostic.
 */
import { lineBreakOf, lineStartOf, walkStatements } from "../../../frontend/syntax/index.js"
import { bodies } from "../../../frontend/symbols/index.js"
import type { Span, Statement } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { emit, type DiagnosticItem, type Fix } from "../../shared/diagnostic-item.js"
import { findWord, fixOf, insertText } from "../../shared/fixes.js"

const HAS_COMMENT = /\/\/|\(\*|\/\*/

export function checkEmptyBlock(ctx: CheckContext, out: DiagnosticItem[]): void {
  // `anchor` is where the squiggle goes; `outer` is the enclosing statement span used for the comment guard —
  // a block/branch/arm span ends at its header and does NOT cover the (empty) body region where a comment sits,
  // so the guard must scan the whole enclosing statement (conservative: a comment anywhere in it suppresses).
  const flag = (body: unknown[], anchor: Span, outer: Span, severity: "error" | "warning" = "error", header?: number) => {
    if (body.length > 0) return
    if (HAS_COMMENT.test(ctx.source.slice(outer.start, outer.end))) return // comment-only body — legal in CODESYS
    emit(
      out,
      anchor,
      "empty-block",
      ctx.messages.emptyStatementBlock(),
      severity,
      [
        header === undefined ? undefined : emptyStatementFix(ctx.source, header),
      ],
    )
  }
  // where a block's header ends — the keyword its (empty) list follows: THEN after a branch's condition, DO after a FOR's
  // or a WHILE's header, the REPEAT keyword itself
  const after = (from: number, to: number, word: string): number | undefined => findWord(ctx.source, from, to, word)?.end
  for (const { statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind === "if") {
        for (const b of s.branches) flag(b.body, b.span, s.span, "error", after(b.cond.span.end, s.span.end, "THEN"))
        // an empty ELSE is said AT the ELSE, on its own line: anchored at the IF, TwinCAT's one-message-per-line policy
        // folded it into the empty THEN's (`cc3_empty_and_noop`, TwinCAT; analysis-conformance 3.9)
        // (the keyword is looked up only for an EMPTY ELSE: a token scan per IF was O(IFs × tokens) per file — gate 3.7+3.9)
        if (s.elseBody !== undefined && s.elseBody.length === 0) {
          const keyword = elseKeyword(ctx, s)
          flag(s.elseBody, keyword ?? s.span, s.span, "error", keyword?.end)
        }
      } else if (s.kind === "case") {
        for (const arm of s.arms) flag(arm.body, arm.span, s.span, "warning")
      } else if (s.kind === "for") {
        flag(s.body, s.span, s.span, "error", after((s.by ?? s.to).span.end, s.span.end, "DO"))
      } else if (s.kind === "while") {
        flag(s.body, s.span, s.span, "error", after(s.cond.span.end, s.span.end, "DO"))
      } else if (s.kind === "repeat") {
        flag(s.body, s.span, s.span, "error", after(s.span.start, s.span.end, "REPEAT"))
      }
    })
  }
}

/**
 * "Insert the empty statement ';'" (design.md §4 F9, `qf_c0013_insert`): `;` as the block's one statement, on the line
 * after its header (one tab deeper than the header's line), or after the header where more text shares its line. It is
 * what the block says when it means to do nothing (`preferred`).
 */
function emptyStatementFix(source: string, header: number): Fix {
  // the header ends its line when only blanks and a line end follow it — any line end (`lineStartOf`'s, a lone CR too)
  const rest = /^[ \t]*(\r\n|\r|\n)/.exec(source.slice(header))
  if (rest === null) return fixOf("Insert the empty statement ';'", [insertText(source, header, " ;")], true)
  const indent = /^[ \t]*/.exec(source.slice(lineStartOf(source, header)))![0]
  return fixOf("Insert the empty statement ';'", [insertText(source, header + rest[0].length, `${indent}\t;${lineBreakOf(source)}`)], true)
}

/** The span of an IF's ELSE keyword: the last ELSE token after its last branch, before its end. */
function elseKeyword(ctx: CheckContext, s: Extract<Statement, { kind: "if" }>): Span | undefined {
  const last = s.branches[s.branches.length - 1]
  const from = Math.max(last?.span.end ?? s.span.start, ...(last?.body ?? []).map((st: Statement) => st.span.end))
  const elses = ctx.tokens().filter((t) => t.kind === "keyword" && t.text.toUpperCase() === "ELSE" && t.span.start >= from && t.span.end <= s.span.end)
  return elses[elses.length - 1]?.span
}
