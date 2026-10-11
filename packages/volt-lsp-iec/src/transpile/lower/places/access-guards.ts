/**
 * The guards on a place's access: the checks a WRITE passes (`guardWrite`), a read of a value (`loadValue`).
 */

import { frameState, type Lowering } from "../core/lowering.js"
import type { IrExpr, IrSlot, Place } from "../../ir/index.js"
import { convert } from "../values/convert.js"
import { fieldOf, rootType, typeAlong } from "./path.js"
import type { Expr, Span } from "../../../frontend/syntax/index.js"
import { constEval, inferExprType } from "../../../frontend/types/index.js"
import { forEachExpr } from "../../ir/walk.js"
import { pointeePlace, selectThrough } from "../pointers/deref.js"
import { refuseUnionWrite } from "../storage/unions.js"
import { rawBoolLoad } from "../pointers/raw-bool.js"
import { refuseOpenArray } from "./bounds.js"

/**
 * What a store checks before it writes a place, in the order a site lists them:
 *
 * - `open-array`: an `ARRAY[*]` is never stored whole (`refuseOpenArray`);
 * - `interface`: an interface's instances are recorded only by a plain `:=` (`storeInterface`), so any other store into
 *   one is refused;
 * - `through-reference`: a REFERENCE writes its target, as a read reads it — from here on the checks are on the target.
 *   Only a plain `:=` went through a reference once — an FB output (`inst(q => r)`), a VAR_IN_OUT binding, `S=`/`R=` and
 *   a chain link wrote the reference's own slot, overwriting its stored index instead of the variable (transpiler review
 *   2026-09-15);
 * - `union`: a write into a UNION member other than a plain `:=` (`refuseUnionWrite`);
 * - `constant`: a VAR_IN_OUT CONSTANT (`refuseConstantWrite`).
 */
type WriteCheck = "open-array" | "interface" | "through-reference" | "union" | "constant"

/**
 * THE ONE WRITE GUARD (transpile-restructure 1.7.5): the place a store writes once `checks` pass, in order — undefined
 * when one refused (reported). Every store site passes one of the three named lists below (6.A.18) — it was a list per
 * site (1.7.5), and the FOR variable's, without `through-reference`, counted a REFERENCE's own slot where CODESYS counts
 * the variable it references (`tr_a18_for_counter_through_reference`).
 */
export function guardWrite(lw: Lowering, place: Place, span: Span, checks: readonly WriteCheck[]): Place | undefined {
  let written = place
  for (const check of checks)
    switch (check) {
      case "open-array":
        if (refuseOpenArray(lw, written, span)) return undefined
        break
      case "interface":
        if (written.type.kind === "interface") return lw.bail("interface-store", "an interface stored by anything but a plain `:=`", span)
        break
      case "through-reference": {
        const target = written.type.kind === "reference" ? pointeePlace(lw, written, undefined, span) : written
        if (target === undefined) return undefined
        written = target
        break
      }
      case "union":
        if (refuseUnionWrite(lw, written, span)) return undefined
        break
      case "constant":
        if (refuseConstantWrite(lw, written, span)) return undefined
        break
    }
  return written
}

/**
 * A PLAIN `:=` — into a place (`statements/assign.ts`), into a reference's target, and an FB input stored into its instance
 * (`calls/fb-call.ts`, the `inst.in := v` the call makes). It is the one store that models an interface (`storeInterface`)
 * and a UNION member, and it reaches through a REFERENCE by its own path, so only an `ARRAY[*]` stored whole and a
 * VAR_IN_OUT CONSTANT are refused.
 */
export const PLAIN_WRITE: readonly WriteCheck[] = ["open-array", "constant"]

/** A LENT place — a VAR_IN_OUT binding that is not CONSTANT (`calls/binding.ts`), an ANY argument (`pointers/any.ts`): every
 *  check but `open-array`, as an `ARRAY[*]` is bound whole to an in-out, which is no store. */
export const FULL_WRITE: readonly WriteCheck[] = ["interface", "through-reference", "union", "constant"]

/** EVERY OTHER STORE — a chain link, a latch `S=`/`R=`, an FB output `q => y` (`calls/outputs.ts`), a FOR variable
 *  (`statements/loops.ts`), a character `s[i] :=`: the full write, and an `ARRAY[*]` not stored whole. */
export const STORE_WRITE: readonly WriteCheck[] = ["open-array", ...FULL_WRITE]

/**
 * A store into a VAR_IN_OUT CONSTANT — "'value' is no valid assignment target" (conformance `inout_const_write_5`, a `:=`):
 * refused however it is written — a store, a latch, a chain link, an output, a FOR variable, an input stored into a lent
 * instance, a store through a pointer or reference to it (its address may be taken, `inout_const_adr_11`, and read).
 * Only the `:=` is recorded; the rest are refused as the stores they are, not claimed as the compiler's.
 */
function refuseConstantWrite(lw: Lowering, place: Place, span: Span): boolean {
  const slot = place.root === "inout" ? lw.inoutSlots[place.slot] : undefined
  if (slot?.constant !== true) return false
  if (refuseLentInput(lw, place, span, "writes or lends writable")) return true
  lw.bail("inout-constant-write", `'${slot.name}' is a VAR_IN_OUT CONSTANT — no valid assignment target`, span)
  return true
}

