/**
 * Assignment: the store by the target's type, its chains and latches, a string's character, and the implicit
 * conversions CODESYS refuses.
 */

import type { Lowering } from "../core/lowering.js"
import { isSelfRef, type Span, type Statement } from "../../../frontend/syntax/index.js"
import type { IrExpr, IrStmt, Place } from "../../ir/index.js"
import { lowerExpr } from "../expressions/expressions.js"
import { lowerAccess, lowerPlace } from "../places/places.js"
import { FULL_WRITE, guardWrite } from "../places/access-guards.js"
import { assignTo, convert } from "../values/convert.js"
import { elementaryRef, elemOf, type Type } from "../../../frontend/types/index.js"
import { bindReference, storePointer } from "../pointers/store.js"
import { pointeePlace, storeThrough } from "../pointers/deref.js"
import { unionCopies } from "../storage/unions.js"
import { lowerQueryInterface } from "../interfaces/query.js"
import { storeInterface } from "../interfaces/tags.js"
import { lowerPropertySet } from "../calls/property.js"
import { registerWholeCopy } from "../calls/last-binding.js"
import { readTargets } from "../pointers/state.js"
import { tempPlace } from "../core/temps.js"
import { refuseCursorOverrun } from "../pointers/cursor.js"
import { escapesOf } from "../pointers/escape.js"
import { byteRun, imageRuns } from "../pointers/image.js"
import { ADDRESS, BASE_FIELD, offsetBy } from "../../semantics/index.js"

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
function lowerChain(lw: Lowering, s: Extract<Statement, { kind: "assign" }>): IrStmt[] | undefined {
  const targets = [s.target, ...(s.chained ?? [])]
  const ops = [s.op, ...(s.chainOps ?? [])] // ops[i] is the operator after targets[i]
  if (ops.includes("REF=")) return lw.bail("assign-op", "REF= in an assignment chain", s.span)
  const value = lowerExpr(lw, s.value)
  if (value === undefined) return undefined
  const held = tempPlace(lw, "chain_value", value.type, s.value.span)
  const out: IrStmt[] = [{ kind: "assign", target: held, value, span: s.value.span }]
  let flowing: IrExpr = { kind: "load", place: held, type: value.type, span: s.value.span }
  for (let i = targets.length - 1; i >= 0; i--) {
    const written = lowerPlace(lw, targets[i]!)
    const target = written === undefined ? undefined : guardWrite(lw, written, targets[i]!.span, ["open-array", ...FULL_WRITE])
    if (target === undefined) return undefined
    const op = ops[i]
    if (op === undefined) {
      if (refuseImplicitString(lw, flowing, target.type, s.span) || refuseCursorOverrun(lw, target, flowing.type, s.span)) return undefined
      flowing = convert(flowing, target.type) // a `:=` link converts the value on its way through
      out.push({ kind: "assign", target, value: flowing, span: s.span })
      continue
    }
    // a latch acts on the value and passes it on unchanged
    const latch: IrExpr = { kind: "const", value: op === "S=", type: elementaryRef("BOOL"), span: s.span }
    const set: IrStmt = assignTo(target, latch, s.span)
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
  // an `ARRAY[*]` is never stored whole (it is still BOUND whole to an in-out, which is no store, so not there)
  if (target === undefined || guardWrite(lw, target, s.span, ["open-array", "constant"]) === undefined) return undefined
  if (s.op === "S=" || s.op === "R=") return lowerLatch(lw, s, target)
  return storeValue(lw, s, target)
}

/** `s[i] := c` or a cursor's `p^ := c` — the string stored back with one character changed (`setchar`). */
function storeChar(lw: Lowering, s: Extract<Statement, { kind: "assign" }>, char: { place: Place; index: IrExpr; unit: Type }): IrStmt | undefined {
  const { place: text, index, unit } = char
  const c = lowerExpr(lw, s.value, unit)
  if (c === undefined || refuseImplicitString(lw, c, unit, s.span) || guardWrite(lw, text, s.span, ["constant"]) === undefined) return undefined
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
  const latched = guardWrite(lw, target, s.span, FULL_WRITE)
  if (latched === undefined) return undefined
  const set: IrStmt = assignTo(latched, latch, s.span)
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
    if (pointee === undefined || guardWrite(lw, pointee, s.span, ["constant"]) === undefined) return undefined
    const written = lowerExpr(lw, s.value, pointee.type)
    return written && assignTo(pointee, written, s.span)
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
  if (refuseImplicitString(lw, value, target.type, s.span) || refuseCursorOverrun(lw, target, value.type, s.span)) return undefined
  // AN INSTANCE WHOSE DATA THE IMAGE HOLDS, copied whole: its bytes move, its own region stays (`instanceCopy`)
  const imaged = instanceCopy(lw, target, value, s.span)
  if (imaged !== null) return imaged
  // A pointer that holds a TAG keeps its target FRAME-RELATIVE (`pointerKey`: `FB:<name>.<field>`), so an instance copied
  // whole would point at its OWN member where CODESYS copies the address and keeps the source's
  // (`tr_15_fb_copy_keeps_pointer_address`: rb=7, `b.p = ADR(a.x)`). A pointer that holds an address is copied as the
  // address it is (model 3); a tag's target outside the copied instance is not modelled: refused (transpile-review 15).
  if (holdsOwnAddress(lw, target.type))
    return lw.bail("copy-instance-pointer", "a whole-value store of an instance whose POINTER or REFERENCE field targets its own member — the copy would re-target it", s.span)
  registerWholeCopy(lw, target.type)
  const store: IrStmt = assignTo(target, value, s.span)
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
      ? (readTargets(lw, `FB:${name}.${f.name.toUpperCase()}`) ?? []).some((target) => target.base.root !== "global")
      : holdsOwnAddress(lw, f.type, seen),
  )
}

