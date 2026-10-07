/**
 * The measured byte layout — a type's size and alignment, a struct's or FB's field offsets, a place's byte offset.
 */

import { baseOf, type Lowering } from "../lowering.js"
import { peelArray, type Type } from "../../../frontend/types/index.js"
import { lookup } from "../../../frontend/symbols/index.js"
import type { Place } from "../../ir/index.js"
import { rootType } from "../places/path.js"

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
  // THE DECLARATION OF EITHER KIND. This read it only for a STRUCT, so `pack_mode` on a FUNCTION_BLOCK was never
  // seen — the review filed it as "never read for a FUNCTION_BLOCK" and `mem_fb_pack_mode_*` measured it on
  // 2026-09-18: the same FB is SIZEOF 16 aligned and **13** with `{attribute '''pack_mode''' := '''1'''}`, so the
  // attribute reaches an FB and removes the padding exactly as it does in a struct. The 8-byte instance header stays.
  // For an FB the attribute is keyed by the UNIT the parser produced, which is `PendingBody.unit` — the symbol's
  // `ast` is a different node and finds nothing.
  const decl = t.kind === "struct" ? lookup(lw.project, t.name)?.symbol.ast : pending?.unit
  if (decl?.kind === "type_decl" && decl.body.kind === "struct" && decl.body.extends !== undefined) return undefined
  // `{attribute 'pack_mode' := '1'}` lays the struct out with NO alignment padding: a BOOL then a DINT is 5, where the
  // aligned form is 8 (conformance `cp_declaration_pragmas`). Only mode 1 is measured; any other value is refused
  // rather than guessed, and a struct with none keeps the aligned layout.
  const attributes = decl === undefined ? undefined : lw.shared.attributes.get(decl)
  const packed = attributes?.has("pack_mode") === true
  if (packed && attributes?.has("pack_mode=1") !== true) return undefined
  // A METHOD's VAR_INST is storage in the instance, laid out as a field only once the method lowers — where it sits is not
  // measured, and a SIZEOF taken before and after that call would differ. Refused while any method of the FB declares one.
  for (let s = t.kind === "function_block" ? t.scope : undefined; s !== undefined; s = s.baseScope)
    for (const list of s.symbols.values())
      if (list.some((sym) => sym.kind === "method" && (sym.ast as { varSections?: readonly { sectionKind: string }[] }).varSections?.some((v) => v.sectionKind === "VAR_INST"))) return undefined
  const isFb = t.kind === "function_block"
  // A VAR CONSTANT THE COMPILER REPLACES TAKES NO ROOM, and each IMPLEMENTS adds a pointer (transpile-review 26).
  // Measured on the one-DINT FB (16): a scalar LINT constant leaves it 16, the same under `const_non_replaced` makes
  // it 24, a STRUCT constant 32; one interface 24, two 32. Where the interface pointers sit is not measured, so an FB
  // still has no field offsets; a constant of any other kind (a STRING, an ARRAY), and an interface in a packed FB,
  // are refused rather than guessed.
  const replaced = new Set<string>()
  for (const sec of isFb ? (pending?.unit.varSections ?? []) : [])
    if (sec.constant === true)
      for (const d of sec.decls) {
        if (lw.attributes.get(d)?.has("const_non_replaced") === true) continue
        for (const n of d.names) {
          const type = layout.fields.find((f) => f.name.toUpperCase() === n.text.toUpperCase())?.type
          if (type?.kind === "struct") continue
          if (type?.kind !== "elementary" || type.elem.family === "string") return undefined
          replaced.add(n.text.toUpperCase())
        }
      }
  const interfaces = BigInt(isFb && pending?.unit.kind === "function_block" ? (pending.unit.implements?.length ?? 0) : 0)
  if (packed && interfaces > 0n) return undefined
  let offset = isFb ? 8n + 8n * interfaces : 0n
  let align = isFb ? 8n : 1n
  const offsets = new Map<string, bigint>()
  // Consecutive BIT fields PACK, eight to a byte; anything else ends the run, and a BIT after one starts a fresh byte.
  // Measured (conformance `ct_bit_packing_sizes`): one BIT is 1 and eight are 1, nine are 2, a BYTE then a BIT is 2, a
  // BIT then an INT is 4 (the bit takes its byte, the INT aligns to 2), and BIT·BYTE·BIT is 3 — the second bit does not
  // go back into the first byte. A BOOL is a whole byte either way, so two BOOLs are 2. It was refused outright.
  let bitsUsed = 0
  for (const field of layout.fields) {
    if (field.section === "temp" || field.section === "VAR_TEMP" || field.section === "VAR_STAT" || replaced.has(field.name.toUpperCase())) continue
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
    if (!packed) offset = alignUp(offset, b.align)
    offsets.set(field.name.toUpperCase(), offset)
    offset += b.size
    if (!packed && b.align > align) align = b.align
  }
  // A PACKED layout is not rounded up at the end either. For a struct this was invisible — `align` stays 1 there, so
  // the round-up did nothing — but an FB's starts at 8 for its header, which turned the measured 13 back into 16.
  return { size: packed ? offset : alignUp(offset, align), align: packed ? 1n : align, ...(isFb ? {} : { offsets }) }
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

/** `offset` raised to the next multiple of `align`. */
export const alignUp = (offset: bigint, align: bigint): bigint => ((offset + align - 1n) / align) * align