/**
 * THE IN-OUTS OF A ROUTINE'S OWN LOWERING THAT ARE READ-ONLY STRING INPUTS — a Standard function's STRING(255) VAR_INPUT
 * lent the caller's string (`calls/string-inputs.ts`, 7.4.6). Lowering's, not the IR's.
 */
export const lentInputSlotsOf = frameState(() => new Set<number>())

/**
 * A LENT STRING INPUT THE BODY WRITES, LENDS WRITABLE OR TAKES THE ADDRESS OF — refused by name, true when refused. The
 * input is read where the caller's string lies only because the library repo's body reads it alone
 * (`test/libraries/standard.test.ts`); a body that does more is a defect of the repo, never a silent copy.
 */
export function refuseLentInput(lw: Lowering, place: Place, span: Span, does: "writes or lends writable" | "takes the address of"): boolean {
  if (place.root !== "inout" || !lentInputSlotsOf(lw).has(place.slot)) return false
  lw.bail("input-borrow-written", `the body ${does} its STRING input '${lw.inoutSlots[place.slot]!.name}', which it is lent read-only`, span)
  return true
}

/** A place read as a value: a REFERENCE reads its target; a POINTER's own value is refused — it is not a real address
 *  here, and only another pointer, a comparison with 0 and __ISVALIDREF (which lower it themselves) may use it. */
export function loadValue(lw: Lowering, place: Place, span: Span): IrExpr | undefined {
  if (refuseOpenArray(lw, place, span)) return undefined
  if (place.type.kind === "reference") {
    // A REFERENCE IS READ WITHOUT A `^`, so this is its deref — and form 3 applies here exactly as it does to a
    // pointer's. `refdecl_rebound_by_statement` and `refdecl_rebound_in_method` both bind at the declaration and
    // rebind afterwards, which is two targets and one tag.
    const selected = selectThrough(lw, place, span)
    if (selected !== undefined) return selected
    const target = pointeePlace(lw, place, undefined, span)
    return target && rawBoolLoad(lw, target, { kind: "load", place: target, type: target.type, span })
  }
  if (place.type.kind === "pointer") return lw.bail("pointer-value", "a pointer's value used as a number", span)
  if (place.type.kind === "interface")
    return lw.bail("interface-value", "an interface used other than to call through it, store it, or compare it with 0", span)
  const load: IrExpr = { kind: "load", place, type: place.type, span }
  const readAs = slotOf(lw, place)?.readAs
  // a BOOL held as its byte reads as its byte, marked for the operators that take one (`pointers/raw-bool.ts`)
  return readAs === undefined ? rawBoolLoad(lw, place, load) : convert(load, readAs)
}

/**
 * A NOT, SHIFT OR ROTATION OF A CONSTANT HELD PAST ITS TYPE (`IrSlot.declared`: `B : BYTE := KB + 1` held as 256) is a
 * constant expression CODESYS folds on the held value in the declared width — ROL(B, 1) 2, ROR(B, 1) 128, SHR(B, 1) 128,
 * NOT B 255 (`tr_a29_widened_constant_reads`, run; `tr_a29_rol_bound_widened_byte_constant`, both vendors; 6Af gate
 * review) — where the run-time read (DINT 256) rotated with the bits above the byte riding along (256) and NOT inverted
 * all 32 bits. So the front-end's fold (`constEval`) is its value, typed as the front-end types it. Null when `operand`
 * (`e`'s lowered operand) loads no such constant; undefined, reported, when the fold has no value for it.
 */
export function heldConstantOperation(lw: Lowering, e: Expr, operand: IrExpr): IrExpr | null | undefined {
  let held = false
  forEachExpr(operand, (x) => {
    if (x.kind === "load" && slotOf(lw, x.place)?.declared !== undefined) held = true
  })
  if (!held) return null
  const value = constEval(e, lw.scope)
  const type = inferExprType(e, lw.scope, lw.project)
  if (typeof value !== "bigint" || type.kind !== "elementary")
    return lw.bail("held-constant-operand", "a NOT, shift or rotation of a CONSTANT held past its type, with an operand that does not fold (unrecorded)", e.span)
  return { kind: "const", value, type, span: e.span }
}

/** The slot a place names WHOLE — a frame's, a routine's or a global's variable, or a field of what the path before it
 *  reaches — or undefined for an element or anything reached through a pointer. */
export function slotOf(lw: Lowering, place: Place): IrSlot | undefined {
  if (place.path.length === 0)
    return place.root === "local" ? lw.localSlots[place.slot] : place.root === "global" ? lw.shared.globals.slots[place.slot] : place.root === undefined ? lw.slots[place.slot] : undefined
  const last = place.path[place.path.length - 1]!
  if (last.kind !== "field") return undefined
  const along = typeAlong(lw, rootType(lw, place), place.path.slice(0, -1), { fields: "composite", element: "any" }, () => undefined)
  const owner = "type" in along ? along.type : undefined
  return owner !== undefined && (owner.kind === "struct" || owner.kind === "function_block") ? fieldOf(lw, owner.name, last.name) : undefined
}
