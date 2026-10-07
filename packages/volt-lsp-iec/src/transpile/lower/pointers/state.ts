/**
 * POINTER and REFERENCE (design §9 form 1): the representation — each variable's one target, the key every body that
 * reaches it agrees on, and the value naming it.
 */

import type { Place } from "../../ir/index.js"
import type { Type } from "../../../frontend/types/index.js"
import type { Lowering } from "../lowering.js"
import { unionOf } from "../storage/unions.js"
import type { Span } from "../../../frontend/syntax/index.js"
import { sameTarget } from "../places/path.js"

/**
 * A pointer's or reference's ONE target (design §9 form 1): every address stored into the variable names the same place, or
 * elements of the same array. The pointer's value is 0 when null, 1 for its variable, and k + ELEMENT_TAG_BIAS (2^32) for
 * element k (from 0), so a step below the first element does not reach 0 (`address.ts`) — so `p = 0` and `__ISVALIDREF`
 * are plain comparisons, and `p[i]` / `p + n·SIZEOF(T)` step whole elements.
 */
export interface PointerTarget {
  /** The variable — or the array whose elements the value indexes. */
  base: Place
  /** The array's first dimension, when the pointer points at its elements. */
  element?: { lower: bigint; length: number; type: Type }
  /** A POINTER TO BYTE over a STRING (TO WORD over a WSTRING): the value is a byte offset + 1 into its buffer, and `p^` /
   *  `p[i]` are its characters — a string cursor over a variable (`cursorChar`). */
  chars?: Type
  /** A place in a VAR_IN_OUT: the FB body binding it — the one body that may dereference it (`recordTarget`). */
  scopedTo?: Lowering
}

/** A STRING CURSOR parameter (`Lowering.cursors`): its hidden VAR_IN_OUT, what it points at, and whether it may stand
 *  past its string's first character. */
export interface Cursor {
  inout: number
  unit: Type
  offset: boolean
}

/** Where a pointer or reference variable lives, as a key every body that reaches it agrees on — undefined for one this
 *  does not track (a field of another instance, an element, a VAR_IN_OUT). */
export function pointerKey(lw: Lowering, p: Place): string | undefined {
  // Every member of a union of pointers overlays the same value, so they are ONE pointer with one target: `u.p1_Byte`
  // stored and `u.p2_Int^` read back name the same thing (conformance `state_any_int_pointer_increment`).
  const union = unionOf(lw, p)
  if (union !== undefined) return p.path.length === union.union.path.length + 1 ? pointerKey(lw, union.union) : undefined
  const field = p.path[0]
  if (p.root === "this" && p.path.length === 1 && field?.kind === "field") return `${lw.frameContext}.${field.name.toUpperCase()}`
  // a pointer reached THROUGH another one (`pp^` of a POINTER TO POINTER) is the variable that one names — form 1 erases
  // the step (`pointeePlace`), and the guard is only the null check of `pp` (`decl_pointer_to_pointer_deref`)
  if (p.guard !== undefined && p.path.length === 0) return pointerKey(lw, { ...p, guard: undefined })
  if (p.path.length > 0 || p.guard !== undefined) return undefined
  if (p.root === undefined) return `${lw.frameContext}.${lw.slots[p.slot]!.name.toUpperCase()}`
  if (p.root === "local") return `${lw.routineContext}.${lw.localSlots[p.slot]!.name.toUpperCase()}`
  if (p.root === "global") return `GLOBAL.${lw.shared.globals.slots[p.slot]!.name.toUpperCase()}`
  return undefined
}

/** Record `target` among the pointer's targets and answer its TAG — undefined when the pointer outlives it. */
export function recordTarget(lw: Lowering, key: string, target: PointerTarget, span: Span): bigint | undefined {
  // An FB body's own field pointing into its VAR_IN_OUT (conformance `mem_adr_of_inout_member`) names the variable the
  // caller bound for THIS call — exact wherever the body stored it on this run. Read anywhere else (a method, the caller,
  // this body before the store) it would follow the next binding where CODESYS follows the stale address, which is
  // unmeasured: `pointeePlace` refuses those.
  const scoped = target.base.root === "inout" && lw.frameContext.startsWith("FB:") && !lw.routineMode && key.startsWith(`${lw.frameContext}.`)
  if (scoped) target = { ...target, scopedTo: lw }
  const outlives = !key.startsWith("ROUTINE:") && (target.base.root === "local" || (target.base.root === "inout" && !scoped))
  if (outlives || (key.startsWith("GLOBAL.") && target.base.root !== "global")) {
    lw.bail("pointer-outlives", "a pointer that outlives the variable it points at", span)
    return undefined
  }
  const known = lw.shared.pointers.get(key) ?? []
  const at = known.findIndex((t) => sameTarget(t, target))
  if (at >= 0) return BigInt(at + 1)
  // A SECOND TARGET IS FORM 3, not a refusal. It was `pointer-targets` — "the handle form is not built yet" — and
  // the handle is what this is: the store writes a TAG, and a read selects the arm the tag names
  // (`refuse_pointer_two_targets`: `p := ADR(a); p := ADR(b); seen := p^` reads b, measured).
  lw.shared.pointers.set(key, [...known, target])
  return BigInt(known.length + 1)
}

/**
 * THE VALUE OF A POINTER TO ARRAY ELEMENT k (counted from 0) is k + ELEMENT_TAG_BIAS. It was k + 1, which put the
 * element one below the first on 0 — NULL — where CODESYS holds a byte address that is not (conformance
 * `tr_44_pointer_step_below_first_element`: `ADR(arr[0]) - SIZEOF(INT) = 0` is FALSE, and stepping back reads arr[0]).
 * Biased by 2^32, no step within reach of the array lands on 0; the index arithmetic subtracts the same bias.
 */
export const ELEMENT_TAG_BIAS = 1n << 32n
