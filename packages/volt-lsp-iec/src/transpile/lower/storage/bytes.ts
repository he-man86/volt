/**
 * The measured byte layout — a type's size and alignment, a struct's or FB's field offsets, a place's byte offset.
 */

import type { Lowering } from "../core/lowering.js"
import type { PendingBody } from "../core/shared.js"
import { baseOf, implementsOf, interfaceChainOf, scopeChain } from "../core/chain.js"
import { peelArray, type Type } from "../../../frontend/types/index.js"
import { lookup } from "../../../frontend/symbols/index.js"
import type { Place } from "../../ir/index.js"
import { fieldIn, fieldOf, rootType, typeAlong } from "../places/path.js"
import { unionsOf } from "./unions.js"
import { elementarySize } from "../../semantics/index.js"

/**
 * A stored type's byte size and alignment, as the 64-bit simulator lays it out (conformance `mem_sizeof_*`,
 * `mem_member_offsets`): an integer, REAL, TIME or date its bit width in bytes, aligned to it, and a BOOL one byte
 * (`semantics/memory.elementarySize`, the one rule); a STRING(n) n + 1 (the terminator); a WSTRING(n) 2·(n + 1), aligned
 * to 2 (`wstring_layout_in_struct`: a WSTRING(3) after a BYTE is SIZEOF 8 at offset 2); an array whole elements; a struct
 * its fields (`fieldBytes`). Undefined for anything unmeasured: a BIT (packed with its neighbours), a pointer, a reference.
 */
export function byteSize(lw: Lowering, t: Type): { size: bigint; align: bigint } | undefined {
  if (t.kind === "elementary") {
    const e = t.elem
    if (e.family === "string") {
      if (t.length === undefined) return undefined
      return e.name === "STRING" ? { size: BigInt(t.length) + 1n, align: 1n } : { size: 2n * (BigInt(t.length) + 1n), align: 2n }
    }
    const size = elementarySize(t)
    return size === undefined ? undefined : { size: BigInt(size), align: BigInt(size) }
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
 * widest (`b BYTE; i INT; d DINT; x BOOL; l LREAL` is offsets 0/2/4/8/16, size 24). An FB instance starts with a
 * pointer-sized header and one pointer per interface it IMPLEMENTS, then its fields in DECLARATION order across its
 * sections (transpile-restructure 4.3, `fb_header_offsets_plain`: VAR_INPUT `inB` at 8, VAR_OUTPUT `outD` 12, `outW` 16,
 * `offLoc` 24, VAR `loc` 32, SIZEOF 40; `fb_header_offsets_implements`: every one 8 later, SIZEOF 48; and DECLARATION,
 * not section, order where the two differ — `fb_offsets_var_before_input`: VAR `loc` at 8, VAR_INPUT `inB` 10, VAR_OUTPUT
 * `outD` 16, SIZEOF 32, review 4d). VAR_TEMP and
 * VAR_STAT are not instance storage, and neither are lowering's own temps. Undefined for a derived type (where its base's
 * part and header sit) and an FB with VAR_IN_OUT (the in-out is stored in the instance, not in `fields`) — neither
 * measured; both were answered as if absent (transpiler review 2026-09-15).
 */
export function fieldBytes(
  lw: Lowering,
  t: Extract<Type, { kind: "struct" | "function_block" }>,
  unmeasured?: Set<string>,
): { size: bigint; align: bigint; offsets?: Map<string, bigint> } | undefined {
  const layout = lw.layouts.get(t.name.toUpperCase())
  // a UNION's size (its widest member, aligned?) is not measured
  if (layout === undefined || unionsOf(lw).has(t.name.toUpperCase())) return undefined
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
  for (const s of scopeChain(t.kind === "function_block" ? t.scope : undefined))
    for (const list of s.symbols.values())
      if (list.some((sym) => sym.kind === "method" && (sym.ast as { varSections?: readonly { sectionKind: string }[] }).varSections?.some((v) => v.sectionKind === "VAR_INST"))) return undefined
  const isFb = t.kind === "function_block"
  // each IMPLEMENTS adds a pointer, with the header before the fields (4.3); an interface in a packed FB is refused
  const replaced = isFb ? replacedConstants(lw, layout, pending) : new Set<string>()
  if (replaced === undefined) return undefined
  const interfaces = implementedInterfaces(lw, isFb ? pending : undefined)
  if (interfaces === undefined) return undefined
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
    // THE IMAGE'S LAYOUT (`pointers/image.ts`) goes on past a field of unmeasured size — a pointer, an interface — with
    // the fields after it in a run of their own, 16 bytes on: no program can tell where that run sits, since a walk,
    // a difference or an order across two runs faults (design.md §3.3 step 4d). SIZEOF stops there (`unmeasured` unset).
    if (b === undefined) {
      if (unmeasured === undefined) return undefined
      unmeasured.add(field.name.toUpperCase())
      offset = alignUp(offset + 16n, 8n)
      continue
    }
    if (!packed) offset = alignUp(offset, b.align)
    offsets.set(field.name.toUpperCase(), offset)
    offset += b.size
    if (!packed && b.align > align) align = b.align
  }
  // A PACKED layout is not rounded up at the end either. For a struct this was invisible — `align` stays 1 there, so
  // the round-up did nothing — but an FB's starts at 8 for its header, which turned the measured 13 back into 16.
  return { size: packed ? offset : alignUp(offset, align), align: packed ? 1n : align, offsets }
}

