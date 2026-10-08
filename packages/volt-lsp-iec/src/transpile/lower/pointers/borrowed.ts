/**
 * Form 2: a `POINTER TO T` parameter its body only dereferences, borrowed as a hidden VAR_IN_OUT of T.
 */

import type { Lowering } from "../core/lowering.js"
import type { IrSlot, Place } from "../../ir/index.js"
import { routineFacts } from "../calls/facts.js"
import { borrowedPointerNames } from "../core/ast-walk.js"
import { callHolds, type InvokeBindings } from "../calls/invoke.js"
import type { CallArg } from "../../../frontend/syntax/index.js"
import { adrOperand } from "./address.js"
import { bindInOut } from "../calls/binding.js"
import { isInFrame } from "../calls/specialize.js"
import { sameStorage } from "../places/path.js"
import { pointerFrame } from "./state.js"

/**
 * The hidden VAR_IN_OUT a borrowed pointer PARAMETER was given (form 2), when `pointer` names one.
 *
 * Only a bare local — a borrow is a parameter of THIS routine, so a path into it, or a pointer living anywhere
 * else, is a different question and falls through to form 1.
 */
export function borrowedInOut(lw: Lowering, pointer: Place): Place | undefined {
  if (pointer.root !== "local" && pointer.root !== undefined) return undefined
  if (pointer.path.length > 0) return undefined
  const slot = pointer.root === "local" ? lw.localSlots[pointer.slot] : lw.slots[pointer.slot]
  if (slot === undefined) return undefined
  const bound = pointerFrame(lw).borrowedPointers.get(slot.name.toUpperCase())
  if (bound === undefined) return undefined
  return { slot: bound, path: [], type: lw.inoutSlots[bound]!.type, span: pointer.span, root: "inout" }
}

/** Each routine's BORROWED pointer inputs (form 2): the input slot index → the hidden VAR_IN_OUT a call binds to whatever
 *  the caller took an `ADR` of. */
export const borrowedInputsOf = routineFacts<ReadonlyMap<number, number>>()

/** The prefix of the hidden VAR_IN_OUT a borrowed `POINTER TO` parameter is given (form 2) — `__any_`'s twin. */
export const BORROWED = "__ptr_"

/**
 * The `POINTER TO T` parameters of this routine that form 2 may erase, each with the slot it was declared as.
 *
 * Restricted to VAR_INPUT: a VAR_IN_OUT pointer is already a binding, and a VAR/VAR_TEMP pointer is a local whose
 * target form 1 records. A parameter with no pointee type — `POINTER TO` something unresolved — is left alone.
 */
export function borrowedPointerSlots(r: Lowering, statements: readonly unknown[]): [string, IrSlot][] {
  const candidates = new Map<string, IrSlot>()
  for (const slot of r.localSlots)
    if (slot.section === "VAR_INPUT" && slot.type.kind === "pointer" && slot.type.target.kind !== "unknown")
      candidates.set(slot.name.toUpperCase(), slot)
  if (candidates.size === 0) return []
  const borrowed = borrowedPointerNames(r, statements, new Set(candidates.keys()))
  return [...borrowed].map((name) => [name, candidates.get(name)!] as [string, IrSlot])
}

/**
 * FORM 2: a borrowed `POINTER TO T` input takes the PLACE the caller took an address of, bound to the hidden VAR_IN_OUT the
 * callee dereferences. The pointer value itself is never built — that is the erasure — so the argument has to be an `ADR`
 * of something this can bind, and anything else falls back to form 1's refusal rather than being guessed at
 * (`ptrparam_passed_on` hands on a pointer PARAMETER and is one of those).
 */
export function bindBorrowedArgument(lw: Lowering, b: InvokeBindings, arg: CallArg, k: number, borrowedInOutIndex: number): true | undefined {
  const routine = b.routine
  const addressed = adrOperand(arg.value)
  if (addressed === undefined)
    return lw.bail("pointer-order", `${arg.param!.name} is a borrowed pointer parameter given something other than ADR(...)`, arg.span)
  // BOUND BY `bindInOut`, exactly as a written VAR_IN_OUT is — not by a hand-rolled walk. It is what refuses two
  // `&mut` into one place, and what calls `inFramePlace` to re-root a target that lies INSIDE the instance the
  // callee runs on. Without it `Read(p := ADR(a))` on the FB's own field emitted `self.read(0, &mut self.a)`,
  // which is E0499 — caught by the generator refusing to write a map it could not stand behind.
  const param = routine.inouts[borrowedInOutIndex]!
  const target = bindInOut(lw, { ...arg, value: addressed }, param, callHolds(b), routine.body, routine.fb, b.instance)
  if (target === undefined) return undefined
  if (!isInFrame(target) && !("kind" in target) && !sameStorage(target.type, param.type))
    return lw.bail("pointer-type", `${arg.param!.name} is given the address of a variable of another type than the pointer's`, arg.span)
  b.inouts[borrowedInOutIndex] = target
  // the pointer local itself is never read — every `p^` became the binding — so it carries a value nobody uses
  b.inputs[k] = { kind: "const", value: 0n, type: routine.locals[routine.inputs[k]!]!.type, span: arg.span }
  b.order.push(k)
  b.order.push({ inout: borrowedInOutIndex })
  return true
}
