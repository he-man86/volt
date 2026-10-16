/**
 * THE MEASURED BYTE LAYOUT — a type's size and alignment as the 64-bit target lays it out (a STRUCT and an FB instance
 * only on a project whose target is stated 64-bit, `targetOf`), for the front-end's SIZEOF
 * (`const/fold`, `infer/expr` `sizeofOperandBytes`): an array bound or a CASE label written as `SIZEOF(<a STRUCT>)` (the
 * corpora: `ARRAY [1..SIZEOF(L_MC4P_PathData)] OF BYTE`) folds to what CODESYS folds it to. One home for the rule that
 * PACKS fields (`packFields`): the transpiler lays out its own frames' fields with it (`lower/storage/bytes.ts`), and
 * `test/conformance/fold-agreement.test.ts` holds the two folds' SIZEOFs equal (transpile-restructure 6.A.31).
 *
 * Measured (each a recorded fixture): a STRUCT's fields each aligned to their own alignment, the whole padded to the
 * widest (`mem_sizeof_struct_mixed`, `tr_a31_sizeof_bound_struct_*`); `{attribute 'pack_mode' := '1'}` drops the
 * padding (`cp_declaration_pragmas`, `tr_a31_sizeof_bound_struct_packed`: BOOL, DINT is 5); consecutive BITs pack eight
 * to a byte (`ct_bit_packing_sizes`); an FB instance an 8-byte header, one more 8-byte pointer per interface it
 * IMPLEMENTS, then its fields in DECLARATION order (`fb_header_offsets_*`, `fb_offsets_var_before_input`,
 * `mem_fb_implements_*`), its VAR_TEMP and VAR_STAT not in it, a VAR CONSTANT the compiler replaces neither
 * (`mem_fb_var_constant_*`) — a VAR_INPUT CONSTANT is a parameter and takes its room (`tr_a31_sizeof_*_fb_var_input_constant`). Undefined — no size, so nothing is checked — for what is not measured: a derived STRUCT or
 * FB, an FB with a VAR_IN_OUT or a METHOD's VAR_INST, an interface that EXTENDS another, a pack mode other than 1, a
 * RETAIN or PERSISTENT section, a pointer, a reference, an interface.
 */
import type { FunctionBlock, TypeDecl, VarDecl, VarSection } from "../syntax/index.js"
import { lookupUnit, rootOf, targetOf, type Scope } from "../symbols/index.js"
import { scalarStorageBytes } from "./builtins.js"
import { enumStorage } from "./enums.js"
import { isBit } from "./predicates.js"
import { resolveTypeExpr } from "./resolve.js"
import type { Type } from "./type.js"

/** A size and an alignment, in bytes. */
interface Bytes {
  size: bigint
  align: bigint
}

/** One field to pack: its size and alignment, a BIT (packed with its neighbours), or unmeasured (undefined). */
interface PackedField {
  name: string
  bytes: Bytes | "bit" | undefined
}

export const alignUp = (offset: bigint, align: bigint): bigint => ((offset + align - 1n) / align) * align

/**
 * Fields laid out one after another from `start` — each aligned to its own alignment unless `packed`, the whole rounded up
 * to the widest — and each field's offset, by upper-cased name. Consecutive BITs share a byte, eight to it; anything else
 * ends the run, and a BIT after one starts a fresh byte (`ct_bit_packing_sizes`: nine are 2, BIT·BYTE·BIT 3). A field of
 * unmeasured size ends the layout (undefined) — unless `unmeasured` collects it: then the fields after it go on in a run
 * of their own 16 bytes later, aligned to 8, which no program can tell apart (the transpiler's byte image, design.md §3.3
 * step 4d). A PACKED layout is not rounded up at the end (an FB's header would turn a measured 13 back into 16).
 */
export function packFields(
  fields: readonly PackedField[],
  start: Bytes,
  packed: boolean,
  unmeasured?: Set<string>,
): { size: bigint; align: bigint; offsets: Map<string, bigint> } | undefined {
  let offset = start.size
  let align = start.align
  const offsets = new Map<string, bigint>()
  let bitsUsed = 0
  for (const field of fields) {
    const key = field.name.toUpperCase()
    if (field.bytes === "bit") {
      // the byte a run of bits sits in is taken once, at the first of them
      if (bitsUsed === 0) {
        offsets.set(key, offset)
        offset += 1n
      } else offsets.set(key, offset - 1n)
      bitsUsed = (bitsUsed + 1) % 8
      continue
    }
    bitsUsed = 0
    const b = field.bytes
    if (b === undefined) {
      if (unmeasured === undefined) return undefined
      unmeasured.add(key)
      offset = alignUp(offset + 16n, 8n)
      continue
    }
    if (!packed) offset = alignUp(offset, b.align)
    offsets.set(key, offset)
    offset += b.size
    if (!packed && b.align > align) align = b.align
  }
  return { size: packed ? offset : alignUp(offset, align), align: packed ? 1n : align, offsets }
}

