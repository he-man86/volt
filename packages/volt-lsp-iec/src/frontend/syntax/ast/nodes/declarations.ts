/**
 * THE AST'S DECLARATIONS — a DUT's body (`TYPE … END_TYPE`), the VAR sections and the declarations in them. One family
 * of `ast/nodes/` (openspec lsp-same-standard design.md §8).
 */
import type { Span } from "../../span.js"
import type { Identifier, Initializer, BodySpan, Expr } from "./expressions.js"
import type { TypeExpr, EnumValue } from "./types.js"

// ─── DUT bodies (`TYPE … END_TYPE`) ──────────────────────────────────────────

export type DutBody = StructBody | EnumBody | UnionBody | AliasBody | RefusedBody

/**
 * A TYPE whose body the parser refused — no `:` (`TYPE X STRUCT`), an EXTENDS list (`TYPE X EXTENDS A, B :`), or nothing
 * after the colon (`TYPE X : END_TYPE`). Both vendors keep such a type, bodiless: it is no unknown type where it is used,
 * its EXTENDS gets the alias's messages, and its members are none (`unit_type_no_body`, `unit_type_missing_colon`,
 * `unit_struct_extends_list`, 2026-10-01). It used to be an alias of a type named `?`, which no source wrote.
 */
export interface RefusedBody {
  kind: "refused"
  span: Span
}

export interface StructBody {
  kind: "struct"
  fields: VarDecl[]
  extends?: Identifier
  span: Span
}
export interface EnumBody {
  kind: "enum"
  baseType?: TypeExpr
  init?: Initializer // `(A, B) := A` default value
  values: EnumValue[]
  span: Span
}
export interface UnionBody {
  kind: "union"
  fields: VarDecl[]
  span: Span
}
export interface AliasBody {
  kind: "alias"
  target: TypeExpr
  init?: Initializer // `TYPE T : INT := 5; END_TYPE`
  span: Span
}

// ─── VAR sections & declarations ─────────────────────────────────────────────

export type VarSectionKind =
  | "VAR"
  | "VAR_INPUT"
  | "VAR_OUTPUT"
  | "VAR_IN_OUT"
  | "VAR_TEMP"
  | "VAR_STAT"
  | "VAR_INST"
  | "VAR_EXTERNAL"
  | "VAR_GLOBAL"
  | "VAR_CONFIG"
  | "VAR_ACCESS"
  | "VAR_GENERIC"

export interface VarSection {
  kind: "var_section"
  sectionKind: VarSectionKind
  constant?: boolean
  retain?: boolean
  persistent?: boolean
  decls: VarDecl[]
  span: Span
}
/**
 * AN `{attribute '<name>'}` PRAGMA, as the vendor reads it: the first quoted word is the name, and `:= '<value>'` the
 * value; an UNQUOTED value is the empty string to the compiler ("Invalid value ''", `cc4_attribute_value_string`). The
 * lexer ends a pragma at its first `}` even inside quotes (`prag_attribute_brace_in_value`, both vendors), so neither
 * ever holds one.
 */
export interface Attribute {
  name: string
  value?: string
  /** The pragma as written, braces included — what a printer writes back (`services/formatting/print`). */
  text: string
  span: Span
}

export interface VarDecl {
  kind: "var_decl"
  /** The `{attribute '…'}` pragmas on it, in source order (`pragmas/attributes` `attachAttributes`). */
  attributes?: readonly Attribute[]
  names: Identifier[] // `a, b, c : INT;`
  type: TypeExpr
  init?: Initializer // scalar → Expr, aggregate → AggregateInit (was opaque BodySpan)
  /**
   * WHICH OPERATOR introduced `init` — `REF=` for a reference bind, undefined for `:=`.
   *
   * The parser accepted both and recorded neither, so `r : REFERENCE TO UDINT REF= v` reached every consumer as
   * an ordinary assignment. Lowering then bound no target and refused every read of `r` as `pointer-order` — the
   * single largest line in that refusal's histogram (141 corpus POUs, `ONTIME.pou`'s `refSeconds`). The
   * information was in the source and the AST dropped it.
   *
   * `FB_Init` — a `[(…), (…)]` list written straight after the type with NO operator: each element is one array
   * element's FB_Init arguments (`decl_bracket_init_no_assign_fb`), not the structured initialization `:= [(…)]` is.
   */
  initOp?: "REF=" | "FB_Init"
  /** AN INITIALIZER THE PARSER REFUSED (`RefusedInit`), when there is one; `init` is then absent. */
  refusedInit?: RefusedInit
  at?: BodySpan // `AT %IX0.0` — opaque address
  /**
   * AN `AT` OPERAND THE PARSER REFUSED — no address at all (`AT ABC`, `AT 16#10`, `AT 'x'`, `AT :`, `AT %IW*`): "Direct
   * address expected after AT instead of …" (`parse/declarations` `refuseAtOperand`). Both vendors then DROP the
   * declaration, so every use of its names is "not defined" (`cc5_at_address_not_direct`, `decl_at_*`); the binder binds
   * none of it.
   */
  atRefused?: true
  /** A VAR_ACCESS declaration's access path and direction — `name : <path> : <type> READ_ONLY;` (`decl_var_access*`). */
  access?: AccessPath
  span: Span
}

/**
 * IEC's access path, `PLC_PRG.x` in `accW : PLC_PRG.x : INT READ_WRITE;`. CODESYS and TwinCAT build a file-scope
 * VAR_ACCESS list and bind NOTHING from it — a path to no variable builds (`decl_var_access_unknown_path`), and the
 * list's object is no name (`decl_var_access_used`: "Identifier 'GVL_…' not defined") — so the path is kept as written.
 */
export interface AccessPath {
  path: Identifier[]
  direction?: "READ_ONLY" | "READ_WRITE"
  span: Span
}

/**
 * THE COMPILER'S PLACEHOLDER for an expression it refused: `!!!'ERROR'!!!`, as both vendors print it in a message about
 * the value ("Cannot convert type 'Unknown type: '!!!'ERROR'!!!'' to type 'TIME'").
 */
export const REFUSED_PLACEHOLDER = "!!!'ERROR'!!!"

/**
 * A declaration initializer the parser refused at a malformed literal (`Token.malformed`: `"$41"`, `T#1500` before
 * `US`; `parse/initializer` `refuseMalformedInit`). `span` is the literal's. `value` is the initializer as the
 * compiler kept it — the tokens before the literal, the literal itself an `ident_expr` named `REFUSED_PLACEHOLDER`
 * (nothing binds it: the binder never walks a refused initializer) — and is absent where the compiler keeps none, inside
 * an aggregate (`lit_init_malformed_in_aggregate`). Its type check is `declarations/refused-initializer`.
 */
export interface RefusedInit {
  span: Span
  value?: Expr
}
