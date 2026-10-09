/**
 * Places — where a name, a field, an element or a bit lives: in the frame, a local, a VAR_IN_OUT, or the globals.
 */

import type { Lowering } from "../core/lowering.js"
import { type Expr, isSelfRef, selfRefKind, type Span } from "../../../frontend/syntax/index.js"
import type { Access, IrExpr, Place } from "../../ir/index.js"
import { imageStep } from "../../semantics/index.js"
import { imageType } from "../pointers/escape.js"
import { lookup } from "../../../frontend/symbols/index.js"
import { listVariableShadows, qualifiedGlobal } from "./globals.js"
import { pointeePlace, throughReference } from "../pointers/deref.js"
import { addressPlace } from "../storage/addresses.js"
import { namePlace } from "./names.js"
import { elementaryRef, elementOf, peelArray, type Type } from "../../../frontend/types/index.js"
import { boundOf } from "./bounds.js"
import { binaryOf } from "../core/build.js"
import { convert } from "../values/convert.js"
import { cursorChar, cursorString, cursorStringChar } from "../pointers/cursor.js"
import { lowerExpr } from "../expressions/expressions.js"
import { pointerFrame } from "../pointers/state.js"
import { fieldIn } from "./path.js"

export function lowerPlace(lw: Lowering, e: Expr, notAMember = "place-shape"): Place | undefined {
  if (e.kind === "member") {
    if (/^\d+$/.test(e.member.name)) return bitPlace(lw, e, notAMember)
    if (e.base.kind === "ident_expr" && !lw.holds(e.base.name) && lookup(lw.scope, e.base.name)?.symbol.kind === "gvl_block" && !listVariableShadows(lw, e.base.name, e.member.name))
      return qualifiedGlobal(lw, e.base.name, e.member.name, e.span)
    // a struct's field or an instance's variable: one `field` step on the base place (design §9)
    const base = throughReference(lw, lowerPlace(lw, e.base, notAMember), e.base.span)
    if (base === undefined) return undefined
    const layout = base.type.kind === "struct" || base.type.kind === "function_block" ? lw.layouts.get(base.type.name.toUpperCase()) : undefined
    const field = fieldIn(layout?.fields, e.member.name)
    if (field === undefined) return lw.bail(notAMember, "member access is not lowered yet", e.span)
    return step(lw, base, { kind: "field", name: field.name }, field.type, e.span)
  }
  if (e.kind === "index" || (e.kind === "deref" && !isSelfRef(e))) {
    const indexed = lowerAccess(lw, e, notAMember)
    if (indexed === undefined || "place" in indexed) return indexed?.place
    // `ADR(s[i])`, an in-out bound to it, `s[i] S= …`: a character is read out of a string value and stored back into
    // one (`char`/`setchar`), never a location of its own
    return lw.bail("place-shape", "a character of a string used as a storage location", e.span)
  }
  // `THIS^` — the instance the body runs on (conformance `keyword_this_dereference`, `use_self_method_call`). `SUPER^` is
  // no place of its own: `SUPER^()` and `SUPER^.M()` are calls, lowered in `calls.ts`.
  if (e.kind === "deref" && isSelfRef(e) && e.base.kind === "ident_expr" && selfRefKind(e.base.name) === "THIS" && lw.selfType !== undefined) {
    // a PROGRAM lowered as its one instance has a self type too, but CODESYS refuses THIS there (`fbcall_this_in_program`)
    if (lw.selfType.kind === "function_block" && lw.bodies.get(lw.selfType.name.toUpperCase())?.unit.kind === "program")
      return lw.bail("this-in-program", "THIS in a PROGRAM, which CODESYS does not compile", e.span)
    return { slot: 0, path: [], type: lw.selfType, span: e.span, root: "this" }
  }
  // `%IB8` / `%MW30` written with no variable on it — the process image itself (`addressPlace`, conformance
  // `ca_direct_address_expression`). It is a place, readable and writable, exactly as an `AT` variable is.
  if (e.kind === "literal" && e.literalKind === "address") return addressPlace(lw, e.text, e.span)
  if (e.kind !== "ident_expr")
    return lw.bail("place-shape", `${e.kind} is not a lowerable storage location yet`, e.span)
  return namePlace(lw, e)
}

/**
 * An index or a dereference, lowered ONCE: an array element, a pointer's `p[i]` or `p^` is a place; `s[i]` on a STRING
 * or WSTRING is a character — its string's place, the index, and the character's type (a BYTE, a WSTRING's WORD) — which
 * a read turns into `char` and a store into `setchar`. So is `p^` or `p[i]` on a STRING CURSOR (`cursorChar`). It is what the Standard library's string functions are written in
 * (`libraries/Standard`). One walk decides both, so the base is never lowered twice (a probe that did, and threw its
 * diagnostics away, also threw away a GVL's declaration errors and the refusal of a call inside the index).
 */
export type Indexed = { place: Place } | { char: { place: Place; index: IrExpr; unit: Type } }

