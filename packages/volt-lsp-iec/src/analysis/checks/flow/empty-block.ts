/**
 * empty-block (C0013 + C0426 · flow/). A control-flow block or CASE arm with an empty body — CODESYS:
 * "At least one statement is expected". Verified live against CODESYS 3.5.21 for empty IF-THEN / ELSIF / ELSE /
 * FOR / WHILE / REPEAT bodies AND empty CASE arms.
 *
 * The CASE-arm case corrects a STALE won't-fix: `1:\n2: stmt` (a label with no body before the next label) is an
 * ERROR — the legal way to share a body across values is a comma list `1, 2: stmt`, NOT separate empty labels.
 * (Re-verified 2026-07-21; the old note claimed empty arms were legal fall-through.)
 *
 * Zero-FP, two guards:
 *   1. A lone `;` parses to an `empty` statement (body length 1), so `IF b THEN ; END_IF` never fires.
 *   2. A COMMENT-only body is legal in CODESYS but strips to zero parsed statements — so when the body is empty we
 *      skip if the block's source span contains a comment marker (conservative: a comment anywhere in the block
 *      suppresses, trading a rare missed error for guaranteed no false positive).
 * CASE `ELSE` is intentionally excluded — an empty CASE `ELSE` is a parse error in CODESYS, not this diagnostic.
 */
import { walkStatements } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import type { Span } from "../../../syntax/span.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

const HAS_COMMENT = /\/\/|\(\*|\/\*/

export function checkEmptyBlock(ctx: CheckContext, out: DiagnosticItem[]): void {
  // `anchor` is where the squiggle goes; `outer` is the enclosing statement span used for the comment guard —
  // a block/branch/arm span ends at its header and does NOT cover the (empty) body region where a comment sits,
  // so the guard must scan the whole enclosing statement (conservative: a comment anywhere in it suppresses).
  const flag = (body: unknown[], anchor: Span, outer: Span) => {
    if (body.length > 0) return
    if (HAS_COMMENT.test(ctx.source.slice(outer.start, outer.end))) return // comment-only body — legal in CODESYS
    out.push({ severity: "error", span: anchor, source: SOURCE, code: "empty-block", message: ctx.messages.emptyStatementBlock() })
  }
  for (const { statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind === "if") {
        for (const b of s.branches) flag(b.body, b.span, s.span)
        if (s.elseBody !== undefined) flag(s.elseBody, s.span, s.span)
      } else if (s.kind === "case") {
        for (const arm of s.arms) flag(arm.body, arm.span, s.span)
      } else if (s.kind === "for" || s.kind === "while" || s.kind === "repeat") {
        flag(s.body, s.span, s.span)
      }
    })
  }
}
