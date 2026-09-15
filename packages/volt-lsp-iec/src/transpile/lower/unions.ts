/**
 * UNION (conformance `type_dut_union`): every member overlays the same bytes from offset 0, little-endian — after
 * `iWord := 16#ABCD`, `aBytes[0]` reads 16#CD and `aBytes[1]` 16#AB. A union is laid out as a struct holding each member,
 * and a store into one member is followed by copying its bytes into every other, so every read stays a plain field read
 * in both backends. Only the measured kind of member is laid out: an unsigned integer or bit string, or a one-dimensional
 * array of them, with no initial value. Any write that is not a plain `:=` — a VAR_IN_OUT or output binding, a latch, a
 * chain link, a FOR variable, an address taken — is refused: it would change one member without the copy.
 */
import type { Span } from "../../syntax/index.js"
import { elementaryRef, elemOf, type Type } from "../../types/index.js"
import { elementOf, type IrExpr, type IrStmt, peelArray, type Place } from "../ir/index.js"
import type { Lowering } from "./lowering.js"
import { binaryOf, convert } from "./convert.js"
import { rootType } from "./bytes.js"

/** A member's bytes, as `count` elements of `size` bytes — undefined for a kind of member not measured. */
export function overlayBytes(t: Type): { count: number; size: number; element: Type; array?: { lower: bigint; length: number } } | undefined {
  const array = t.kind === "array" && t.bounds?.length === 1 ? peelArray(t) : undefined
  const element = array?.element ?? t
  const e = element.kind === "elementary" ? elemOf(element) : undefined
  if (e === undefined || !(e.family === "bitstring" || e.family === "int") || e.signed || e.bits < 8) return undefined
  return { count: array?.length ?? 1, size: e.bits / 8, element, ...(array === undefined ? {} : { array: { lower: array.lower, length: array.length } }) }
}

/** The union a place reaches into, and which member — undefined when no step of its path is a union's member. */
export function unionOf(lw: Lowering, place: Place): { union: Place; member: string } | undefined {
  let type = rootType(lw, place)
  for (const [i, step] of place.path.entries()) {
    if (type === undefined) return undefined
    if (step.kind === "field") {
      if (type.kind !== "struct" && type.kind !== "function_block") return undefined
      if (lw.shared.unions.has(type.name.toUpperCase())) return { union: { ...place, path: place.path.slice(0, i), type }, member: step.name }
      type = lw.layouts.get(type.name.toUpperCase())?.fields.find((f) => f.name.toUpperCase() === step.name.toUpperCase())?.type
    // an `ARRAY[*]` in-out's element too — the walk stopped there, so a union reached through one was never overlaid
    } else if (step.kind === "index") type = elementOf(type)
    else return undefined
  }
  return undefined
}

/** A place that is, or is inside, a union member — refused, for a write that cannot be followed by the copy. */
export function refuseUnionWrite(lw: Lowering, place: Place, span: Span): boolean {
  if (unionOf(lw, place) === undefined) return false
  lw.bail("union-write", "a write into a UNION member other than a plain `:=`", span)
  return true
}

/** After a plain store into `target`: every other member's overlapping bytes, copied from the member written. Empty when
 *  the target is in no union; undefined, reported, when the copy cannot be made. */
export function unionCopies(lw: Lowering, target: Place, span: Span): IrStmt[] | undefined {
  const found = unionOf(lw, target)
  if (found === undefined) return []
  // ponytail: the copies re-evaluate the union's place, so a runtime index before it is refused rather than proven pure
  if (found.union.path.some((s) => s.kind === "index" && s.index.kind !== "const"))
    return lw.bail("union-write", "a store into a UNION member reached through a runtime index", span)
  const layout = lw.layouts.get((found.union.type as { name: string }).name.toUpperCase())!
  const ulint = elementaryRef("ULINT")
  const lint = elementaryRef("LINT")
  const k = (v: bigint): IrExpr => ({ kind: "const", value: v, type: ulint, span })
  const load = (p: Place): IrExpr => convert({ kind: "load", place: p, type: p.type, span }, ulint)
  const member = (name: string) => {
    const field = layout.fields.find((f) => f.name.toUpperCase() === name.toUpperCase())!
    const place: Place = { ...found.union, path: [...found.union.path, { kind: "field", name: field.name }], type: field.type }
    return { place, bytes: overlayBytes(field.type)! }
  }
  // the element of a member holding its byte `n`, and where in that element the byte sits
  const byteAt = (m: ReturnType<typeof member>, n: number): { place: Place; shift: number } => {
    const i = Math.floor(n / m.bytes.size)
    const array = m.bytes.array
    const place: Place =
      array === undefined
        ? m.place
        : { ...m.place, path: [...m.place.path, { kind: "index", index: { kind: "const", value: BigInt(i) + array.lower, type: lint, span }, lower: array.lower, length: array.length }], type: m.bytes.element }
    return { place, shift: n - i * m.bytes.size }
  }
  const from = member(found.member)
  const out: IrStmt[] = []
  for (const field of layout.fields) {
    if (field.name.toUpperCase() === found.member.toUpperCase()) continue
    const to = member(field.name)
    const overlap = Math.min(from.bytes.count * from.bytes.size, to.bytes.count * to.bytes.size)
    for (let n = 0; n < overlap; n++) {
      const src = byteAt(from, n)
      const dst = byteAt(to, n)
      const byte = binaryOf("mod", binaryOf("div", load(src.place), k(256n ** BigInt(src.shift)), ulint, span), k(256n), ulint, span)
      // the element with that one byte replaced: the bytes below it, the new byte, the bytes above it — none overflows
      const unit = 256n ** BigInt(dst.shift)
      let value = binaryOf("mul", byte, k(unit), ulint, span)
      if (dst.shift > 0) value = binaryOf("add", binaryOf("mod", load(dst.place), k(unit), ulint, span), value, ulint, span)
      if (dst.shift + 1 < to.bytes.size) {
        const above = binaryOf("mul", binaryOf("div", load(dst.place), k(unit * 256n), ulint, span), k(unit * 256n), ulint, span)
        value = binaryOf("add", value, above, ulint, span)
      }
      out.push({ kind: "assign", target: dst.place, value: convert(value, dst.place.type), span })
    }
  }
  return out
}
