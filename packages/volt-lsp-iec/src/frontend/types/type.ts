/**
 * The rich `Type` model (Layer C, C.2) — the SINGLE type representation, folding the legacy
 * name-based `ResolvedType` + `InferredType` into one discriminated union that CARRIES FACTS
 * (data-model "Rebuild refinements"): an elementary type embeds its `ElementaryType` facts inline
 * (family/bits/signed/range/rank), enum/struct/FB carry their member scope, array/pointer/reference
 * carry their sub-`Type`. Consumers read facts off the node instead of re-deriving from a name.
 *
 * `UNKNOWN` is the total, conservative fallback: any unresolved sub-part collapses to it (C.6), and
 * every consumer skips on `UNKNOWN` — never a false positive. Resolve and infer are one engine that
 * produces these values (`resolve.ts`, `infer.ts`).
 *
 * Naming: the composite variants are `*Type` interfaces distinct from the AST's TypeExpr nodes of
 * the same concept (`syntax/ast/nodes` owns `ArrayType`/`PointerType`/`ReferenceType` the *syntax*; here
 * they are `ArrayTypeInfo`/`PointerTypeInfo`/`ReferenceTypeInfo`, the *resolved* form).
 */
import type { Scope } from "../symbols/index.js"
import type { ArrayDim } from "../syntax/index.js"
import { elementaryType, type ElementaryType } from "./elementary.js"

export type Type =
  | ElementaryTypeRef
  | EnumType
  | StructType
  | FunctionBlockType
  | InterfaceType
  | ArrayTypeInfo
  | PointerTypeInfo
  | ReferenceTypeInfo
  | StaticType
  | UnknownType

