/**
 * no-op-statement (C0139 · flow/). A WARNING for an expression statement with no side effect (`i;`) — a bare
 * reference / member / index whose value is computed and discarded.
 *
 * Zero-FP: a genuine call is a `call_stmt`, not an `expr_stmt`; an `expr_stmt` whose expression tree contains
 * ANY call (`foo().x;`) is skipped (the call may have effects); and the expression must RESOLVE to a known type
 * — an unresolved bare name (gibberish, or code inside a stripped `{IF defined(…)}` branch the IDE never
 * compiles) is not a "no effect" case (CODESYS reports it as undefined, or strips it), so it must not fire here.
 */
import { isStBody, parseStatements, unitBodies, walkStatements, walkExpr } from "../../../frontend/syntax/index.js"
import { bodies } from "../../../frontend/symbols/index.js"
import { inferExprType } from "../../../frontend/types/index.js"
import type { Expr, Statement } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkNoOpStatement(ctx: CheckContext, out: DiagnosticItem[]): void {
  const warn = (s: Extract<Statement, { kind: "expr_stmt" }>): void => {
    out.push({
      severity: "warning",
      span: s.expr.span,
      source: SOURCE,
      // Mirror the IDE: it echoes the whole statement source (incl. the `;`), not just the expression — and the
      // LINE BREAK that ends it, which is in the recorded message (conformance `cc5_no_op_statement`).
      code: "no-op-statement",
      message: ctx.messages.codeHasNoEffect(withLineEnd(ctx.source, s.span.start, s.span.end)),
    })
  }
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "expr_stmt" || containsCall(s.expr)) return
      if (inferExprType(s.expr, scope, ctx.project).kind === "unknown") return // unresolved → not a no-op (see header)
      warn(s)
    })
  }
  // A statement the parser RESUMED at after a refused token (`ExprStatement.resumed`: `NS;` in `t := T#5NS;`) is warned
  // although nothing resolves it — the body did not parse, so the vendor resolves nothing in it and warns all the same
  // (`cc_time_nanosecond_literal`, `lit_bool_typed_true`). Only such a body holds one, and `bodies()` skips it.
  for (const unit of ctx.parseResult.units)
    for (const body of unitBodies(unit)) {
      if (!isStBody(body)) continue
      const parsed = parseStatements(body)
      if (parsed.ok) continue
      walkStatements(parsed.statements, (s) => {
        if (s.kind === "expr_stmt" && s.resumed && !containsCall(s.expr)) warn(s)
      })
    }
}

/**
 * The statement's source, plus the line break that ends its line — what the IDE quotes, in the document's OWN
 * spelling: a CRLF file (which is what CODESYS stores, so what the recording shows) quotes `\r\n`.
 */
function withLineEnd(source: string, start: number, end: number): string {
  const tail = source.slice(end)
  const upTo = tail.search(/\S/)
  const gap = upTo < 0 ? tail : tail.slice(0, upTo)
  const br = /\r?\n/.exec(gap)
  return source.slice(start, end) + (br?.[0] ?? "")
}

function containsCall(e: Expr): boolean {
  let found = false
  walkExpr(e, (x) => {
    if (x.kind === "call") found = true
  })
  return found
}
