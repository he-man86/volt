/**
 * ANY inputs: what a routine reads of the argument behind one.
 */

import type { Lowering, RoutineSymbol } from "../core/lowering.js"
import { type CallArg, type Expr, exprText, type Span, type TopLevel } from "../../../frontend/syntax/index.js"
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
import { escapesOf, type Holder, holderHoldsAddresses } from "./escape.js"
import { imagePlaceAddress } from "./address.js"
import { throughReference } from "./deref.js"

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
  const name = e.base.name.toUpperCase()
  const slot = pointerFrame(lw).anyTargets.get(name)
  const type = slot === undefined ? pointerFrame(lw).anyAddresses.get(name)?.type : lw.inoutSlots[slot]!.type
  return type === undefined ? undefined : byteSize(lw, type)?.size
}

/** Each routine's ANY / ANY_* input slots — the inputs a call fills with its argument's size, not its value. */
export const anyInputsOf = routineFacts<ReadonlySet<number>>()

/** The prefix of the hidden VAR_IN_OUT an ANY input is given where a call names a variable for it. */
export const ANY_TARGET = "__any_"

/** The prefix of the hidden POINTER input an ANY input is given where its `pValue` is an image address. */
const ANY_ADDRESS = "__anyadr_"

/** `pValue`'s type: the compiler's `__SYSTEM.AnyType.pValue` (`frontend/types/system.ts`). */
const PVALUE: Type = { kind: "pointer", target: elementaryRef("BYTE") }

/**
 * THE ANY INPUT'S ADDRESS HOLDER (model 3, transpile-restructure 4.9, design.md §3.3 step 4e): a routine variant that stores
 * `v.pValue` into a pointer that holds addresses (`tr_17_any_pvalue_*`) is handed its argument's image ADDRESS, as a pointer
 * input is (`calls/invoke.ts`), under one key both the body and every call site name: `ROUTINE:<variant>.__any_<v>`.
 * A call site whose argument the image cannot hold stores a tag into it, and the variant keeps the hidden VAR_IN_OUT.
 */
export const anyHolder = (routineKey: string, input: string): Holder => ({
  type: PVALUE,
  key: `ROUTINE:${routineKey}.${ANY_TARGET}${input.toUpperCase()}`,
  name: `${input}.pValue`,
})

/** Whether the variant `routineKey`'s ANY input `input` is handed an address: a body stored its `pValue` into a pointer
 *  that holds addresses (an earlier lowering found it, `escape.noteAnyAddress`) and no call site's argument made it a tag. */
function anyByAddress(lw: Lowering, routineKey: string, input: string, span: Span): boolean {
  const holder = anyHolder(routineKey, input)
  return escapesOf(lw).anyAddresses.has(holder.key!) && holderHoldsAddresses(lw, holder, span)
}

/** Each variant's ANY inputs handed an address, to the index in its `inputs` of the hidden POINTER input. */
const anyAddressInputsOf = routineFacts<ReadonlyMap<string, number>>()

/**
 * The hidden POINTER inputs of the ANY inputs this variant is handed an address for (`anyByAddress`), appended to `inputs`.
 * Answers the inputs it declared, which take no hidden VAR_IN_OUT (`routine-frame.hiddenInOuts`).
 */
export function declareAnyAddresses(lw: Lowering, r: Lowering, targets: ReadonlyMap<string, Type>, key: string, inputs: number[], span: Span): ReadonlySet<string> {
  const byInput = new Map<string, number>()
  for (const [input, type] of targets) {
    if (!anyByAddress(lw, key, input, span)) continue
    const slot = r.localSlots.length
    r.localSlots.push({ name: `${ANY_ADDRESS}${input}`, type: PVALUE, section: "VAR_INPUT", init: 0n })
    pointerFrame(r).anyAddresses.set(input, { slot, type })
    byInput.set(input, inputs.length)
    inputs.push(slot)
  }
  anyAddressInputsOf(lw).set(key, byInput)
  return new Set(byInput.keys())
}

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
    const raw = lw.inArgument(() => lowerPlace(lw, arg.value!))
    // a REFERENCE argument is the variable it references, as everywhere else it is used: the variant is lowered for THAT
    // type (conformance `any_input_given_reference`: diSize 2 for a REFERENCE TO INT) — lowered for the reference's own
    // type, its hidden VAR_IN_OUT was a reference the call bound an INT to (rustc E0308, transpile-restructure 4.13 (e))
    const place = raw?.guard === undefined ? throughReference(lw, raw, arg.value.span) : undefined
    lw.diagnostics.length = before
    if (place !== undefined) out.set(name, place.type)
  }
  return out
}

/** An ANY argument: the routine sees its size — SIZEOF's layout (conformance `state_any_input_sizes`) — of a variable. */
export function bindAnyArgument(lw: Lowering, b: InvokeBindings, arg: CallArg, k: number, name: string): true | undefined {
  const byAddress = anyAddressInputsOf(lw).get(b.routine.key)?.get(name)
  if (byAddress !== undefined) return bindAnyAddress(lw, b, arg, k, name, byAddress)
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

/**
 * An ANY argument handed BY ADDRESS (`anyByAddress`): its size, as any ANY argument's, and its image address in the hidden
 * POINTER input — `ADR(argument)` stored into the ANY's holder, so the argument escapes as any address store's target
 * does, and an argument the image cannot hold makes the holder a tag from the next lowering on (`imageAddressOf`).
 */
function bindAnyAddress(lw: Lowering, b: InvokeBindings, arg: CallArg, k: number, name: string, input: number): true | undefined {
  // a REFERENCE argument is the variable it references (`anyArgumentTypes`): its size, and its address
  const place = throughReference(lw, lowerPlace(lw, arg.value!), arg.span)
  if (place === undefined) return undefined
  const size = byteSize(lw, place.type)
  if (size === undefined) return lw.bail("any-input", "an ANY argument whose byte size is not measured", arg.span)
  const address = imagePlaceAddress(lw, place, exprText(arg.value!), anyHolder(b.routine.key, name), arg.span)
  if (address === undefined) return undefined
  b.inputs[k] = { kind: "const", value: size.size, type: elementaryRef("DINT"), span: arg.span }
  b.inputs[input] = address
  b.order.push(k, input)
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
