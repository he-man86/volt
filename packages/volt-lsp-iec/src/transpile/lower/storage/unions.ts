/**
 * UNION (conformance `type_dut_union`): every member overlays the same bytes from offset 0, little-endian — after
 * `iWord := 16#ABCD`, `aBytes[0]` reads 16#CD and `aBytes[1]` 16#AB. A union is laid out as a struct holding each member,
 * and a store into one member is followed by ONE assignment per other member — the stored member's bytes read at that
 * member's type (`IrReinterpret`, lean 7.8.4): `halves := reinterpret(whole)` — so every read stays a plain field read in
 * both backends. Only the measured kind of member is laid out: an integer, a bit string, a REAL or an LREAL, or a
 * one-dimensional array of them, with no initial value (`overlayBytes`). Any write that is not a plain `:=` — a
 * VAR_IN_OUT or output binding, a latch, a chain link, a FOR variable, an address taken — is refused: it would change one
 * member without the copy.
 *
 * A UNION OF POINTERS ONLY holds one integer in this model (design §9 form 1): every member is a copy of the one stored. It
 * stays one FIELD PER MEMBER, as every other union: the fields of a DUT struct are the emitted Rust's contract
 * (`emit/rust/index.ts`), so `u.pw` exists for a harness whichever member the program stored (gate 7.8d: a one-field
 * form dropped pro2193 `PointerSizesUnion`'s nine other members).
 */

import { elemOf, peelArray, type Type } from "../../../frontend/types/index.js"
import type { Lowering } from "../core/lowering.js"
import { sharedState } from "../core/shared.js"
import type { IrSlot, IrStmt, Place } from "../../ir/index.js"
import { fieldIn, rootType, typeAlong } from "../places/path.js"
import type { Span } from "../../../frontend/syntax/index.js"
import { assignTo } from "../values/convert.js"

/** The layouts that are a UNION's, by upper-cased name — their members overlay one another. Shared by every lowering
 *  of the POU. */
export const unionsOf = sharedState(() => new Set<string>())

/** A member's bytes: its whole size — undefined for a kind of member not measured. */
export function overlayBytes(t: Type): { size: number } | undefined {
  const array = t.kind === "array" && t.bounds?.length === 1 ? peelArray(t) : undefined
  const e = elemOf(array?.element ?? t)
  if (e === undefined || !(e.family === "bitstring" || e.family === "int" || e.family === "real") || e.bits < 8) return undefined
  return { size: (e.bits / 8) * (array?.length ?? 1) }
}

/** The union a place reaches into, and which member — undefined when no step of its path is a union's member. */
export function unionOf(lw: Lowering, place: Place): { union: Place; member: string } | undefined {
  // an index step reaches an `ARRAY[*]` in-out's element too (`any`) — the walk stopped there, so a union reached through
  // one was never overlaid
  const walked = typeAlong(lw, rootType(lw, place), place.path, { fields: "composite", element: "any" }, (step, type, i) => {
    if (type === undefined || step.kind === "bit") return null
    if (step.kind !== "field") return undefined
    if (type.kind !== "struct" && type.kind !== "function_block") return null
    return unionsOf(lw).has(type.name.toUpperCase()) ? { union: { ...place, path: place.path.slice(0, i), type }, member: step.name } : undefined
  })
  return "stopped" in walked ? (walked.stopped ?? undefined) : undefined
}

/** A place that is, or is inside, a union member — refused, for a write that cannot be followed by the copy. */
export function refuseUnionWrite(lw: Lowering, place: Place, span: Span, what = "a write into a UNION member other than a plain `:=`"): boolean {
  if (unionOf(lw, place) === undefined) return false
  lw.bail("union-write", what, span)
  return true
}

/** After a plain store into `target`: every other member, the member written read at its type — over its own value
 *  where it is the longer (`IrReinterpret`), or, in a union of pointers, a plain copy of it. Empty when the target is in
 *  no union; undefined, reported, when the copy cannot be made. */
export function unionCopies(lw: Lowering, target: Place, span: Span): IrStmt[] | undefined {
  const found = unionOf(lw, target)
  if (found === undefined) return []
  // ponytail: the copies re-evaluate the union's place, so a runtime index before it is refused rather than proven pure
  if (found.union.path.some((s) => s.kind === "index" && s.index.kind !== "const"))
    return lw.bail("union-write", "a store into a UNION member reached through a runtime index", span)
  const layout = lw.layouts.get((found.union.type as { name: string }).name.toUpperCase())!
  const member = (field: IrSlot): Place => ({ ...found.union, path: [...found.union.path, { kind: "field", name: field.name }], type: field.type })
  const written = fieldIn(layout.fields, found.member)!
  const from = member(written)
  const load = (p: Place) => ({ kind: "load" as const, place: p, type: p.type, span })
  // Every member of a union of POINTERs holds the same one integer (design §9 form 1), so the overlay is a plain copy —
  // and it must happen, or a member never written would read 0 and its dereference would fault on the null guard.
  if (layout.fields.every((f) => f.type.kind === "pointer")) return layout.fields.filter((f) => f !== written).map((f) => assignTo(member(f), load(from), span))
  const size = (f: IrSlot): number => overlayBytes(f.type)!.size
  return layout.fields
    .filter((f) => f !== written)
    .map((f) => {
      const to = member(f)
      // the member's own bytes past the stored one's stay: it is laid over them
      const over = size(f) > size(written) ? { over: load(to) } : {}
      return assignTo(to, { kind: "reinterpret", value: load(from), ...over, type: f.type, span }, span)
    })
}
