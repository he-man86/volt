/**
 * unknown-source (types/). The IDE's error PROPAGATION: once it cannot type an expression it does not fall silent, it
 * carries the hole along and reports what the hole broke. Two shapes, both measured (conformance `cc_unknown_member`,
 * `cc_vg_undeclared`, `deref_on_array_type`, `cc5_at_address_not_direct`, `cc3_multiple_inheritance`,
 * `cc2_indexing_and_arity`, `cc_self_this_in_program`):
 *
 *   - an assignment whose SOURCE has no type →  Cannot convert type 'Unknown type: 'p.nope'' to type 'INT'
 *   - an assignment whose TARGET has none    →  'THIS^.x' is no valid assignment target
 *   - a member read off a BASE that has none →  'THIS^' is no structured variable
 *   - an OPERAND of an operator that has none →  Unknown type: 'two'
 *
 * Zero-FP rests entirely on `analysis/hole` — see it for WHY the LSP's "unknown" is not the IDE's. This check runs
 * LAST and adds nothing on its own evidence: every message needs an earlier check to have named the failure.
 *
 * Deliberately not a resolution failure: `array-index-count` and `pointer-index-arity`. `grid[1]` on a 2-D array is a
 * wrong arity, not a lost type, and the IDE carries no hole out of it (`cc2_indexing_and_arity` records the arity
 * errors with no conversion error beside them, while `plain[1]` — indexing a scalar — gets one).
 *
 * CODESYS-only: TwinCAT is unmeasured, and a guess there would be a new false positive.
 */
import { compilerExprText } from "../../expr-echo.js"
import { isHole, reported } from "../../hole.js"
import { stmtExprs, walkExpr, walkStatements, type Expr } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { inferExprType, renderType } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkUnknownSource(ctx: CheckContext, out: DiagnosticItem[]): void {
  const seen = reported(out)
  /** The type an operation meets at, for the compiler's typed echo of a bare integer literal inside it. */
  const metType = (scope: Parameters<typeof inferExprType>[1]) => (e: Expr): string | undefined => {
    const t = inferExprType(e, scope, ctx.project)
    return t.kind === "elementary" ? t.name : undefined
  }
  const push = (message: string, e: Expr): void => {
    out.push({ severity: "error", span: e.span, source: SOURCE, code: "unknown-source", message })
  }
  const hole = (e: Expr, scope: Parameters<typeof inferExprType>[1]): boolean => isHole(e, scope, ctx.project, seen)

  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind === "assign" && s.op === undefined) {
        const target = inferExprType(s.target, scope, ctx.project)
        // a hole on the LEFT is not a conversion at all — there is nothing to convert INTO, and the IDE says so
        if (hole(s.target, scope)) push(ctx.messages.notAssignmentTarget(compilerExprText(s.target, metType(scope))), s.target)
        else if (target.kind !== "unknown" && hole(s.value, scope))
          push(ctx.messages.cannotConvert(ctx.messages.unknownType(compilerExprText(s.value, metType(scope))), renderType(target)), s.value)
      }
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          if (x.kind === "member" && hole(x.base, scope)) push(ctx.messages.notStructuredVariable(compilerExprText(x.base, metType(scope))), x.base)
          if (x.kind !== "binary") return
          for (const operand of [x.left, x.right]) if (hole(operand, scope)) push(ctx.messages.unknownType(compilerExprText(operand, metType(scope))), operand)
        })
    })
  }
}
