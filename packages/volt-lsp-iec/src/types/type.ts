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
 * the same concept (`syntax/ast` owns `ArrayType`/`PointerType`/`ReferenceType` the *syntax*; here
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
  | UnknownType

/** An IEC elementary type with its checkable facts embedded (no re-derive-from-name). */
export interface ElementaryTypeRef {
  kind: "elementary"
  /** Canonical upper-case name (STRING/WSTRING/INT/…). */
  name: string
  elem: ElementaryType
  /** A STRING/WSTRING's capacity in characters, when the declaration states one (`STRING(5)` → 5). Undefined for a
   *  sizeless `STRING` — the default capacity is a vendor fact the transpiler applies (measured: 80), not a
   *  resolution fact — and for every non-string type. */
  length?: number
}
export interface EnumType {
  kind: "enum"
  name: string
  /** The enum's member scope (enum values), when resolved. */
  scope?: Scope
}
export interface StructType {
  kind: "struct"
  name: string
  /** The struct/union field scope, when resolved. */
  scope?: Scope
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
}
export interface ArrayTypeInfo {
  kind: "array"
  element: Type
  dims: readonly ArrayDim[]
}
export interface PointerTypeInfo {
  kind: "pointer"
  target: Type
}
export interface ReferenceTypeInfo {
  kind: "reference"
  target: Type
}
export interface UnknownType {
  kind: "unknown"
}

/** The total, conservative fallback. Every consumer skips on this. */
export const UNKNOWN: UnknownType = { kind: "unknown" }

/** True when a type is fully known — no `unknown` anywhere in it (the C.6 conservative-skip guard). */
export function isKnown(t: Type): boolean {
  switch (t.kind) {
    case "unknown":
      return false
    case "array":
      return isKnown(t.element)
    case "pointer":
    case "reference":
      return isKnown(t.target)
    default:
      return true
  }
}

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

/** A Type's elementary facts, or undefined for any other kind of type. */
export function elemOf(t: Type): ElementaryType | undefined {
  return t.kind === "elementary" ? t.elem : undefined
}
