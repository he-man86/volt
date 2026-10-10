/**
 * The guards on a place's access: the checks a WRITE passes (`guardWrite`), a read of a value (`loadValue`).
 */

import type { Lowering } from "../core/lowering.js"
import type { IrExpr, Place } from "../../ir/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import { pointeePlace, selectThrough } from "../pointers/deref.js"
import { refuseUnionWrite } from "../storage/unions.js"
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
  lw.bail("inout-constant-write", `'${slot.name}' is a VAR_IN_OUT CONSTANT — no valid assignment target`, span)
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
    return target && { kind: "load", place: target, type: target.type, span }
  }
  if (place.type.kind === "pointer") return lw.bail("pointer-value", "a pointer's value used as a number", span)
  if (place.type.kind === "interface")
    return lw.bail("interface-value", "an interface used other than to call through it, store it, or compare it with 0", span)
  return { kind: "load", place, type: place.type, span }
}
