/**
 * `__QUERYINTERFACE`: the query as an assignment's whole value, or as an IF condition's leading operand taken just before
 * the IF (transpile-review 18).
 */

import type { Lowering } from "../core/lowering.js"
import type { Expr, Span, Statement } from "../../../frontend/syntax/index.js"
import type { IrArm, IrExpr, IrStmt, Place } from "../../ir/index.js"
import { lowerPlace } from "../places/places.js"
import { heldAt } from "./lend.js"
import { elementaryRef } from "../../../frontend/types/index.js"
import { assignTo } from "../values/convert.js"
import { refuseImplicitString } from "../statements/assign.js"
import { onEachTag } from "../entry/finish.js"
import { implementsInterface } from "./tags.js"
import { lowerExpr } from "../expressions/expressions.js"
import { interfaceFrame, interfaceTables } from "./state.js"
import { tempPlace } from "../core/temps.js"
import { leadingOperand } from "../core/ast-walk.js"
import { indexOfTag } from "../core/tags.js"

/**
 * `found := __QUERYINTERFACE(from, into)` (conformance `itf_queryinterface_success_and_failure`): TRUE, and `into` names the
 * instance, when the instance `from` names implements `into`'s interface; otherwise FALSE — and `into` is null, measured:
 * it does not keep what it held. `null` when the statement is no such query.
 */
export function lowerQueryInterface(lw: Lowering, s: Extract<Statement, { kind: "assign" }>): IrStmt[] | undefined | null {
  const v = s.value
  if (!isQuery(v)) return null
  if (s.op !== undefined || s.chained !== undefined) return lw.bail("interface-query", "__QUERYINTERFACE other than `found := __QUERYINTERFACE(from, into)`", s.span)
  const target = lowerPlace(lw, s.target)
  return target && queryInto(lw, target, v, s.span)
}

const isQuery = (e: Expr): e is Extract<Expr, { kind: "call" }> => e.kind === "call" && e.callee.kind === "ident_expr" && e.callee.name.toUpperCase() === "__QUERYINTERFACE"

/** The query itself: `into` set to the instance or null, `target` to whether it implements `into`'s interface. */
function queryInto(lw: Lowering, target: Place, v: Extract<Expr, { kind: "call" }>, span: Span): IrStmt[] | undefined {
  // other than two operands: "'__QUERYINTERFACE' needs exactly '2' operands" (`lex_keyword_called_sys_queryinterface`)
  if (v.args.length !== 2 || v.args.some((a) => a.param !== undefined || a.value === undefined))
    return lw.bail("interface-query-operand", "__QUERYINTERFACE other than `found := __QUERYINTERFACE(from, into)`", span)
  const [from, into] = [lowerPlace(lw, v.args[0]!.value!), lowerPlace(lw, v.args[1]!.value!)]
  if (from === undefined || into === undefined) return undefined
  // An FB instance as the first operand builds (`rk_queryinterface_from_instance`): valid ST, not built. Any other operand that
  // is no interface is refused: "First operand of __QueryInterface must be an interface reference or the instance of a
  // function block", "Second operand … must be an interface reference" (`calls_queryinterface_int_first`, `_second`;
  // transpile-refusal-classification 2.1).
  if (from.type.kind !== "interface" || into.type.kind !== "interface") {
    const fromInstance = from.type.kind === "function_block" && into.type.kind === "interface"
    return lw.bail(fromInstance ? "interface-query" : "interface-query-operand", "__QUERYINTERFACE of something other than two interfaces", span)
  }
  const [source, dest] = [heldAt(lw, from, span), heldAt(lw, into, span)]
  if (source === undefined || dest === undefined) return undefined
  const wanted = into.type.name
  dest.held.from.push({ key: source.key, only: wanted, foreign: foreignWrite(lw, dest.key, into) })
  const bool = elementaryRef("BOOL")
  // the BOOL lands in `target` as any value does: a STRING target is an implicit conversion the vendor refuses
  // (`ar_queryinterface_type`, refused), not a boolean stored into a string's buffer
  if (refuseImplicitString(lw, { kind: "const", value: true, type: bool, span }, target.type, span)) return undefined
  const outcome = (tag: bigint, found: boolean): IrStmt[] => [
    { kind: "assign", target: into, value: { kind: "const", value: tag, type: into.type, span }, span },
    assignTo(target, { kind: "const", value: found, type: bool, span }, span),
  ]
  const arms: IrArm[] = []
  onEachTag(lw, source.key, (tag) => {
    // one arm per tag, as in `dispatch` — a revisited tag must not add a second label for the same value
    if (arms.some((a) => a.labels.some((l) => l.lo === BigInt(tag)))) return
    if (implementsInterface(lw, interfaceTables(lw).instances[indexOfTag(tag)]!.fb.name, wanted))
      arms.push({ labels: [{ lo: BigInt(tag), hi: BigInt(tag) }], body: outcome(BigInt(tag), true), span })
  })
  return [{ kind: "switch", selector: { kind: "load", place: from, type: from.type, span }, arms, else: outcome(0n, false), span }]
}

/**
 * `IF __QUERYINTERFACE(from, into) THEN` — pro2193's form (~30 uses) — and the query as the condition's LEADING operand:
 * under NOT, in parentheses, or the left side of AND_THEN / OR_ELSE, which always runs first
 * (`IF NOT __QUERYINTERFACE(xuUnit, xuUnitExtended) OR_ELSE NOT xuUnitExtended.InSafePosForMouldEntry THEN`). It is the
 * recorded query above, into a hidden BOOL taken just before the test; the condition then lowers as written, the call
 * reading that BOOL (`hoistedQueries`, read by `lowerBuiltin`). An ELSIF's is taken inside the ELSE its IF lowers to, so
 * only when reached. A query anywhere else — a right operand a short-circuit may skip, an operand of a plain AND/OR whose
 * order is not recorded — stays refused there. `null` when the condition leads with no query.
 */
export function queryCondition(lw: Lowering, cond: Expr): { before: IrStmt[]; cond: IrExpr } | undefined | null {
  const call = leadingOperand(cond)
  if (!isQuery(call)) return null
  const bool = elementaryRef("BOOL")
  const found = tempPlace(lw, "query_found", bool, cond.span, "branches")
  const before = queryInto(lw, found, call, cond.span)
  if (before === undefined) return undefined
  interfaceFrame(lw).hoistedQueries.set(call, { kind: "load", place: found, type: bool, span: call.span })
  const lowered = lowerExpr(lw, cond, bool)
  interfaceFrame(lw).hoistedQueries.delete(call)
  return lowered && { before, cond: lowered }
}

/** Whether a write to the interface at `target` (tracked under `key`) reaches it through another instance than this
 *  body's own: not a variable of this frame (or this routine), nor the field of one of its own child instances — a global. */
export function foreignWrite(lw: Lowering, key: string, target: Place): boolean {
  const frame = key.slice(0, key.lastIndexOf("."))
  const own = frame === lw.frameContext || frame === lw.routineContext
  const child = (target.root === undefined || target.root === "this") && target.path.length > 0
  return !own && !child
}
