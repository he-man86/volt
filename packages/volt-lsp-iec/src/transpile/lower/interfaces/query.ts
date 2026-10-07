/**
 * `__QUERYINTERFACE`: the query as an assignment's whole value, or as an IF condition's leading operand taken just before
 * the IF (transpile-review 18).
 */

import type { Lowering } from "../lowering.js"
import type { Expr, Span, Statement } from "../../../frontend/syntax/index.js"
import type { IrArm, IrExpr, IrStmt, Place } from "../../ir/index.js"
import { lowerPlace } from "../places/places.js"
import { heldAt } from "./lend.js"
import { elementaryRef } from "../../../frontend/types/index.js"
import { convert } from "../values/convert.js"
import { onEachTag } from "../entry/finish.js"
import { implementsInterface } from "./tags.js"
import { lowerExpr } from "../expressions/expressions.js"

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
  if (v.args.length !== 2 || v.args.some((a) => a.param !== undefined || a.value === undefined))
    return lw.bail("interface-query", "__QUERYINTERFACE other than `found := __QUERYINTERFACE(from, into)`", span)
  const [from, into] = [lowerPlace(lw, v.args[0]!.value!), lowerPlace(lw, v.args[1]!.value!)]
  if (from === undefined || into === undefined) return undefined
  if (from.type.kind !== "interface" || into.type.kind !== "interface") return lw.bail("interface-query", "__QUERYINTERFACE of something other than two interfaces", span)
  const [source, dest] = [heldAt(lw, from, span), heldAt(lw, into, span)]
  if (source === undefined || dest === undefined) return undefined
  const wanted = into.type.name
  dest.held.from.push({ key: source.key, only: wanted, foreign: foreignWrite(lw, dest.key, into) })
  const bool = elementaryRef("BOOL")
  const outcome = (tag: bigint, found: boolean): IrStmt[] => [
    { kind: "assign", target: into, value: { kind: "const", value: tag, type: into.type, span }, span },
    { kind: "assign", target, value: convert({ kind: "const", value: found, type: bool, span }, target.type), span },
  ]
  const arms: IrArm[] = []
  onEachTag(lw, source.key, (tag) => {
    // one arm per tag, as in `dispatch` — a revisited tag must not add a second label for the same value
    if (arms.some((a) => a.labels.some((l) => l.lo === BigInt(tag)))) return
    if (implementsInterface(lw, lw.shared.instances[tag - 1]!.fb.name, wanted))
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
  const leading = (e: Expr): Expr | undefined =>
    e.kind === "paren" ? leading(e.inner)
    : e.kind === "unary" && e.op === "NOT" ? leading(e.operand)
    : e.kind === "binary" && (e.op === "AND_THEN" || e.op === "OR_ELSE") ? leading(e.left)
    : e
  const call = leading(cond)
  if (call === undefined || !isQuery(call)) return null
  const bool = elementaryRef("BOOL")
  const found = lw.tempPlace("query_found", bool, cond.span)
  const before = queryInto(lw, found, call, cond.span)
  if (before === undefined) return undefined
  lw.hoistedQueries.set(call, { kind: "load", place: found, type: bool, span: call.span })
  const lowered = lowerExpr(lw, cond, bool)
  lw.hoistedQueries.delete(call)
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
