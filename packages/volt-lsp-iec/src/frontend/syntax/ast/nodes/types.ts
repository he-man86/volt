/**
 * THE AST'S TYPE EXPRESSIONS — the structured type nodes (subrange, array dims, string length, implicit enum). One
 * family of `ast/nodes/` (openspec lsp-same-standard design.md §8).
 */
import type { Span } from "../../span.js"
import type { Identifier, CallArg, Expr } from "./expressions.js"

// ─── type expressions (structured bounds — the A.1/A.2 refinement) ───────────

export type TypeExpr = NamedType | ArrayType | ReferenceType | PointerType | StringType | ImplicitEnumType

export interface NamedType {
  kind: "named_type"
  name: Identifier
  qualifiers?: Identifier[] // `Tc2_Standard.TON` → ["Tc2_Standard"]
  subrange?: Subrange // `INT(lo..hi)` — structured, not opaque
  initArgs?: CallArg[] // `inst : FB(x := 1)` — the FB_Init arguments an instance is declared with
  /** `inst : FB<6>` — the values a VAR_GENERIC CONSTANT function block is instanced with (`decl_var_generic*`). */
  genericArgs?: Expr[]
  /** The `<…>` list was refused as written (a parse error stands on it) — its values were not read, so none is counted. */
  genericRefused?: true
  span: Span
}
/** A structured subrange bound (A.2): both ends are const-expressions. */
export interface Subrange {
  kind: "subrange"
  lo: Expr
  hi: Expr
  span: Span
}
export interface ArrayType {
  kind: "array_type"
  dims: ArrayDim[]
  element: TypeExpr
  /**
   * Set when the source wrote a CODESYS `__VECTOR[<count>] OF <type>`, with the count AS WRITTEN (absent when the
   * brackets are empty — a vector still). `dims` holds the index range it stands for, `0..count-1`, which the parser
   * builds and the type layer folds; this is what the source says, so a printer prints a vector and not the array it is
   * resolved as (`syntax/print.ts`).
   */
  vector?: { size?: Expr }
  span: Span
}
/**
 * One array dimension. `lower`/`upper` are const-expressions (evaluated in
 * types/const-eval). `dynamic` marks a variable-length `ARRAY[*]` dim (VLA/vector),
 * where the bounds are absent.
 */
export interface ArrayDim {
  kind: "array_dim"
  dynamic: boolean
  lower?: Expr
  upper?: Expr
  span: Span
}
export interface ReferenceType {
  kind: "reference_type"
  target: TypeExpr
  span: Span
}
export interface PointerType {
  kind: "pointer_type"
  target: TypeExpr
  span: Span
}
export interface StringType {
  kind: "string_type"
  wide: boolean // WSTRING
  length?: Expr // `STRING(80)` — structured
  /**
   * The opener and closer the length was written in, present with `length`: a STRING's length stands in `(…)` or `[…]`
   * and either closer ends either opener (`decl_string_brackets`, `_mismatched`, `_mismatched_other`) — the printer
   * writes them back as written (frontend-conformance 2.9, PR2). A WSTRING's is always `()`.
   */
  delimiters?: StringLengthDelimiters
  span: Span
}
/** Opener then closer; an opener alone when the closer is missing (a parse error). */
export type StringLengthDelimiters = "()" | "[]" | "(]" | "[)" | "(" | "["
export interface ImplicitEnumType {
  kind: "implicit_enum_type"
  values: EnumValue[]
  /** `e : (A, B) INT` — the base type written after the values (`decl_implicit_enum_with_base`). */
  baseType?: TypeExpr
  span: Span
}

export interface EnumValue {
  kind: "enum_value"
  name: Identifier
  value?: Expr // `:= 42`
  span: Span
}
