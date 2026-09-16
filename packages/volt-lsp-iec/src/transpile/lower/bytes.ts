/**
 * The measured byte layout — SIZEOF and the difference of two addresses in one variable.
 */
import type { Expr } from "../../syntax/index.js"
import { lookup } from "../../symbols/index.js"
import { elementaryRef, resolveNamedType, type Type } from "../../types/index.js"
import { type IrExpr, peelArray, type Place } from "../ir/index.js"
import { baseOf, type Lowering } from "./lowering.js"
import { storageOf } from "./storage.js"
import { lowerPlace } from "./places.js"

/** The type a place's root holds — where a byte offset along its path starts. */
export function rootType(lw: Lowering, place: Place): Type | undefined {
  switch (place.root) {
    case "local":
      return lw.localSlots[place.slot]?.type
    case "inout":
      return lw.inoutSlots[place.slot]?.type
    case "global":
      return lw.shared.globals.slots[place.slot]?.type
    case "this":
      return lw.selfType
    default:
      return lw.slots[place.slot]?.type
  }
}

/**
 * A stored type's byte size and alignment, as the 64-bit simulator lays it out (conformance `mem_sizeof_*`,
 * `mem_member_offsets`): an integer, REAL, TIME or date its bit width in bytes, aligned to it; a BOOL one byte; a STRING(n)
 * n + 1 (the terminator); an array whole elements; a struct its fields (`fieldBytes`). Undefined for anything unmeasured:
 * a BIT (packed with its neighbours), a WSTRING, a pointer or a reference.
 */
export function byteSize(lw: Lowering, t: Type): { size: bigint; align: bigint } | undefined {
  if (t.kind === "elementary") {
    const e = t.elem
    if (e.name === "BIT") return undefined
    if (e.family === "bool") return { size: 1n, align: 1n }
    if (e.family === "string") return e.name === "STRING" && t.length !== undefined ? { size: BigInt(t.length) + 1n, align: 1n } : undefined
    if (["int", "bitstring", "real", "time", "date"].includes(e.family) && e.bits >= 8) return { size: BigInt(e.bits / 8), align: BigInt(e.bits / 8) }
    return undefined
  }
  const array = peelArray(t)
  if (array !== undefined) {
    const element = byteSize(lw, array.element)
    return element && { size: element.size * BigInt(array.length), align: element.align }
  }
  return t.kind === "struct" || t.kind === "function_block" ? fieldBytes(lw, t) : undefined
}

/**
 * A struct's size, alignment and each field's offset: every field aligned to its own alignment, the whole padded to the
 * widest (`b BYTE; i INT; d DINT; x BOOL; l LREAL` is offsets 0/2/4/8/16, size 24). An FB instance also carries a
 * pointer-sized header (`b BYTE; d DINT` is 16), and where it sits is not measured — so an FB has a size but its fields
 * have no offset. VAR_TEMP and VAR_STAT are not instance storage, and neither are lowering's own temps. Undefined for a
 * derived type (where its base's part and header sit) and an FB with VAR_IN_OUT (the in-out is stored in the instance,
 * not in `fields`) — neither measured; both were answered as if absent (transpiler review 2026-09-15).
 */
export function fieldBytes(lw: Lowering, t: Extract<Type, { kind: "struct" | "function_block" }>): { size: bigint; align: bigint; offsets?: Map<string, bigint> } | undefined {
  const layout = lw.layouts.get(t.name.toUpperCase())
  // a UNION's size (its widest member, aligned?) is not measured
  if (layout === undefined || lw.shared.unions.has(t.name.toUpperCase())) return undefined
  const pending = lw.bodies.get(t.name.toUpperCase())
  if (pending !== undefined && (baseOf(pending.unit) !== undefined || pending.unit.varSections.some((s) => s.sectionKind === "VAR_IN_OUT"))) return undefined
  const decl = t.kind === "struct" ? lookup(lw.project, t.name)?.symbol.ast : undefined
  if (decl?.kind === "type_decl" && decl.body.kind === "struct" && decl.body.extends !== undefined) return undefined
  // A METHOD's VAR_INST is storage in the instance, laid out as a field only once the method lowers — where it sits is not
  // measured, and a SIZEOF taken before and after that call would differ. Refused while any method of the FB declares one.
  for (let s = t.kind === "function_block" ? t.scope : undefined; s !== undefined; s = s.baseScope)
    for (const list of s.symbols.values())
      if (list.some((sym) => sym.kind === "method" && (sym.ast as { varSections?: readonly { sectionKind: string }[] }).varSections?.some((v) => v.sectionKind === "VAR_INST"))) return undefined
  const isFb = t.kind === "function_block"
  let offset = isFb ? 8n : 0n
  let align = isFb ? 8n : 1n
  const offsets = new Map<string, bigint>()
  // Consecutive BIT fields PACK, eight to a byte; anything else ends the run, and a BIT after one starts a fresh byte.
  // Measured (conformance `ct_bit_packing_sizes`): one BIT is 1 and eight are 1, nine are 2, a BYTE then a BIT is 2, a
  // BIT then an INT is 4 (the bit takes its byte, the INT aligns to 2), and BIT·BYTE·BIT is 3 — the second bit does not
  // go back into the first byte. A BOOL is a whole byte either way, so two BOOLs are 2. It was refused outright.
  let bitsUsed = 0
  for (const field of layout.fields) {
    if (field.section === "temp" || field.section === "VAR_TEMP" || field.section === "VAR_STAT") continue
    if (field.type.kind === "elementary" && field.type.elem.name === "BIT") {
      // the byte a run of bits sits in is taken once, at the first of them
      if (bitsUsed === 0) {
        offsets.set(field.name.toUpperCase(), offset)
        offset += 1n
      } else offsets.set(field.name.toUpperCase(), offset - 1n)
      bitsUsed = (bitsUsed + 1) % 8
      continue
    }
    bitsUsed = 0
    const b = byteSize(lw, field.type)
    if (b === undefined) return undefined
    offset = alignUp(offset, b.align)
    offsets.set(field.name.toUpperCase(), offset)
    offset += b.size
    if (b.align > align) align = b.align
  }
  return { size: alignUp(offset, align), align, ...(isFb ? {} : { offsets }) }
}

