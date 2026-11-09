/**
 * A NETWORK BOX'S OWN STORES, checked as ST checks the same operation (`call-arguments.ts` runs them on each box): a
 * function's value through `OUT => v`, an edge's value into its BOOL CLK, an output stored negated.
 */
import { UNNAMED, type CallExpr, type Expr, type MemberExpr } from "../../../frontend/syntax/index.js"
import type { Scope } from "../../../frontend/symbols/index.js"
import { elementaryRef, inferExprType, isNetworkBox, VALUE, type NetworkBox } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import type { DiagnosticItem } from "../../shared/diagnostic-item.js"
import { storeConversionError } from "../../shared/rules.js"
import { unaryOperandError } from "../../shared/unary-operand.js"
import { storeTypeError } from "./_argument-types.js"

/** A function's or an operator's value stored through `OUT => v` (`MOVE(EN := c, i, OUT => u)`): the store converts as an
 *  assignment does, the warning included (box-states#1119-1126). A marked store and the unnamed `???` are other checks'. */
export function checkValueStore(box: NetworkBox, scope: Scope, ctx: CheckContext, out: DiagnosticItem[]): void {
  if (box.instance !== undefined || box.signature?.shape !== "function") return
  const pin = box.pins.find((a) => a.output && a.coil === undefined && a.param?.name.toUpperCase() === VALUE)
  if (pin?.value === undefined || (pin.value.kind === "ident_expr" && pin.value.name === UNNAMED)) return
  const read: MemberExpr = { kind: "member", base: box.call, member: { kind: "ident_expr", name: VALUE, span: pin.param!.span }, span: box.call.span }
  storeTypeError(inferExprType(read, scope, ctx.project), pin.value, scope, ctx, out, true)
}

/** A network's edge, `RISING(x)` / `FALLING(x)`, is an R_TRIG / F_TRIG on its BOOL input CLK: its value converts into it
 *  (`ng_ot_rising_int`: "Cannot convert type 'INT' to type 'BOOL'", CODESYS 3.5.21.40). True where `x` is an edge. */
export function checkEdge(x: CallExpr, scope: Scope, ctx: CheckContext, out: DiagnosticItem[]): boolean {
  const name = x.callee.kind === "ident_expr" ? x.callee.name : undefined
  if (name === undefined || !["RISING", "FALLING"].includes(name.toUpperCase()) || !isNetworkBox(scope, name)) return false
  const value = x.args[0]?.value
  const refused = value === undefined ? undefined : storeConversionError(elementaryRef("BOOL"), value, value.span, scope, ctx.project, ctx.messages, "argument")
  if (refused !== undefined) out.push({ ...refused, code: "call-argument-type" })
  return true
}

/** An output stored negated, `ET_INVERTED => v`: `v := NOT <box>.ET`, its operand's conversion and its store reported as
 *  ST reports them (`ng_ot_inverted_time_output`: "Cannot convert type 'TIME' to type 'UDINT'", "Cannot convert type
 *  'UDINT' to type 'TIME'", CODESYS 3.5.21.40). */
export function checkInvertedOutputs(box: NetworkBox, scope: Scope, ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const pin of box.pins) {
    if (pin.coil !== "INVERTED" || pin.param === undefined || pin.value === undefined) continue
    const read: MemberExpr = { kind: "member", base: box.call, member: { kind: "ident_expr", name: pin.param.name, span: pin.param.span }, span: pin.span }
    const negated: Expr = { kind: "unary", op: "NOT", operand: read, span: pin.span }
    unaryOperandError(negated, scope, ctx.project, ctx.messages, out)
    storeTypeError(inferExprType(negated, scope, ctx.project), pin.value, scope, ctx, out)
  }
}
