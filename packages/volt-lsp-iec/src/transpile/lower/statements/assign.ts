/**
 * Assignment: the store by the target's type, its chains and latches, a string's character, and the implicit
 * conversions CODESYS refuses.
 */

import type { Lowering } from "../lowering.js"
import { isSelfRef, type Span, type Statement } from "../../../frontend/syntax/index.js"
import type { IrExpr, IrStmt, Place } from "../../ir/index.js"
import { lowerExpr } from "../expressions/expressions.js"
import { lowerAccess, lowerPlace } from "../places/places.js"
import { refuseOpenArray } from "../places/bounds.js"
import { refuseConstantWrite, through } from "../places/access-guards.js"
import { convert } from "../values/convert.js"
import { elementaryRef, elemOf, type Type } from "../../../frontend/types/index.js"
import { bindReference, storePointer } from "../pointers/store.js"
import { pointeePlace, storeThrough } from "../pointers/deref.js"
import { unionCopies } from "../storage/unions.js"
import { lowerQueryInterface } from "../interfaces/query.js"
import { storeInterface } from "../interfaces/tags.js"
import { lowerPropertySet } from "../calls/property.js"
import { registerWholeCopy } from "../calls/last-binding.js"

/**
 * An assignment CHAIN — `a := b := c`, `a S= b R= c`, `a := b S= c`. One rule fits every chain measured
 * (conformance `set_reset_chained*`, `assign_chained_*`): the VALUE flows right to left, converted to each link's
 * type as it passes; a `:=` link stores it, and an `S=`/`R=` link latches its target on it and passes it on UNCHANGED.
 *   - `a S= b R= c` with b FALSE, c TRUE SETS `a` — it latches on `c`, not on the old or new `b`;
 *   - `plain := latch S= cond` with cond FALSE makes `plain` FALSE even though `latch` stays TRUE;
 *   - `sint := dint := int` does not compile, "Cannot convert type 'DINT' to type 'SINT'" — `sint` receives the value
 *     as converted THROUGH the DINT link, not the INT source.
 * The value is evaluated ONCE, into a temp, so a call in it cannot run twice.
 */
export function lowerChain(lw: Lowering, s: Extract<Statement, { kind: "assign" }>): IrStmt[] | undefined {
  const targets = [s.target, ...(s.chained ?? [])]
  const ops = [s.op, ...(s.chainOps ?? [])] // ops[i] is the operator after targets[i]
  if (ops.includes("REF=")) return lw.bail("assign-op", "REF= in an assignment chain", s.span)
  const value = lowerExpr(lw, s.value)
  if (value === undefined) return undefined
  const held = lw.tempPlace("chain_value", value.type, s.value.span)
  const out: IrStmt[] = [{ kind: "assign", target: held, value, span: s.value.span }]
  let flowing: IrExpr = { kind: "load", place: held, type: value.type, span: s.value.span }
  for (let i = targets.length - 1; i >= 0; i--) {
    const written = lowerPlace(lw, targets[i]!)
    const target = written === undefined || refuseOpenArray(lw, written, targets[i]!.span) ? undefined : through(lw, written, targets[i]!.span)
    if (target === undefined) return undefined
    const op = ops[i]
    if (op === undefined) {
      if (refuseImplicitString(lw, flowing, target.type, s.span)) return undefined
      flowing = convert(flowing, target.type) // a `:=` link converts the value on its way through
      out.push({ kind: "assign", target, value: flowing, span: s.span })
      continue
    }
    // a latch acts on the value and passes it on unchanged
    const latch: IrExpr = { kind: "const", value: op === "S=", type: elementaryRef("BOOL"), span: s.span }
    const set: IrStmt = { kind: "assign", target, value: convert(latch, target.type), span: s.span }
    out.push({ kind: "if", cond: convert(flowing, elementaryRef("BOOL")), then: [set], else: [], span: s.span })
  }
  return out
}

/** An assignment: a PROPERTY's setter, a `__QUERYINTERFACE`, a chain, `REF=`, a multi-target pointer's write, a string's
 *  character, a latch, or a store into the place. */
