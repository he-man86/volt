/**
 * A `-` or `NOT`'s operand converted into the type it computes in, reported — the rule `checks/types/unary-operand.ts`
 * measures, shared with a network's negated output (`X_INVERTED =>` is `NOT` on that output: `ng_ot_inverted_time_output`).
 */
import type { Expr } from "../../frontend/syntax/index.js"
import type { Scope } from "../../frontend/symbols/index.js"
import { elemOf, inferExprType, renderType, unaryOperandConversion } from "../../frontend/types/index.js"
import type { Messages } from "../messages/index.js"
import { emit, type DiagnosticItem } from "./diagnostic-item.js"

export function unaryOperandError(x: Expr, scope: Scope, project: Scope, messages: Messages, out: DiagnosticItem[]): void {
  if (x.kind !== "unary" || (x.op !== "-" && x.op !== "NOT")) return
  const operand = inferExprType(x.operand, scope, project)
  const elem = elemOf(operand)
  if (elem === undefined) return // unresolved or composite → skip (zero-FP)
  // The operand converts into the type the operator computes in — the expression's own type — except that `NOT`
  // on a REAL or a STRING has no integer to name and says `ANY_BIT` (`unaryOperandConversion`).
  const conversion = unaryOperandConversion(x.op, elem.family)
  if (conversion === "none") return
  const target = conversion === "ANY_BIT" ? "ANY_BIT" : renderType(inferExprType(x, scope, project), { form: "compiler" })
  emit(out, x.span, "unary-operand-type", messages.cannotConvert(renderType(operand, { form: "compiler" }), target))
}
