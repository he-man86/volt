/**
 * Output bindings: a VAR_OUTPUT bound to the caller's place and copied out after the call (transpile-review 20, 43),
 * an unconnected one given a temp.
 */

import type { Lowering } from "../core/lowering.js"
import { callHolds, type InvokeBindings } from "./invoke.js"
import type { CallArg, Span } from "../../../frontend/syntax/index.js"
import type { IrExpr, IrSlot, IrStmt, IrValue, Place } from "../../ir/index.js"
import { aliases, bindInOut } from "./binding.js"
import { isInFrame } from "./specialize.js"
import { lowerPlace } from "../places/places.js"
import { FULL_WRITE, guardWrite } from "../places/access-guards.js"
import { isAssignable } from "../../../frontend/types/index.js"
import { tempPlace } from "../core/temps.js"
import { refuseCursorOverrun } from "../pointers/cursor.js"
import { storeArgument } from "../statements/assign.js"

/** `name => target`: a VAR_OUTPUT bound to the caller's place, copied out after the call; left empty, nothing binds here. */
export function bindOutputArgument(lw: Lowering, b: InvokeBindings, arg: CallArg, bound: number, param: IrSlot | undefined): true | undefined {
  const routine = b.routine
  if (param?.section !== "VAR_OUTPUT") return lw.bail("call-output", `${arg.param?.name ?? "an argument"} is no VAR_OUTPUT of ${routine.name}`, arg.span)
  if (arg.value === undefined) return true
  const target = bindInOut(lw, arg, param, callHolds(b), routine.body, routine.fb, b.instance)
  if (target === undefined || isInFrame(target)) return undefined
  if (target.type.kind !== "elementary" || param.type.kind !== "elementary" || target.type.name !== param.type.name || target.type.length !== param.type.length)
    return lw.bail("call-output-type", `${param.name} is read into a variable of another type`, arg.span)
  // COPIED OUT AFTER THE CALL, not lent before it: the callee writes a copy, and the target — its index read then —
  // takes it once the call returns. A METHOD moving its FB's `k`, or a FUNCTION moving a global, lands the output in
  // `arr[k]` at the index it moved to (`tr_20_output_index_moved_by_callee`: arr[1] = 5). A target through a
  // dereference is still lent: what the callee could do to the pointer is not recorded.
  const copied = "kind" in target || target.guard !== undefined ? target
    : { kind: "copy" as const, value: { kind: "const" as const, value: param.init as IrValue, type: param.type, span: arg.span }, type: param.type, back: target, span: arg.span }
  b.inouts[bound] = copied
  b.order.push({ inout: bound, output: true })
  return true
}

/** Every in-out left is an unconnected output — it still needs somewhere to go: a temp of its own, which nothing reads. */
export function bindUnconnectedOutputs(lw: Lowering, b: InvokeBindings, outside: boolean, span: Span): true | undefined {
  const routine = b.routine
  for (const [i, slot] of routine.inouts.entries()) {
    if (b.inouts[i] !== undefined || (outside && slot.ofInstance === true)) continue
    if (slot.section !== "VAR_OUTPUT") return lw.bail("call-inout-missing", `${routine.name} called without every VAR_IN_OUT`, span)
    const temp = tempPlace(lw, "output", slot.type, span)
    if (callHolds(b).some((p) => aliases(temp, p))) return lw.bail("call-inout-alias", `${slot.name} is unconnected on a call of this instance's own method`, span)
    b.inouts[i] = temp
  }
  return true
}

/** `q => y`: the output read out of the instance after the call, into a variable it converts to as an assignment does. */
export function fbOutputCopy(lw: Lowering, arg: CallArg, member: Place, field: IrSlot): IrStmt[] | undefined {
  const written = lowerPlace(lw, arg.value!)
  const target = written === undefined ? undefined : guardWrite(lw, written, arg.span, FULL_WRITE)
  if (target === undefined) return undefined
  // AN OUTPUT IS READ INTO A VARIABLE OF ITS OWN TYPE. `accepts_output_into_other_type` asked CODESYS on
  // 2026-09-18: `w(o => text)` with an INT output and a STRING variable does not compile, "Cannot convert type
  // 'INT' to type 'STRING'". The ROUTINE call path has checked this since `call-output-type`; the FB BODY call
  // path never did, so the same mistake lowered here and `convert` quietly made something of it.
  // It converts as an ASSIGNMENT does (`isAssignable`), not by family: CODESYS runs WORD => INT (-1), WORD => UDINT
  // and INT => REAL, and refuses DINT => INT, "Cannot convert type 'DINT' to type 'INT'" (`tr_43_output_*`). A
  // family compare refused the first three and truncated the last.
  if (!isAssignable(target.type, field.type))
    return lw.bail("call-output-type", `${field.name} is read into a variable of another type`, arg.span)
  // an output copied out through a STRING cursor is a whole-string store into `p^` (`cursor_whole_store_capacity`)
  if (refuseCursorOverrun(lw, target, field.type, arg.span)) return undefined
  const value: IrExpr = { kind: "load", place: member, type: field.type, span: arg.span }
  // an instance whose data the image holds is copied by value, its own region kept (`storeArgument`)
  return storeArgument(lw, target, value, arg.span)
}