export function lowerAssign(lw: Lowering, s: Extract<Statement, { kind: "assign" }>): IrStmt | IrStmt[] | undefined {
  // a PROPERTY's setter (conformance `state_property_get_set`)
  const property = lowerPropertySet(lw, s)
  if (property !== null) return property
  const query = lowerQueryInterface(lw, s)
  if (query !== null) return query
  if (s.chained !== undefined) return lowerChain(lw, s)
  if (s.op === "REF=") return bindReference(lw, s)
  // FORM 3's WRITE. A pointer naming several variables has no single place to store into, so the assignment is
  // an `IrSwitch` on its tag with one arm per target — the statement counterpart of the read's `IrSelect`, and
  // no new IR. Measured: `ptrhandle_write_either_target` picks its target in an IF and the 99 lands in b.
  const scattered = storeThrough(lw, s)
  if (scattered !== null) return scattered
  const indexed = (s.target.kind === "index" || (s.target.kind === "deref" && !isSelfRef(s.target))) && s.op === undefined ? lowerAccess(lw, s.target) : { place: lowerPlace(lw, s.target) }
  if (indexed === undefined) return undefined
  if ("char" in indexed) return storeChar(lw, s, indexed.char)
  const target = indexed.place
  // an `ARRAY[*]` is never stored whole (it is still BOUND whole to an in-out, which `through` checks, so not there)
  if (target === undefined || refuseOpenArray(lw, target, s.span) || refuseConstantWrite(lw, target, s.span)) return undefined
  if (s.op === "S=" || s.op === "R=") return lowerLatch(lw, s, target)
  return storeValue(lw, s, target)
}

/** `s[i] := c` or a cursor's `p^ := c` — the string stored back with one character changed (`setchar`). */
function storeChar(lw: Lowering, s: Extract<Statement, { kind: "assign" }>, char: { place: Place; index: IrExpr; unit: Type }): IrStmt | undefined {
  const { place: text, index, unit } = char
  const c = lowerExpr(lw, s.value, unit)
  if (c === undefined || refuseImplicitString(lw, c, unit, s.span) || refuseConstantWrite(lw, text, s.span)) return undefined
  const load: IrExpr = { kind: "load", place: text, type: text.type, span: s.span }
  const value: IrExpr = { kind: "builtin", name: "setchar", args: [load, index, convert(c, unit)], type: text.type, span: s.span }
  return { kind: "assign", target: text, value, span: s.span }
}

/** `x S= c` / `x R= c`: a LATCH, not an assignment — the IF it is. */
function lowerLatch(lw: Lowering, s: Extract<Statement, { kind: "assign" }>, target: Place): IrStmt | undefined {
  // A LATCH, not an assignment: `x S= c` sets x only when c is TRUE and otherwise leaves it — `latched := TRUE;
  // latched S= FALSE` stays TRUE — and `R=` clears the same way. The whole right-hand side is the condition:
  // `x S= (i > 5) AND flag` (conformance `set_reset_*`). So it lowers to the IF it is; no backend sees an `S=`.
  const cond = lowerExpr(lw, s.value, elementaryRef("BOOL"))
  if (cond === undefined) return undefined
  const latch: IrExpr = { kind: "const", value: s.op === "S=", type: elementaryRef("BOOL"), span: s.span }
  const latched = through(lw, target, s.span)
  if (latched === undefined) return undefined
  const set: IrStmt = { kind: "assign", target: latched, value: convert(latch, latched.type), span: s.span }
  return { kind: "if", cond, then: [set], else: [], span: s.span }
}

/** A store into a place, by its type: a pointer (and the union members it overlays), an interface's tag, a reference's
 *  target, or a value — never a STRING implicitly into a number, never an instance whose pointer targets its own member. */
