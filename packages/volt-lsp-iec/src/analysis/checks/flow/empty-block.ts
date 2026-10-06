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
import { walkStatements } from "../../../frontend/syntax/index.js"
import { bodies } from "../../../frontend/symbols/index.js"
import type { Span, Statement } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

const HAS_COMMENT = /\/\/|\(\*|\/\*/

export function checkEmptyBlock(ctx: CheckContext, out: DiagnosticItem[]): void {
  // `anchor` is where the squiggle goes; `outer` is the enclosing statement span used for the comment guard —
  // a block/branch/arm span ends at its header and does NOT cover the (empty) body region where a comment sits,
  // so the guard must scan the whole enclosing statement (conservative: a comment anywhere in it suppresses).
  const flag = (body: unknown[], anchor: Span, outer: Span, severity: "error" | "warning" = "error") => {
    if (body.length > 0) return
    if (HAS_COMMENT.test(ctx.source.slice(outer.start, outer.end))) return // comment-only body — legal in CODESYS
    out.push({ severity, span: anchor, source: SOURCE, code: "empty-block", message: ctx.messages.emptyStatementBlock() })
  }
  for (const { statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind === "if") {
        for (const b of s.branches) flag(b.body, b.span, s.span)
        // an empty ELSE is said AT the ELSE, on its own line: anchored at the IF, TwinCAT's one-message-per-line policy
        // folded it into the empty THEN's (`cc3_empty_and_noop`, TwinCAT; analysis-conformance 3.9)
        // (the keyword is looked up only for an EMPTY ELSE: a token scan per IF was O(IFs × tokens) per file — gate 3.7+3.9)
        if (s.elseBody !== undefined && s.elseBody.length === 0) flag(s.elseBody, elseKeyword(ctx, s) ?? s.span, s.span)
      } else if (s.kind === "case") {
        for (const arm of s.arms) flag(arm.body, arm.span, s.span, "warning")
      } else if (s.kind === "for" || s.kind === "while" || s.kind === "repeat") {
        flag(s.body, s.span, s.span)
      }
    })
  }
}

/** The span of an IF's ELSE keyword: the last ELSE token after its last branch, before its end. */
function elseKeyword(ctx: CheckContext, s: Extract<Statement, { kind: "if" }>): Span | undefined {
  const last = s.branches[s.branches.length - 1]
  const from = Math.max(last?.span.end ?? s.span.start, ...(last?.body ?? []).map((st: Statement) => st.span.end))
  const elses = ctx.tokens().filter((t) => t.kind === "keyword" && t.text.toUpperCase() === "ELSE" && t.span.start >= from && t.span.end <= s.span.end)
  return elses[elses.length - 1]?.span
}