/** An IEC elementary type with its checkable facts embedded (no re-derive-from-name). */
export interface ElementaryTypeRef {
  kind: "elementary"
  /** Canonical upper-case name (STRING/WSTRING/INT/…). */
  name: string
  elem: ElementaryType
  /** A STRING/WSTRING's capacity in characters, when the declaration states one (`STRING(5)` → 5). Undefined for a
   *  sizeless `STRING` — the default capacity is a vendor fact the transpiler applies (`DEFAULT_STRING_LENGTH`), not a
   *  resolution fact — and for every non-string type. */
  length?: number
  /** A STRING/WSTRING whose declaration STATES a length this scope cannot fold (`STRING(cLen)` with `cLen` out of reach):
   *  its capacity is a fact missing, not the default — so its size is unknown (`builtins` `scalarStorageBytes`). */
  unfoldedLength?: true
  /** A capacity written as a NAME or an expression (`STRING(n)`), as written — the compiler names the type by it, not by
   *  its fold: "too long for destination type 'STRING(n)'" (`ce_string_length_constant_*`, `prag_const_*_string_length`,
   *  both vendors 2026-10-03). Undefined for a literal capacity. */
  lengthText?: string
  /** A SUBRANGE of an integer type (`INT(0..10)`): its bounds, folded in the declaring scope — absent when either does not
   *  fold, and for every other type. Its values convert as its base (`v + 1` is an INT, `dt_subrange_arithmetic_result`)
   *  but a variable of it is named with them, `INT (0..10)` (`dt_subrange_variable_type`), and a constant stored into it
   *  outside them is refused (rule DT3, `analysis/checks/types/subrange`). */
  subrange?: { lower: bigint; upper: bigint }
}
export interface EnumType {
  kind: "enum"
  name: string
  /** The enum's member scope (enum values), when resolved. */
  scope?: Scope
  /** The type an enum's values and variables convert as, when measured: INT for a PROJECT enum declared without a base
   *  type (conformance `cc_enum_into_*`, `cc_enum_var_into_*`). Undefined for a written base type, and for a library
   *  enum — two real builds store one into a WORD without the warning a project enum gets, for a reason not recorded. */
  base?: ElementaryTypeRef
}
export interface StructType {
  kind: "struct"
  name: string
  /** The struct/union field scope, when resolved. */
  scope?: Scope
  /** A UNION: its fields share one storage, sized by its largest (DT4, `dt_union_member_sizes`; `infer/expr` `storageBytes`).
   *  Everything else reads a union as it reads a struct — a member access, a store of one, its name. */
  union?: true
}
export interface InterfaceType {
  kind: "interface"
  name: string
  /** The interface member scope (its methods + properties), when resolved. */
  scope?: Scope
}
export interface FunctionBlockType {
  kind: "function_block"
  name: string
  /** The FB/PROGRAM member scope, when resolved. */
  scope?: Scope
  /** The POU denoted by its NAME — THIS's FB, SUPER's base, a PROGRAM's or an FB type's name read as a value — which the
   *  compiler NAMES upper-cased in a type it prints (`render`; `dt_this_type`, `dt_static_base_program`,
   *  `dt_static_base_fb_type`). `name` stays as declared: a member-not-found message keeps it (`infer/member` `pouNamed`). */
  byName?: true
}
export interface ArrayTypeInfo {
  kind: "array"
  element: Type
  dims: readonly ArrayDim[]
  /** Each dimension's bounds, when every one folds to a constant in the resolving scope — read by the transpiler,
   *  which stores the array; absent for a `[*]` dimension or a bound it cannot fold. */
  bounds?: readonly { lower: bigint; upper: bigint }[]
}
export interface PointerTypeInfo {
  kind: "pointer"
  target: Type
}
export interface ReferenceTypeInfo {
  kind: "reference"
  target: Type
}
/**
 * A NAME THAT DENOTES A DECLARATION, read where a value stands (rule DT8): a GVL's, a namespace's, a STRUCT type's, an
 * INTERFACE's or an uncalled FUNCTION's or METHOD's name — the static base of `GVL.x`, `Util.WEEKDAY`, `I.M`, never a value.
 * Its members are the declaration's (`scope`). Stored as a value it is refused, named by the compiler UPPER-CASED: "Cannot
 * convert type 'GVL_LANG_DT_STATIC_BASE_GVL' to type 'STRING'", 'UTIL', 'I_LANG_DT_INTERFACE_STATIC_BASE', 'F_LANG_…', and a
 * method named without its call 'VALUE' (`dt_static_base_*`, `dt_namespace_static_base`, `dt_interface_static_base`,
 * `cc2_type_name_and_method_without_parens`, CODESYS 2026-10-03). They were a "struct", UNKNOWN and the callable's result.
 *
 * An ENUM type's name stays its `EnumType` (it converts as the enum, `cc2_type_name_and_method_without_parens`), and a
 * PROGRAM's or an FB type's name the `FunctionBlockType` named upper-cased (`infer/member` `staticScopeType`): a program's
 * name IS its instance, read as one by every check of an instance's members.
 */
export interface StaticType {
  kind: "static"
  denotes: "gvl" | "namespace" | "struct" | "interface" | "function" | "method"
  /** The name as declared; a type the compiler prints names it upper-cased (`render`), a member-not-found message as
   *  declared (`analysis/resolution` `checkMember`). */
  name: string
  /** The declaration's member scope, when it has one. */
  scope?: Scope
}
export interface UnknownType {
  kind: "unknown"
}

/** The total, conservative fallback. Every consumer skips on this. */
export const UNKNOWN: UnknownType = { kind: "unknown" }

/** Construct an elementary Type from its facts. */
export function elementaryTypeRef(elem: ElementaryType): ElementaryTypeRef {
  return { kind: "elementary", name: elem.name, elem }
}

/**
 * The elementary Type named `name` (aliases resolved), or UNKNOWN. The ONE constructor by name — inference, resolution and
 * the transpiler each kept a private copy (consolidate-lsp-structure B1).
 */
export function elementaryRef(name: string): Type {
  const facts = elementaryType(name)
  return facts === undefined ? UNKNOWN : elementaryTypeRef(facts)
}

/** `t` without its subrange: what an operation on a subrange value yields — the base (`dt_subrange_arithmetic_result`). */
export function withoutSubrange(t: Type): Type {
  if (t.kind !== "elementary" || t.subrange === undefined) return t
  const { subrange: _, ...base } = t
  return base
}

/** A Type's elementary facts, or undefined for any other kind of type. */
export function elemOf(t: Type): ElementaryType | undefined {
  return t.kind === "elementary" ? t.elem : undefined
}
