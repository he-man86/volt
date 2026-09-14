/**
 * binary-operator-type-mismatch (D.2 · types/): `MOD` on a non-integer, and arithmetic mixing BOOL or a string with a
 * numeric. The rule is `rules.binaryOpError`, shared with the network-text operand check; this walks every binary node.
 */
import { forEachExpr } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import type { DiagnosticItem } from "../../diagnostic-item.js"
import { binaryOpError } from "../../rules.js"

export function checkBinaryOperators(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e, scope) => {
    if (e.kind !== "binary") return
    const diag = binaryOpError(e, scope, ctx.project, ctx.messages)
    if (diag !== undefined) out.push(diag)
  })
}
