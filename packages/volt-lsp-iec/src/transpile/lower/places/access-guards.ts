/**
 * The guards on a place's access: through a reference, a write into a VAR_IN_OUT CONSTANT, a read of a value.
 */

import type { Lowering } from "../lowering.js"
import type { IrExpr, Place } from "../../ir/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import { pointeePlace, selectThrough } from "../pointers/deref.js"
import { refuseUnionWrite } from "../storage/unions.js"
import { refuseOpenArray } from "./bounds.js"

/**
 * A place WRITTEN through: a REFERENCE writes its target, as a read reads it; anything else is itself. Only a plain `:=`
 * went through a reference — an FB output (`inst(q => r)`), a VAR_IN_OUT binding, `S=`/`R=` and a chain link wrote the
 * reference's own slot, overwriting its stored index instead of the variable (transpiler review 2026-09-15).
 */
export function through(lw: Lowering, place: Place, span: Span): Place | undefined {
  // an interface's instances are recorded only by a plain `:=` (`storeInterface`)
  if (place.type.kind === "interface") return lw.bail("interface-store", "an interface stored by anything but a plain `:=`", span)
  const written = place.type.kind === "reference" ? pointeePlace(lw, place, undefined, span) : place
  return written === undefined || refuseUnionWrite(lw, written, span) || refuseConstantWrite(lw, written, span) ? undefined : written
}

/**
 * A store into a VAR_IN_OUT CONSTANT — "'value' is no valid assignment target" (conformance `inout_const_write_5`, a `:=`):
 * refused however it is written — a store, a latch, a chain link, an output, a FOR variable, an input stored into a lent
 * instance, a store through a pointer or reference to it (its address may be taken, `inout_const_adr_11`, and read).
 * Only the `:=` is recorded; the rest are refused as the stores they are, not claimed as the compiler's.
 */
export function refuseConstantWrite(lw: Lowering, place: Place, span: Span): boolean {
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