function storeValue(lw: Lowering, s: Extract<Statement, { kind: "assign" }>, target: Place): IrStmt | IrStmt[] | undefined {
  if (target.type.kind === "pointer") {
    const stored = storePointer(lw, target, s.value, s.span)
    // a pointer stored into one member of a union of pointers overlays the others (`unions.ts`)
    const overlaid = stored === undefined ? undefined : unionCopies(lw, target, s.span)
    return stored === undefined || overlaid === undefined ? undefined : [stored, ...overlaid]
  }
  if (target.type.kind === "interface") return storeInterface(lw, target, s.value, s.span)
  if (target.type.kind === "reference") {
    // a write through a reference is a write to its target
    const pointee = pointeePlace(lw, target, undefined, s.span)
    if (pointee === undefined || refuseConstantWrite(lw, pointee, s.span)) return undefined
    const written = lowerExpr(lw, s.value, pointee.type)
    return written && { kind: "assign", target: pointee, value: convert(written, pointee.type), span: s.span }
  }
  const value = lowerExpr(lw, s.value, target.type)
  if (value === undefined) return undefined
  // A STRING DOES NOT IMPLICITLY BECOME A NUMBER. CODESYS rejects `i := 'a$Tb'` outright — "Cannot convert type
  // 'STRING(INT#4)' to type 'INT'" (`literal_string_to_int_assignment`, `cc_init_string_into_int`,
  // `cc_string_escape_literal_into_int`) — but this lowered it, and the EMITTER then threw ("no Rust mapping for a
  // string type without a capacity") while the interpreter parsed leading digits. Invalid input has to end in a
  // diagnostic here; an emitter throw is not one, and two backends disagreeing about invalid input is worse.
  //
  // Only the IMPLICIT store is refused. `STRING_TO_INT('123')` is an explicit conversion and stays, which is the
  // whole difference CODESYS draws.
  if (refuseImplicitString(lw, value, target.type, s.span)) return undefined
  // A pointer target is kept FRAME-RELATIVE (`pointerKey`: `FB:<name>.<field>`), so an instance copied whole would
  // point at its OWN member where CODESYS copies the address and keeps the source's (`tr_15_fb_copy_keeps_pointer_address`:
  // rb=7, `b.p = ADR(a.x)`). A target outside the copied instance is not modelled: refused (transpile-review 15).
  if (holdsOwnAddress(lw, target.type))
    return lw.bail("copy-instance-pointer", "a whole-value store of an instance whose POINTER or REFERENCE field targets its own member — the copy would re-target it", s.span)
  registerWholeCopy(lw, target.type)
  const store: IrStmt = { kind: "assign", target, value: convert(value, target.type), span: s.span }
  // a UNION member's store, then its bytes into the members it overlays
  const copies = unionCopies(lw, target, s.span)
  return copies && [store, ...copies]
}

/** Whether a value of `t` holds an FB whose POINTER or REFERENCE field has a target that is not a global — a target kept
 *  relative to the instance, which a whole-value copy would re-target (transpile-review 15). */
function holdsOwnAddress(lw: Lowering, t: Type, seen = new Set<string>()): boolean {
  if (t.kind === "array") return holdsOwnAddress(lw, t.element, seen)
  if (t.kind !== "struct" && t.kind !== "function_block") return false
  const name = t.name.toUpperCase()
  if (seen.has(name)) return false
  seen.add(name)
  return (lw.layouts.get(name)?.fields ?? []).some((f) =>
    f.type.kind === "pointer" || f.type.kind === "reference"
      ? (lw.shared.pointers.get(`FB:${name}.${f.name.toUpperCase()}`) ?? []).some((target) => target.base.root !== "global")
      : holdsOwnAddress(lw, f.type, seen),
  )
}

/**
 * A STRING or WSTRING converted IMPLICITLY into anything but itself, or anything converted implicitly into one — which
 * CODESYS refuses; true when refused. Both string kinds are isolated: `n := '12'` is "Cannot convert type 'STRING(INT#2)'
 * to type 'INT'", `s[0] := 'X'` stores a STRING into a character, `intoWide := narrow` is "Cannot convert type 'STRING'
 * to type 'WSTRING'" (`string_wstring_mixing`) and `out := -r` into a STRING is "Cannot convert type 'REAL' to type
 * 'STRING'" (`uop_*`). This refused only the first two, so the rest lowered to a conversion no vendor makes (transpile-review
 * 38). Every implicit store asks it — an assignment, a chain link, an input argument; the explicit X_TO_Y stays legal.
 * A side that is not elementary (a struct, an FB) is not this question.
 */
export function refuseImplicitString(lw: Lowering, value: IrExpr, target: Type, span: Span): boolean {
  const from = elemOf(value.type)
  const to = elemOf(target)
  if (from === undefined || to === undefined || (from.family !== "string" && to.family !== "string") || from.name === to.name) return false
  lw.bail("assign-string", `a ${from.name} converted implicitly to a ${to.name}, which is not a conversion the vendor makes implicitly`, span)
  return true
}
