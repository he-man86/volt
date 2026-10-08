/**
 * `SUPER^(…)`: the base FB's body, run on this instance.
 */

import { type Expr, selfRefKind, type Span, type Statement } from "../../../frontend/syntax/index.js"
import type { FbType, Lowering } from "../core/lowering.js"
import type { IrBinding, IrInvoke, IrLayout, IrRoutine, IrStmt, Place } from "../../ir/index.js"
import { selfFb, thisPlace } from "../places/self.js"
import { baseBody } from "./routines.js"
import { type InFrame, isInFrame, specializeRoutine } from "./specialize.js"
import { storeOpenBounds } from "./fb-call.js"
import { UNKNOWN } from "../../../frontend/types/index.js"
import { aliases, bindInOut, holding, shadowedInOutsOf } from "./binding.js"
import { lowerExpr } from "../expressions/expressions.js"
import { refuseImplicitString } from "../statements/assign.js"
import { convert } from "../values/convert.js"
import { openDims } from "../places/bounds.js"
import { bindingRecords } from "./last-binding.js"
import { fieldIn, fieldIndex } from "../places/path.js"

export const isSuper = (e: Expr): boolean => e.kind === "deref" && e.base.kind === "ident_expr" && selfRefKind(e.base.name) === "SUPER"

/**
 * `SUPER^(in := x, io := y)` — the base FB's body, run on this instance (conformance `inh_super_call_runs_base_body`,
 * `inh_super_call_with_arguments`): each input is assigned to the instance's own field, and stays assigned; each in-out
 * is bound; then the base body runs (`baseBody`). An argument left empty assigns nothing; an output argument is refused.
 */
export function lowerSuperCall(lw: Lowering, call: Extract<Statement, { kind: "call_stmt" }>["call"]): IrStmt[] | undefined {
  const frame = selfFb(lw)
  const baseScope = lw.codeOwner?.baseScope
  const base = baseScope === undefined ? undefined : lw.bodies.get(baseScope.name.toUpperCase())
  const layout = frame === undefined ? undefined : lw.layouts.get(frame.name.toUpperCase())
  if (frame === undefined || base === undefined || layout === undefined) return lw.bail("call-super", "SUPER^() outside a derived FB, or on a base with no body", call.span)
  const routine = baseBody(lw, frame, base, call.span)
  if (routine === undefined) return undefined
  const instance = thisPlace(frame, call.callee.span)
  const inouts: (IrBinding | InFrame | undefined)[] = routine.inouts.map(() => undefined)
  const before = superArguments(lw, call, frame, layout, routine, instance, inouts)
  if (before === undefined || passOnDerivedInOuts(lw, routine, inouts, call.span) === undefined) return undefined
  if (inouts.includes(undefined)) return lw.bail("call-inout-missing", `SUPER^ called without every VAR_IN_OUT`, call.span)
  if (superOpenBounds(lw, frame, routine, inouts, call.span) === undefined) return undefined
  const bounds = storeOpenBounds(lw, instance, layout.fields, routine.inouts, (i) => (isInFrame(inouts[i]) ? undefined : (inouts[i] as IrBinding | undefined)), call.span)
  if (bounds === undefined) return undefined
  // `SUPER^(a := n, b := n)` binds the base's in-outs inside the instance the base body runs on: substituted, not lent
  const special = specializeRoutine(lw, routine, inouts)
  const invoke: IrInvoke = { kind: "invoke", routine: special?.routine.key ?? routine.key, instance, inputs: [], inouts: (special?.inouts ?? inouts) as IrBinding[], type: UNKNOWN, span: call.span }
  return [...before, ...bounds, { kind: "eval", value: invoke, span: call.span }]
}

