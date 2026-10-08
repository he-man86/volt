/**
 * POINTER and REFERENCE (design §9 form 1): the representation — each variable's one target, the key every body that
 * reaches it agrees on, and the value naming it.
 */

import type { Place } from "../../ir/index.js"
import type { Type } from "../../../frontend/types/index.js"
import { frameState, type Lowering } from "../core/lowering.js"
import { sharedState } from "../core/shared.js"
import { unionOf } from "../storage/unions.js"
import type { Span } from "../../../frontend/syntax/index.js"
import { sameTarget } from "../places/path.js"
import { tagOfIndex } from "../core/tags.js"

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

/** A STRING CURSOR parameter (`PointerFrame.cursors`): its hidden VAR_IN_OUT, what it points at, and whether it may stand
 *  past its string's first character. */
export interface Cursor {
  inout: number
  unit: Type
  offset: boolean
}

/** What a frame keeps about its pointers and its pointer-like parameters (each was a field of the `Lowering`). */
export interface PointerFrame {
  /** The pointers and references this body stores at depth 0, by `pointerKey` — so far, in source order. */
  readonly boundPointers: Set<string>
  /** A routine's ANY / ANY_* inputs, upper-cased: each a hidden DINT holding the argument's `diSize` — the one part of
   *  the ANY value measured (conformance `state_any_input_sizes`); any other use of the parameter is refused. */
  readonly anyInputs: Set<string>
  /** Each ANY input whose call site named a variable, to the hidden VAR_IN_OUT bound to it — what `pValue` is. */
  readonly anyTargets: Map<string, number>
  /**
   * FORM 2 (`pointer-model.md` §8 step 1) — each `POINTER TO T` parameter this routine only DEREFERENCES, upper-cased,
   * to the hidden VAR_IN_OUT the call binds to whatever the caller took an `ADR` of.
   *
   * A pointer the callee never keeps is a borrow for the duration of the call, and a borrow is what the IR already
   * calls a VAR_IN_OUT: the callee addresses it as `root: "inout"`, the caller supplies a place, and the emitter
   * already prints it `&mut`. So `p^` becomes that place and the pointer value never exists — the same erasure
   * `anyTargets` above performs for an ANY input, and for the same reason.
   *
   * MEASURED FIRST (`memory/pointer-parameters.ts`): the callee's `p^ := 77` changes the CALLER's variable, so it is
   * a borrow and not a copy; and ONE parameter answers 11 and 22 at two call sites, which is exactly what form 1's
   * single recorded target per pointer cannot represent.
   */
  readonly borrowedPointers: Map<string, number>
  /**
   * A STRING CURSOR — `pointer-model.md` form 2 over a string's characters, not over a whole variable. Each
   * `POINTER TO BYTE` (`POINTER TO WORD`) parameter a caller filled with the address of a STRING (WSTRING), upper-cased,
   * to the hidden VAR_IN_OUT the call binds that string to, and the character type it walks.
   *
   * It is what the StringUtils library is written in (`libraries/StringUtils`): `StrLenA(ADR(s))` walks `s` byte by
   * byte through `pstData^`, `pstData[i]` and `pstData := pstData + 1`. Unlike a plain borrow the pointer VALUE is
   * kept — a byte offset + 1, exactly as an element pointer holds its index + 1 — and every dereference is a
   * character of the bound string (`char` / `setchar`). The routine is lowered once per string TYPE, so the capacity a
   * store is cut at is the caller's, in both backends. A `POINTER TO STRING` parameter binds the same way, by the
   * caller's own string type — its `unit` is then a string, `p^[i]` a character counted from where it stands, and `p^`
   * the whole bound string. `offset` marks one that may stand past the first character (handed a byte cursor that
   * walked), whose `p^` is no whole string — refused rather than read from the start.
   */
  readonly cursors: Map<string, Cursor>
}

/** A frame's pointer state (`PointerFrame`). */
export const pointerFrame = frameState<PointerFrame>(() => ({
  boundPointers: new Set(),
  anyInputs: new Set(),
  anyTargets: new Map(),
  borrowedPointers: new Map(),
  cursors: new Map(),
}))

/**
 * Each pointer or reference variable's targets, by `pointerKey`, in the order they were recorded — the TAG a store
 * writes is the index + 1, and 0 is none. One target is form 1 and the deref erases to that place; several is form 3,
 * where the read selects on the tag (`IrSelect`). Shared by every lowering of the POU.
 */
export const pointerTargets = sharedState(() => new Map<string, PointerTarget[]>())

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
  const known = pointerTargets(lw).get(key) ?? []
  const at = known.findIndex((t) => sameTarget(t, target))
  if (at >= 0) return BigInt(tagOfIndex(at))
  // A SECOND TARGET IS FORM 3, not a refusal. It was `pointer-targets` — "the handle form is not built yet" — and
  // the handle is what this is: the store writes a TAG, and a read selects the arm the tag names
  // (`refuse_pointer_two_targets`: `p := ADR(a); p := ADR(b); seen := p^` reads b, measured).
  pointerTargets(lw).set(key, [...known, target])
  return BigInt(tagOfIndex(known.length))
}

/**
 * THE VALUE OF A POINTER TO ARRAY ELEMENT k (counted from 0) is k + ELEMENT_TAG_BIAS. It was k + 1, which put the
 * element one below the first on 0 — NULL — where CODESYS holds a byte address that is not (conformance
 * `tr_44_pointer_step_below_first_element`: `ADR(arr[0]) - SIZEOF(INT) = 0` is FALSE, and stepping back reads arr[0]).
 * Biased by 2^32, no step within reach of the array lands on 0; the index arithmetic subtracts the same bias.
 */
export const ELEMENT_TAG_BIAS = 1n << 32n
