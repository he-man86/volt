/**
 * ANY inputs: what a routine reads of the argument behind one.
 */

import type { Lowering, RoutineSymbol } from "../core/lowering.js"
import type { CallArg, Expr, Span, TopLevel } from "../../../frontend/syntax/index.js"
import type { IrExpr } from "../../ir/index.js"
import { byteSize } from "../storage/bytes.js"
import { routineFacts } from "../calls/facts.js"
import { ANY_FAMILIES, elementaryRef, type Type } from "../../../frontend/types/index.js"
import { positionalParameters } from "../calls/parameters.js"
import { lowerPlace } from "../places/places.js"
import { callHolds, type InvokeBindings } from "../calls/invoke.js"
import { FULL_WRITE, guardWrite } from "../places/access-guards.js"
import { aliases, lendGuards } from "../calls/binding.js"
import { pointerFrame } from "./state.js"

/** `anyArg.diSize` — an ANY input's size, which the call handed in as a hidden DINT (conformance `state_any_input_sizes`);
 *  `null` when the base is no ANY input. */
export function anyDiSize(lw: Lowering, e: Extract<Expr, { kind: "member" }>): IrExpr | undefined | null {
  if (e.base.kind !== "ident_expr" || !pointerFrame(lw).anyInputs.has(e.base.name.toUpperCase())) return null
  const slot = lw.localByName.get(e.base.name.toUpperCase())
  if (e.member.name.toUpperCase() !== "DISIZE" || slot === undefined)
    return lw.bail("any-input", `${e.base.name}.${e.member.name} of an ANY input is not measured`, e.span)
  const type = lw.localSlots[slot]!.type
  return { kind: "load", place: { slot, path: [], type, span: e.span, root: "local" }, type, span: e.span }
}

/** `anyArg.diSize` of an ANY input this variant was given a VARIABLE for — its byte size, known here — else undefined. */
export function anySize(lw: Lowering, e: Expr): bigint | undefined {
  if (e.kind !== "member" || e.base.kind !== "ident_expr" || e.member.name.toUpperCase() !== "DISIZE") return undefined
  const slot = pointerFrame(lw).anyTargets.get(e.base.name.toUpperCase())
  return slot === undefined ? undefined : byteSize(lw, lw.inoutSlots[slot]!.type)?.size
}

/** Each routine's ANY / ANY_* input slots — the inputs a call fills with its argument's size, not its value. */
export const anyInputsOf = routineFacts<ReadonlySet<number>>()

/** The prefix of the hidden VAR_IN_OUT an ANY input is given where a call names a variable for it. */
export const ANY_TARGET = "__any_"

/**
 * The ANY / ANY_* VAR_INPUTs a call names a plain VARIABLE for, and that variable's type — read from the routine's AST,
 * WITHOUT lowering it, since it is what decides which variant of the routine to lower. An argument that is not a place
 * (an expression, a literal) simply has no entry: the routine is then the plain one, whose `pValue` is refused.
 */
export function anyArgumentTypes(lw: Lowering, sym: RoutineSymbol, call: Extract<Expr, { kind: "call" }>): Map<string, Type> {
  const ast = sym.ast as Extract<TopLevel, { kind: "method" | "action" | "function" }>
  const sections = ast.kind === "action" ? [] : ast.varSections
  const parameters = positionalParameters(sections)
  const declared = parameters.map((prm) => prm.name.toUpperCase())
  const any = new Set(
    parameters
      .filter((prm) => prm.sectionKind === "VAR_INPUT" && prm.type.kind === "named_type" && ANY_FAMILIES.has(prm.type.name.text.toUpperCase()))
      .map((prm) => prm.name.toUpperCase()),
  )
  const out = new Map<string, Type>()
  if (any.size === 0) return out
  for (const [position, arg] of call.args.entries()) {
    const name = arg.param?.name.toUpperCase() ?? declared[position]
    if (name === undefined || arg.output || arg.value === undefined || !any.has(name)) continue
    // a failed lowering is not this pass's to report — the argument goes on to the ANY branch of `lowerInvoke`
    const before = lw.diagnostics.length
    const place = lw.inArgument(() => lowerPlace(lw, arg.value!))
    lw.diagnostics.length = before
    if (place !== undefined && place.guard === undefined) out.set(name, place.type)
  }
  return out
}

/** An ANY argument: the routine sees its size — SIZEOF's layout (conformance `state_any_input_sizes`) — of a variable. */
export function bindAnyArgument(lw: Lowering, b: InvokeBindings, arg: CallArg, k: number, name: string): true | undefined {
  // An ANY argument is lent as a hidden VAR_IN_OUT, so it passes what every other lent place passes:
  // `through` (which dereferences a REFERENCE and refuses a write through a VAR_IN_OUT CONSTANT) and then
  // the bit and global guards. It used to pass none of them — measured 2026-09-17, a GVL variable given to
  // an ANY_INT input lowered with ZERO diagnostics and emitted Rust that rustc rejects with E0499, and a
  // caller's `VAR_IN_OUT CONSTANT` was WRITTEN by the interpreter.
  const raw = lw.inArgument(() => lowerPlace(lw, arg.value!))
  if (raw === undefined) return undefined
  const viaRef = guardWrite(lw, raw, arg.span, FULL_WRITE)
  if (viaRef === undefined) return undefined
  const place = lendGuards(lw, viaRef, arg.param!.name, arg.span)
  if (place === undefined) return undefined
  const size = byteSize(lw, place.type)
  if (size === undefined) return lw.bail("any-input", "an ANY argument whose byte size is not measured", arg.span)
  b.anyPlaces.set(name, place)
  b.inputs[k] = { kind: "const", value: size.size, type: elementaryRef("DINT"), span: arg.span }
  b.order.push(k)
  return true
}

/** The hidden VAR_IN_OUT of an ANY input this variant was lowered for: the very variable the argument names. */
export function bindAnyTargets(lw: Lowering, b: InvokeBindings, span: Span): true | undefined {
  const routine = b.routine
  for (const [i, slot] of routine.inouts.entries()) {
    if (b.inouts[i] !== undefined || !slot.name.startsWith(ANY_TARGET)) continue
    const place = b.anyPlaces.get(slot.name.slice(ANY_TARGET.length).toUpperCase())
    if (place === undefined) return lw.bail("any-input", `${routine.name} is lowered for an ANY argument this call does not name`, span)
    if (callHolds(b).some((p) => aliases(place, p))) return lw.bail("call-inout-alias", `${routine.name}'s ANY argument is a variable the call already holds`, span)
    b.inouts[i] = place
  }
  return true
}