/**
 * `b := a` OF AN FB WHOSE DATA THE IMAGE HOLDS (model 3, design.md §3.3 step 4d; RC 15): the instance's struct is copied —
 * its pointers keep the addresses they hold, as CODESYS copies them (`tr_15`: `b.p = ADR(a.x)`) — but `b` keeps its own
 * region (`__base`), and then the bytes of every run of image fields move from `a`'s region into `b`'s. `null` when the
 * store is no such copy; refused (`copy-instance-pointer`) when the copy holds such an instance below its top — an
 * element, a field — whose region the struct copy would share.
 */
function instanceCopy(lw: Lowering, target: Place, value: IrExpr, span: Span): IrStmt[] | undefined | null {
  const escaped = escapesOf(lw).types
  const t = target.type
  const own = t.kind === "function_block" && escaped.has(t.name.toUpperCase())
  if (!own && !holdsEscaped(lw, t, escaped)) return null
  if (!own || value.kind !== "load" || [...(lw.layouts.get(t.name.toUpperCase())?.fields ?? [])].some((f) => holdsEscaped(lw, f.type, escaped)))
    return lw.bail("copy-instance-pointer", "a whole-value store of instances whose data lives in the byte image, held below the value's top", span)
  const runs = imageRuns(lw, t.name)
  if (runs === undefined) return lw.bail("layout-unmeasured", `${t.name}'s data has its address stored, and where it sits in an instance is not measured`, span)
  const base = (p: Place): Place => ({ ...p, path: [...p.path, { kind: "field", name: BASE_FIELD }], type: ADDRESS, span })
  const load = (p: Place): IrExpr => ({ kind: "load", place: p, type: p.type, span })
  const kept = tempPlace(lw, "base", ADDRESS, span)
  const bytes = runs.runs.map(([start, end]): IrStmt => {
    const at = (p: Place): Place => ({ slot: 0, root: "image", at: offsetBy(load(base(p)), start), path: [], type: byteRun(end - start), span })
    return { kind: "assign", target: at(target), value: load(at(value.place)), span }
  })
  return [
    { kind: "assign", target: kept, value: load(base(target)), span },
    assignTo(target, value, span),
    { kind: "assign", target: base(target), value: load(kept), span },
    ...bytes,
  ]
}

/**
 * A value stored whole into `target` by a call's argument — an FB's VAR_INPUT stored before the call, its VAR_OUTPUT read
 * with `=>` after it: an instance whose data the image holds is copied as `b := a` copies it (`instanceCopy`), so the
 * copy and its source never share one region (review 4d); anything else is the plain store.
 */
export function storeArgument(lw: Lowering, target: Place, value: IrExpr, span: Span): IrStmt[] | undefined {
  const imaged = instanceCopy(lw, target, value, span)
  return imaged === null ? [assignTo(target, value, span)] : imaged
}

/** Whether a value of `t` holds an instance of an escaped FB type, at any depth. */
function holdsEscaped(lw: Lowering, t: Type, escaped: ReadonlySet<string>, seen = new Set<string>()): boolean {
  if (t.kind === "array") return holdsEscaped(lw, t.element, escaped, seen)
  if (t.kind !== "struct" && t.kind !== "function_block") return false
  const name = t.name.toUpperCase()
  if (escaped.has(name) && t.kind === "function_block") return true
  if (seen.has(name)) return false
  seen.add(name)
  return (lw.layouts.get(name)?.fields ?? []).some((f) => f.section !== "VAR_STAT" && holdsEscaped(lw, f.type, escaped, seen))
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
