/**
 * no-op-statement (C0139 · flow/). A WARNING for an expression statement with no side effect (`i;`) — a bare
 * reference / member / index whose value is computed and discarded.
 *
 * Zero-FP: a genuine call is a `call_stmt`, not an `expr_stmt`; an `expr_stmt` whose expression tree contains
 * ANY call (`foo().x;`) is skipped (the call may have effects); and the expression must RESOLVE to a known type
 * — an unresolved bare name (gibberish, or code inside a stripped `{IF defined(…)}` branch the IDE never
 * compiles) is not a "no effect" case (CODESYS reports it as undefined, or strips it), so it must not fire here.
 */
import { walkStatements, walkExpr } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { inferExprType } from "../../../types/index.js"
import type { Expr } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkNoOpStatement(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "expr_stmt" || containsCall(s.expr)) return
      if (inferExprType(s.expr, scope, ctx.project).kind === "unknown") return // unresolved → not a no-op (see header)
      out.push({
        severity: "warning",
        span: s.expr.span,
        source: SOURCE,
        // Mirror the IDE: it echoes the whole statement source (incl. the `;`), not just the expression.
        code: "no-op-statement",
        message: ctx.messages.codeHasNoEffect(ctx.source.slice(s.span.start, s.span.end)),
      })
    })
  }
}

function containsCall(e: Expr): boolean {
  let found = false
  walkExpr(e, (x) => {
    if (x.kind === "call") found = true
  })
  return found
}
