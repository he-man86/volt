/**
 * The system operators: SIZEOF, MOVE, `__POUNAME`, `__QUERYINTERFACE`, LOWER_BOUND/UPPER_BOUND, `__ISVALIDREF`.
 */

import type { Lowering } from "../core/lowering.js"
import type { Expr } from "../../../frontend/syntax/index.js"
import type { IrExpr } from "../../ir/index.js"
import { sizeOf } from "./sizeof.js"
import { oneArgument } from "./arity.js"
import { lowerExpr } from "../expressions/expressions.js"
import { withStringCapacity } from "../storage/layout.js"
import { elementaryRef } from "../../../frontend/types/index.js"
import { lowerPlace } from "../places/places.js"
import { foldConstant } from "../values/fold.js"
import { boundOf } from "../places/bounds.js"
import { interfaceFrame } from "../interfaces/state.js"

/** The system operators — SIZEOF, MOVE, `__POUNAME`, `__QUERYINTERFACE`, LOWER_BOUND/UPPER_BOUND, `__ISVALIDREF`; `null`
 *  for any other name. */
export function lowerSystemCall(lw: Lowering, e: Extract<Expr, { kind: "call" }>, name: string): IrExpr | undefined | null {
  if (name === "SIZEOF" || name === "XSIZEOF") return sizeOf(lw, e)
  // `MOVE(v)` is v — the IEC assignment operator, which the corpus writes around a variable, a constant and a variable
  // AT a direct address (conformance `co_move_operator`).
  if (name === "MOVE") {
    const only = oneArgument(e)
    if (only === undefined)
      return lw.bail("call-arity", "MOVE takes exactly one positional argument", e.span)
    return lowerExpr(lw, only)
  }
  // `__POUNAME()` — the POU's name, or `POU.Member` inside a METHOD or ACTION, as a sizeless STRING (conformance
  // `cp_pouname_operator`: 'FB_CP_named', 'FB_CP_named.Inner', 'FB_CP_named.Marked'; the corpus writes it 304 times).
  if (name === "__POUNAME") {
    if (e.args.length !== 0) return lw.bail("call-arity", "__POUNAME takes no argument", e.span)
    if (lw.displayName === "") return lw.bail("expr-call", "__POUNAME where the POU has no name", e.span)
    return { kind: "const", value: lw.displayName, type: withStringCapacity(elementaryRef("STRING")), span: e.span }
  }
  // lowered as an assignment's whole value, or as an IF condition's leading operand — taken just before the IF, read here
  // (`queryCondition`); anywhere else — a right operand a short-circuit may skip, inside another expression — the timing
  // of its store is not modelled
  if (name === "__QUERYINTERFACE")
    return interfaceFrame(lw).hoistedQueries.get(e) ?? lw.bail("interface-query", "__QUERYINTERFACE other than an assignment's whole value or an IF condition's leading operand", e.span)
  // LOWER_BOUND(array, dimension) / UPPER_BOUND: a DINT (conformance `callshape_array_star_*`, `callshape_bounds_of_sized_array`)
  if (name === "LOWER_BOUND" || name === "UPPER_BOUND") {
    const [array, dimension] = e.args
    if (e.args.length !== 2 || e.args.some((a) => a.param !== undefined || a.output || a.value === undefined))
      return lw.bail("call-arity", `${name} takes an array and a dimension`, e.span)
    const place = lowerPlace(lw, array!.value!)
    if (place === undefined) return undefined
    const dim = foldConstant(lw, dimension!.value!)
    const bound = typeof dim === "bigint" ? boundOf(lw, place, name === "LOWER_BOUND" ? "lower" : "upper", Number(dim)) : undefined
    return bound ?? lw.bail("array-bound", `${name} of an array whose bounds are not known here`, e.span)
  }
  if (name === "__ISVALIDREF") {
    // a bound reference is valid (conformance `op_sys_isvalidref`: TRUE) — its value is not 0
    const arg = oneArgument(e, { named: true, output: true })
    if (arg === undefined) return lw.bail("call-arity", "__ISVALIDREF takes one argument", e.span)
    const place = lowerPlace(lw, arg)
    if (place === undefined) return undefined
    if (place.type.kind !== "reference" && place.type.kind !== "pointer") return lw.bail("call-arity", "__ISVALIDREF of something that is not a reference", e.span)
    const loaded: IrExpr = { kind: "load", place, type: place.type, span: arg.span }
    return { kind: "binary", op: "ne", left: loaded, right: { kind: "const", value: 0n, type: place.type, span: e.span }, type: elementaryRef("BOOL"), span: e.span }
  }
  return null
}
