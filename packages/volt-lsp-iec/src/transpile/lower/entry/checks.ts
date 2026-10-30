/**
 * What a lowered POU's storage must be for a backend to hold it: a representable type, no reversed array.
 */

import { peelArray, type Type } from "../../../frontend/types/index.js"
import { openDims } from "../places/bounds.js"
import type { Lowering } from "../core/lowering.js"
import type { IrLayout, IrRoutine, IrSlot } from "../../ir/index.js"
import { addressSharedByInstances } from "../storage/addresses.js"

/**
 * WHY A LOWERING'S STORAGE IS ONE NO BACKEND CAN HOLD — an address shared by instances, a reversed array, or a slot with no
 * runtime representation — or undefined: the frame's slots, the layouts' fields and in-outs, the routines' locals and
 * the globals — and the declaration that made the offending slot (`IrSlot.origin`), where the refusal points. Asked of a
 * POU once it lowered (`lower-unit.ts`), and of each GVL variable lowered alone (`places/globals.ts`).
 */
export function storageRefusal(lowering: Lowering, layouts: readonly IrLayout[], routines: readonly IrRoutine[]): { code: string; message: string; at?: IrSlot["origin"] } | undefined {
  const locals = [...lowering.localSlots, ...layouts.flatMap((l) => l.locals ?? [])]
  const sharedAddress = addressSharedByInstances(lowering, [...lowering.slots, ...locals, ...lowering.globals, ...routines.flatMap((r) => r.locals)])
  if (sharedAddress !== undefined) return { code: "var-at-instances", message: `${sharedAddress} binds a variable AT an address and has several instances, which would share it` }
  // WHICH SLOTS A CALL LENDS: a VAR_IN_OUT, and a routine's VAR_INPUT (a function's or a method's — CODESYS takes an
  // `ARRAY[*]` there and builds it, `decl_array_star_in_function_input`). An FB's frame, fields and globals are its own
  // storage, where an `ARRAY[*]` has no size: `decl_array_star_in_var`, `_two_stars`, `_in_fb_input` (both vendors refuse
  // them) lowered as if every open array were a VAR_IN_OUT, and the Rust emitter threw on the slot.
  const slots = [
    ...[...lowering.slots, ...locals].map((s) => ({ s, lent: false })),
    ...layouts.flatMap((l) => [...l.fields.map((s) => ({ s, lent: false })), ...(l.inouts ?? []).map((s) => ({ s, lent: true }))]),
    ...routines.flatMap((r) => [...r.locals.map((s) => ({ s, lent: s.section === "VAR_INPUT" })), ...r.inouts.map((s) => ({ s, lent: true }))]),
    ...lowering.globals.map((s) => ({ s, lent: false })),
  ]
  // A REVERSED ARRAY is refused by name: both vendors refuse it ("Lower border must be lower than upper border",
  // `decl_array_reversed_bounds`), and lowered it was a negative length the Rust compiler rejected
  const reversed = slots.find(({ s }) => reversedArray(s.type))?.s
  if (reversed !== undefined) return { code: "array-reversed", message: `${reversed.name} is an ARRAY whose lower bound is above its upper`, at: reversed.origin }
  const unrepresentable = slots.find(({ s, lent }) => !representable(s.type, lent))?.s
  if (unrepresentable === undefined) return undefined
  const kind = unrepresentable.type.kind
  return { code: `slot-${kind}`, message: `${unrepresentable.name} is a ${kind} variable, which has no runtime representation yet`, at: unrepresentable.origin }
}

/**
 * A type a backend can store: elementary, a laid-out struct or FB instance, or a sized array of those — and, in a slot a
 * call LENDS (`lent`), an `ARRAY[*]` of those: the array its call lends, a Rust slice (design §26).
 */
function representable(t: Type, lent: boolean): boolean {
  // a pointer or reference holds its one target's index (design §9 form 1) — a plain integer in both backends
  // an interface holds its instance's tag (design §22) — a plain integer too
  if (t.kind === "elementary" || t.kind === "struct" || t.kind === "function_block" || t.kind === "pointer" || t.kind === "reference" || t.kind === "interface") return true
  if (openDims(t) > 0) return lent && representable((t as Extract<Type, { kind: "array" }>).element, false)
  const array = peelArray(t)
  return array !== undefined && representable(array.element, false)
}

/**
 * An array type, at any depth of its elements, with a dimension whose lower bound is above its upper PLUS ONE. An EMPTY
 * dimension (`1..0`) is storage of no element: both vendors build it (`qf_c0228_bound_literal_empty`, 2026-10-12) and
 * refuse `2..0` (`qf_c0228_bound_literal_two_below`).
 */
function reversedArray(t: Type): boolean {
  return t.kind === "array" && ((t.bounds ?? []).some((b) => b.lower > b.upper + 1n) || reversedArray(t.element))
}