/** A place's byte offset from the start of its root variable — through struct fields and constant indices only. */
export function byteOffset(lw: Lowering, place: Place): bigint | undefined {
  let type = rootType(lw, place)
  let offset = 0n
  for (const step of place.path) {
    if (type === undefined) return undefined
    if (step.kind === "field") {
      if (type.kind !== "struct") return undefined
      const at = fieldBytes(lw, type)?.offsets?.get(step.name.toUpperCase())
      const field = lw.layouts.get(type.name.toUpperCase())?.fields.find((f) => f.name.toUpperCase() === step.name.toUpperCase())
      if (at === undefined || field === undefined) return undefined
      offset += at
      type = field.type
    } else if (step.kind === "index") {
      const array = peelArray(type)
      const element = array === undefined ? undefined : byteSize(lw, array.element)
      if (array === undefined || element === undefined || step.index.kind !== "const" || typeof step.index.value !== "bigint") return undefined
      offset += (step.index.value - step.lower) * element.size
      type = array.element
    } else return undefined
  }
  return offset
}

/**
 * `SIZEOF(x)` of a variable or a type name — its byte size (`bytes`), as a ULINT constant: a SIZEOF widens into a ULINT
 * without a message, measured. A type with an unmeasured part is refused.
 */
export function sizeOf(lw: Lowering, e: Extract<Expr, { kind: "call" }>): IrExpr | undefined {
  const arg = e.args[0]?.value
  if (e.args.length !== 1 || arg === undefined || e.args[0]!.param !== undefined) return lw.bail("call-arity", "SIZEOF takes one argument", e.span)
  const named = arg.kind === "ident_expr" && !lw.holds(arg.name) ? lookup(lw.scope, arg.name)?.symbol : undefined
  let type: Type
  if (named?.kind === "type" || named?.kind === "function_block") type = storageOf(lw, resolveNamedType(named.name, lw.project))
  else {
    const place = lowerPlace(lw, arg)
    if (place === undefined) return undefined
    type = place.type
  }
  const bytes = byteSize(lw, type)
  if (bytes === undefined) return lw.bail("sizeof-unmeasured", "SIZEOF of a type whose layout is not measured", e.span)
  return { kind: "const", value: bytes.size, type: elementaryRef("ULINT"), span: e.span }
}

/**
 * `ADR(a) - ADR(b)` of two places in ONE variable — a constant, the difference of their byte offsets (conformance
 * `mem_member_offsets`). Undefined when the expression is not that shape; null when it is but an offset is not measured
 * (reported), so the caller does not report it a second time.
 */
export function adrDifference(lw: Lowering, e: Extract<Expr, { kind: "binary" }>): IrExpr | null | undefined {
  const adrOf = (x: Expr): Expr | undefined =>
    x.kind === "call" && x.callee.kind === "ident_expr" && x.callee.name.toUpperCase() === "ADR" && x.args.length === 1 ? x.args[0]!.value : undefined
  const [a, b] = [adrOf(e.left), adrOf(e.right)]
  if (a === undefined || b === undefined) return undefined
  const [left, right] = [lowerPlace(lw, a), lowerPlace(lw, b)]
  if (left === undefined || right === undefined) return null
  const [from, to] = [byteOffset(lw, left), byteOffset(lw, right)]
  if (left.slot !== right.slot || left.root !== right.root || from === undefined || to === undefined || from < to) {
    lw.bail("adr-offset", "a difference of addresses whose byte offsets are not measured", e.span)
    return null
  }
  return { kind: "const", value: from - to, type: elementaryRef("ULINT"), span: e.span }
}

/** `offset` raised to the next multiple of `align`. */
export const alignUp = (offset: bigint, align: bigint): bigint => ((offset + align - 1n) / align) * align