/** SUPER^'s arguments: each in-out bound into `inouts`, each input an assignment to the instance's own field (returned). */
function superArguments(
  lw: Lowering,
  call: Extract<Statement, { kind: "call_stmt" }>["call"],
  frame: FbType,
  layout: IrLayout,
  routine: IrRoutine,
  instance: Place,
  inouts: (IrBinding | InFrame | undefined)[],
): IrStmt[] | undefined {
  const before: IrStmt[] = []
  for (const arg of call.args) {
    if (arg.param === undefined || arg.output) return lw.bail("call-positional", "SUPER^ called with a positional or output argument", arg.span)
    if (arg.value === undefined) continue
    const name = arg.param.name.toUpperCase()
    const k = fieldIndex(routine.inouts, name)
    if (k >= 0) {
      const target = bindInOut(lw, arg, routine.inouts[k]!, holding(instance, inouts.filter((b) => !isInFrame(b)) as (IrBinding | undefined)[]), routine.body, routine.fb, instance)
      if (target === undefined) return undefined
      inouts[k] = target
      continue
    }
    // a layout names each field once (`storage/declare.ts` refuses a duplicate), so the first by name is the only one
    const named = fieldIn(layout.fields, name)
    const field = named?.section === "VAR_INPUT" ? named : undefined
    if (field === undefined) return lw.bail("call-param", `${arg.param.name} is not an input of ${frame.name}'s base`, arg.span)
    const value = lowerExpr(lw, arg.value, field.type)
    if (value === undefined || refuseImplicitString(lw, value, field.type, arg.span)) return undefined
    const member: Place = { ...instance, path: [{ kind: "field", name: field.name }], type: field.type, span: arg.span }
    before.push({ kind: "assign", target: member, value: convert(value, field.type), span: arg.span })
  }
  return before
}

/** A derived in-out the base body takes (`baseBody`) is passed on as itself — SUPER^ cannot name it. Not one a METHOD's own
 *  parameter of that name hides, and never beside an argument already lending it (E0499) — both refused (review). */
function passOnDerivedInOuts(lw: Lowering, routine: IrRoutine, inouts: (IrBinding | InFrame | undefined)[], span: Span): true | undefined {
  for (const [k, slot] of routine.inouts.entries()) {
    if (slot.ofInstance !== true || inouts[k] !== undefined) continue
    const name = slot.name.toUpperCase()
    if (shadowedInOutsOf(lw).has(name)) return lw.bail("call-inout-shadowed", `SUPER^ would pass on ${slot.name}, which a parameter or local of this routine hides`, span)
    const found = lw.inoutByName.get(name)
    if (found === undefined) continue
    const own: Place = { slot: found, path: [], type: lw.inoutSlots[found]!.type, span, root: "inout" }
    if (inouts.some((b) => b !== undefined && !("kind" in b) && aliases(own, b)))
      return lw.bail("call-inout-alias", `SUPER^ passes on ${slot.name}, which an argument of the same call already lends`, span)
    inouts[k] = own
  }
  return true
}

/** The bounds live on the instance, which the derived body shares: `SUPER^(data := other)` overwrote them, and the derived
 *  body then indexed its own `data` by `other`'s bounds (review of batch 3b). Only passing an open in-out on as itself —
 *  same bounds — is kept; rebinding one under SUPER^ is not recorded. */
function superOpenBounds(lw: Lowering, frame: FbType, routine: IrRoutine, inouts: readonly (IrBinding | InFrame | undefined)[], span: Span): true | undefined {
  for (const [i, slot] of routine.inouts.entries()) {
    const binding = inouts[i]!
    const passedOn = !("kind" in binding) && binding.root === "inout" && binding.path.length === 0 && lw.inoutSlots[binding.slot]!.name.toUpperCase() === slot.name.toUpperCase()
    if (openDims(slot.type) > 0 && !passedOn) return lw.bail("call-open-array", `SUPER^ binds its ARRAY[*] ${slot.name} to another array`, span)
    // what the instance holds for a METHOD called from outside after this is not recorded (`last-binding.ts` refuses it)
    if (!passedOn) bindingRecords(lw).superRebinds.add(frame.name.toUpperCase())
  }
  return true
}