/**
 * The bytes a value of `t` occupies and its alignment: an elementary type (`scalarStorageBytes`, aligned to its size up to
 * 8 — a STRING to 1, a WSTRING to 2), an ENUM as its storage, an ARRAY its element's whole, a UNION its largest member
 * rounded up to its most aligned one's natural alignment (`dt_union_member_sizes`), a STRUCT and an FB instance as
 * `packFields` lays them out. Undefined for anything unmeasured (see the file's head).
 */
export function typeBytes(t: Type, project: Scope, seen: ReadonlySet<string> = new Set()): Bytes | undefined {
  if (t.kind === "enum") {
    const base = enumStorage(t)
    return base === undefined ? undefined : typeBytes(base, project, seen)
  }
  if (t.kind === "array") {
    const element = typeBytes(t.element, project, seen)
    if (element === undefined || t.bounds === undefined) return undefined
    return { size: t.bounds.reduce((n, b) => n * (b.upper - b.lower + 1n), element.size), align: element.align }
  }
  // A LAYOUT IS THE 64-BIT TARGET'S: an FB's header and interface slots are pointers, and where an 8-byte field sits in a
  // STRUCT on a 32-bit target is unmeasured — so a STRUCT or an FB has a size only where the project's target is stated
  // 64-bit (`targetOf`; the LSP over a workspace whose device is not measured states none). 6Af gate review.
  if ((t.kind === "struct" && t.union !== true) || t.kind === "function_block") if (targetOf(rootOf(project))?.pointerBits !== 64) return undefined
  if (t.kind === "struct") return t.union === true ? unionBytes(t, project) : laidOut(t, project, seen, structFields)
  if (t.kind === "function_block") return laidOut(t, project, seen, fbFields)
  const size = scalarStorageBytes(t)
  const align = naturalAlignment(t)
  return size === undefined || align === undefined ? undefined : { size, align }
}

/** A member's natural alignment: an elementary type's own size up to 8 (a STRING 1, a WSTRING 2 — its code unit: a union of
 *  WSTRING(1) and ARRAY[0..4] OF BYTE is 6, `dt_union_wstring_sizeof_bound`, both vendors 2026-10-03), an array's
 *  element's, an enum's storage. A BIT has none (it packs). */
function naturalAlignment(t: Type): bigint | undefined {
  if (t.kind === "array") return naturalAlignment(t.element)
  if (t.kind === "enum") {
    const base = enumStorage(t)
    return base === undefined ? undefined : naturalAlignment(base)
  }
  if (t.kind !== "elementary") return undefined
  if (t.elem.family === "string") return BigInt(t.elem.bits / 8)
  const bytes = scalarStorageBytes(t)
  return bytes === undefined ? undefined : bytes > 8n ? 8n : bytes
}

/** A UNION: its largest member, rounded up to its most aligned member's natural alignment — members of a scalar, an enum
 *  or an array of either only (a STRUCT member's is not measured). `{attribute 'pack_mode' := '1'}` drops the rounding,
 *  as in a STRUCT: DWORD|ARRAY[0..4] OF BYTE is 5 packed, 8 not (`type_dut_union_pack_mode`, both vendors build it,
 *  CODESYS runs it 2026-10-11); another mode is not measured. */
function unionBytes(t: Extract<Type, { kind: "struct" }>, project: Scope): Bytes | undefined {
  const decl = lookupUnit(project, t.name)?.symbol.ast as TypeDecl | undefined
  const mode = decl?.kind === "type_decl" ? packMode(decl.attributes) : undefined
  const members = fieldDecls(t.scope)?.map((s) => resolveTypeExpr(s.typeExpr!, project, 0, project, s.uri))
  if (mode === undefined || members === undefined || members.length === 0) return undefined
  let size = 0n
  let align = 1n
  for (const m of members) {
    const a = naturalAlignment(m)
    const bytes = a === undefined ? undefined : typeBytes(m, project)
    if (bytes === undefined || a === undefined) return undefined
    if (bytes.size > size) size = bytes.size
    if (a > align) align = a
  }
  return mode === "packed" ? { size, align: 1n } : { size: alignUp(size, align), align }
}

/** The STRUCT field symbols of a member scope, in declaration order — undefined when its scope is not known. */
function fieldDecls(scope: Scope | undefined) {
  if (scope === undefined) return undefined
  return [...scope.symbols.values()].flat().filter((s) => s.kind === "struct_field" && s.typeExpr !== undefined)
}

/** What a STRUCT or an FB contributes to `packFields`: where its fields start, whether it is packed, and the fields. */
interface Layout {
  start: Bytes
  packed: boolean
  fields: readonly { name: string; type: Type }[]
}

/** `t` laid out by `layoutOf` — a type reaching itself has no size. */
function laidOut<T extends Extract<Type, { kind: "struct" | "function_block" }>>(
  t: T,
  project: Scope,
  seen: ReadonlySet<string>,
  layoutOf: (t: T, project: Scope) => Layout | undefined,
): Bytes | undefined {
  const key = `${t.kind}:${t.name.toUpperCase()}`
  if (seen.has(key)) return undefined
  const layout = layoutOf(t, project)
  if (layout === undefined) return undefined
  const inner = new Set([...seen, key])
  const fields: PackedField[] = layout.fields.map((f) => ({ name: f.name, bytes: isBit(f.type) ? "bit" : typeBytes(f.type, project, inner) }))
  const packed = packFields(fields, layout.start, layout.packed)
  return packed === undefined ? undefined : { size: packed.size, align: packed.align }
}