/**
 * A VAR CONSTANT THE COMPILER REPLACES TAKES NO ROOM (transpile-review 26): the FB's constants it replaces, by upper-cased
 * name. Measured on the one-DINT FB (16): a scalar LINT constant leaves it 16, the same under `const_non_replaced` makes it
 * 24, a STRUCT constant 32. A constant of any other kind (a STRING, an ARRAY) is refused — undefined — rather than guessed.
 */
function replacedConstants(lw: Lowering, layout: { readonly fields: readonly { name: string; type: Type }[] }, pending: PendingBody | undefined): Set<string> | undefined {
  const replaced = new Set<string>()
  for (const sec of pending?.unit.varSections ?? [])
    if (sec.constant === true)
      for (const d of sec.decls) {
        if (lw.attributes.get(d)?.has("const_non_replaced") === true) continue
        for (const n of d.names) {
          const type = fieldIn(layout.fields, n.text)?.type
          if (type?.kind === "struct") continue
          if (type?.kind !== "elementary" || type.elem.family === "string") return undefined
          replaced.add(n.text.toUpperCase())
        }
      }
  return replaced
}

/**
 * How many interface pointers an FB's own IMPLEMENTS list adds (8 bytes each, measured for interfaces that EXTEND
 * nothing: `mem_fb_implements_one`/`_two`). Undefined — refused — for an interface that EXTENDS another (one pointer, or
 * one per interface in its chain? not measured; transpile-restructure 4.0) and for an IMPLEMENTS name that resolves to no
 * interface declaration (whether it EXTENDS anything is unknown; 4a).
 */
function implementedInterfaces(lw: Lowering, pending: PendingBody | undefined): bigint | undefined {
  const chains = (pending === undefined ? [] : implementsOf(pending.unit)).map((i) => interfaceChainOf(lw, i.text))
  if (chains.some((c) => c.length > 1)) return undefined
  if (chains.some((c) => c.length === 0)) return undefined
  return BigInt(chains.length)
}

/** A place's byte offset from the start of its root variable — through struct and FB fields (an FB's measured since 4.3)
 *  and constant indices only. */
export function byteOffset(lw: Lowering, place: Place): bigint | undefined {
  let offset = 0n
  const walked = typeAlong(lw, rootType(lw, place), place.path, { fields: "composite", element: "sized" }, (step, type) => {
    if (type === undefined) return null
    if (step.kind === "field") {
      if (type.kind !== "struct" && type.kind !== "function_block") return null
      const at = fieldBytes(lw, type)?.offsets?.get(step.name.toUpperCase())
      if (at === undefined || fieldOf(lw, type.name, step.name) === undefined) return null
      offset += at
      return undefined
    }
    if (step.kind === "index") {
      const array = peelArray(type)
      const element = array === undefined ? undefined : byteSize(lw, array.element)
      if (array === undefined || element === undefined || step.index.kind !== "const" || typeof step.index.value !== "bigint") return null
      offset += (step.index.value - step.lower) * element.size
      return undefined
    }
    return null
  })
  return "stopped" in walked ? undefined : offset
}

/** `offset` raised to the next multiple of `align`. */
export const alignUp = (offset: bigint, align: bigint): bigint => ((offset + align - 1n) / align) * align
