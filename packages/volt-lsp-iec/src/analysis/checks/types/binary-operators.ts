/**
 * binary-operator-type-mismatch (D.2 · types/): `MOD` on a non-integer, and arithmetic mixing BOOL or a string with a
 * numeric. The rule is `rules.binaryOpErrors`, shared with the network-text operand check; this walks every binary node,
 * and every network operator box as the ST operation it is (`ADD(a, b)`: `a + b`).
 */
import { forEachExpr } from "../../../frontend/symbols/index.js"
import type { Expr } from "../../../frontend/syntax/index.js"
import { networkBox, operatorBoxExpr } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import type { DiagnosticItem } from "../../shared/diagnostic-item.js"
import { binaryOpErrors, shortCircuitErrors } from "../../shared/rules.js"

export function checkBinaryOperators(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (x, scope) => {
    const box = x.kind === "call" ? networkBox(x, scope, ctx.project) : undefined
    // an operator box's chain `a + b + c`: each of its operations, left to right
    for (let e: Expr | null | undefined = box === undefined ? x : operatorBoxExpr(box); e?.kind === "binary"; e = box === undefined ? undefined : e.left) {
      out.push(...binaryOpErrors(e, scope, ctx.project, ctx.messages))
      out.push(...shortCircuitErrors(e, scope, ctx.project, ctx.messages))
    }
  })
}