/** A pack mode: none (aligned), 1 (packed), or another — unmeasured. */
function packMode(attributes: TypeDecl["attributes"]): "aligned" | "packed" | undefined {
  const mode = attributes?.find((a) => a.name.toLowerCase() === "pack_mode")
  if (mode === undefined) return "aligned"
  return mode.value === "1" ? "packed" : undefined
}

/** A STRUCT's fields (no EXTENDS — a derived struct's base part is not measured). */
function structFields(t: Extract<Type, { kind: "struct" }>, project: Scope): Layout | undefined {
  const decl = lookupUnit(project, t.name)?.symbol.ast as TypeDecl | undefined
  if (decl?.kind !== "type_decl" || decl.body.kind !== "struct" || decl.body.extends !== undefined) return undefined
  const mode = packMode(decl.attributes)
  const fields = fieldDecls(t.scope)
  if (mode === undefined || fields === undefined) return undefined
  return {
    start: { size: 0n, align: 1n },
    packed: mode === "packed",
    fields: fields.map((s) => ({ name: s.name, type: resolveTypeExpr(s.typeExpr!, project, 0, project, s.uri) })),
  }
}

/** An FB instance's fields: the 8-byte header and one pointer per interface it IMPLEMENTS, then every VAR_INPUT,
 *  VAR_INPUT CONSTANT, VAR_OUTPUT, VAR and kept VAR CONSTANT in declaration order. */
function fbFields(t: Extract<Type, { kind: "function_block" }>, project: Scope): Layout | undefined {
  const unit = lookupUnit(project, t.name)?.symbol.ast as FunctionBlock | undefined
  if (unit?.kind !== "function_block" || unit.extends !== undefined || t.scope === undefined) return undefined
  const mode = packMode(unit.attributes)
  if (mode === undefined) return undefined
  if (unit.varSections.some((s) => s.sectionKind === "VAR_IN_OUT" || s.retain === true || s.persistent === true)) return undefined
  // a METHOD's VAR_INST is the instance's storage once the method runs — where it sits is not measured
  for (const list of t.scope.symbols.values())
    for (const sym of list)
      if (sym.kind === "method" && (sym.ast as { varSections?: readonly VarSection[] }).varSections?.some((v) => v.sectionKind === "VAR_INST")) return undefined
  const interfaces = implementedInterfaces(unit, project)
  if (interfaces === undefined || (mode === "packed" && interfaces > 0n)) return undefined
  const fields: { name: string; type: Type }[] = []
  for (const section of unit.varSections) {
    if (section.sectionKind === "VAR_TEMP" || section.sectionKind === "VAR_STAT" || section.sectionKind === "VAR_EXTERNAL") continue
    for (const decl of section.decls) {
      const type = resolveTypeExpr(decl.type, project, 0, t.scope)
      // a VAR_INPUT CONSTANT is a per-call parameter, not a constant the compiler replaces: it takes its room
      // (`tr_a31_sizeof_bound_fb_var_input_constant`, both vendors, 24 — 6Af gate review)
      if (section.constant === true && section.sectionKind !== "VAR_INPUT") {
        const kept = replacedConstant(decl, type)
        if (kept === undefined) return undefined
        if (kept === "replaced") continue
      }
      for (const name of decl.names) fields.push({ name: name.text, type })
    }
  }
  return { start: { size: 8n + 8n * interfaces, align: 8n }, packed: mode === "packed", fields }
}

/** A VAR CONSTANT of an FB: a scalar the compiler REPLACES takes no room, a STRUCT one or a `const_non_replaced` one does
 *  (`mem_fb_var_constant_*`); a constant of any other kind (a STRING, an ARRAY) is not measured. */
function replacedConstant(decl: VarDecl, type: Type): "replaced" | "kept" | undefined {
  if (decl.attributes?.some((a) => a.name.toLowerCase() === "const_non_replaced") === true) return "kept"
  if (type.kind === "struct") return "kept"
  return type.kind === "elementary" && type.elem.family !== "string" ? "replaced" : undefined
}

/** How many interface pointers an FB's IMPLEMENTS list adds — undefined for an interface that EXTENDS another, or one that
 *  resolves to no interface (`mem_fb_implements_one` / `_two` measured interfaces that extend nothing). */
function implementedInterfaces(unit: FunctionBlock, project: Scope): bigint | undefined {
  for (const name of unit.implements ?? []) {
    const itf = lookupUnit(project, name.text)?.symbol.ast
    if (itf?.kind !== "interface" || (itf.extends?.length ?? 0) > 0) return undefined
  }
  return BigInt(unit.implements?.length ?? 0)
}