export function lowerAccess(lw: Lowering, e: Extract<Expr, { kind: "index" | "deref" }>, notAMember?: string): Indexed | undefined {
  if (e.kind === "deref") {
    const pointer = lowerPlace(lw, e.base, notAMember)
    if (pointer === undefined) return undefined
    const char = cursorChar(lw, pointer, undefined, e.span)
    if (char !== null) return { char }
    const whole = cursorString(lw, pointer, e.span)
    if (whole === null) return undefined
    if (whole !== undefined) return { place: whole }
    if (pointer.type.kind !== "pointer") return lw.bail("place-shape", "a dereference of something that is not a pointer", e.span)
    const pointee = pointeePlace(lw, pointer, undefined, e.span)
    return pointee && { place: pointee }
  }
  // `p^[i]` on a POINTER TO STRING cursor: a character counted from where the cursor stands, not from the string's start
  // (a cursor is a bare parameter, so its name decides before anything is lowered — nothing is lowered twice)
  if (e.base.kind === "deref" && e.base.base.kind === "ident_expr" && pointerFrame(lw).cursors.has(e.base.base.name.toUpperCase()) && e.indices.length === 1) {
    const pointer = lowerPlace(lw, e.base.base, notAMember)
    const i = pointer && lowerExpr(lw, e.indices[0]!)
    if (pointer === undefined || i === undefined) return undefined
    const char = cursorStringChar(lw, pointer, i, e.span)
    if (char !== null) return { char }
    return lw.bail("place-shape", "an index on a character cursor's character", e.span)
  }
  let place = throughReference(lw, lowerPlace(lw, e.base, notAMember), e.base.span)
  // `s[i]` on a STRING or WSTRING — one character, a BYTE (a WSTRING's WORD), counted from 0
  const text = place?.type.kind === "elementary" && (place.type.name === "STRING" || place.type.name === "WSTRING") ? place.type.name : undefined
  if (place !== undefined && text !== undefined) {
    if (e.indices.length !== 1) return lw.bail("place-shape", "a string indexed in more than one dimension", e.span)
    const index = lowerExpr(lw, e.indices[0]!)
    // the capacity is what `s[i]` is bounded by; every string place carries one (`Lowering.resolve`, `storageOf`)
    return index && { char: { place, index, unit: elementaryRef(text === "STRING" ? "BYTE" : "WORD") } }
  }
  // `p[i]` on a pointer: i elements past the one it points at (conformance `mem_pointer_index_struct_array`)
  if (place !== undefined && place.type.kind === "pointer") {
    if (e.indices.length !== 1) return lw.bail("pointer-index", "a pointer indexed in more than one dimension", e.span)
    const extra = lowerExpr(lw, e.indices[0]!)
    if (extra === undefined) return undefined
    const char = cursorChar(lw, place, extra, e.span)
    if (char !== null) return { char }
    const pointee = pointeePlace(lw, place, extra, e.span)
    return pointee && { place: pointee }
  }
  // an array: one `index` step per dimension, each carrying the bounds a backend normalises by
  for (const written of e.indices) {
    if (place === undefined) return undefined
    const array = peelArray(place.type)
    // an `ARRAY[*]` in-out's dimension: indexed from the lower bound its call was handed (design §26)
    const open =
      array === undefined && place.type.kind === "array" && place.root === "inout" && place.path.every((s) => s.kind === "index")
        ? boundOf(lw, { ...place, path: [], type: lw.inoutSlots[place.slot]!.type }, "lower", place.path.length + 1)
        : undefined
    if (array === undefined && open === undefined) return lw.bail("place-shape", "an index on something that is not a sized array", e.span)
    const index = lowerExpr(lw, written)
    if (index === undefined) return undefined
    if (open !== undefined) {
      const wide = elementaryRef("LINT")
      const offset = binaryOf("sub", convert(index, wide), convert(open, wide), wide, written.span)
      place = { ...place, path: [...place.path, { kind: "index", index: offset, lower: 0n }], type: elementOf(place.type)!, span: e.span }
      continue
    }
    place = step(lw, place, { kind: "index", index, lower: array!.lower, length: array!.length }, array!.element, e.span)
  }
  return place && { place }
}

/** One more step on a place, reaching `type` — on a place in the byte image, folded into its address (`imageStep`). */
function step(lw: Lowering, base: Place, access: Access, type: Type, span: Span): Place {
  if (base.root !== "image") return { ...base, path: [...base.path, access], type, span }
  imageType(lw, base.type)
  return { ...imageStep(base, access, base.type, lw.layouts), type, span }
}

/**
 * `x.3` on a local integer — one bit of one slot, readable and writable (design §14): two's complement, so
 * `im1.15` with `im1 : INT := -1` is TRUE and `i0.15 := TRUE` makes -32768. Any other dotted name is a struct or
 * instance member, which waits on the memory model (§9) — it keeps the counted code the caller passes, so the
 * coverage report's categories do not shift under it.
 */
function bitPlace(lw: Lowering, e: Extract<Expr, { kind: "member" }>, notABit: string): Place | undefined {
  const index = Number(e.member.name)
  const base = lowerPlace(lw, e.base, notABit)
  if (base === undefined) return undefined
  // A bit of something that is not an integer says what it is instead: `slice.0` with `slice : REFERENCE TO BYTE`
  // (pro2193 MapperInputs.pou) is aliasing — phase 4 — and a `bit-index` there sent the reader to the wrong phase.
  if (base.type.kind !== "elementary") return lw.bail(`bit-on-${base.type.kind}`, `bit ${index} of a ${base.type.kind}`, e.span)
  const t = base.type.elem
  if (t.rank === undefined || (t.family !== "int" && t.family !== "bitstring") || index >= t.bits)
    return lw.bail("bit-index", `bit ${index} of a ${t.name}`, e.span)
  return { ...base, path: [...base.path, { kind: "bit", index, of: base.type }], type: elementaryRef("BOOL"), span: e.span }
}
