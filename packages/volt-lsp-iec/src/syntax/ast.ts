/**
 * The complete IEC 61131-3 Structured Text AST (Layer A · Task A.1).
 *
 * Design (from architecture.md + data-model.md "Rebuild refinements"):
 * the AST models the language *completely* so consumers read structured nodes and
 * never re-parse spans. Concretely, vs. the legacy shapes:
 *   - type-expr bounds are STRUCTURED: subrange `{ lo, hi }`, array dims as const-expr
 *     nodes, string length as an expr — not opaque `BodySpan`s re-parsed ad hoc.
 *   - literals carry a parsed `value`; the *type* is inferred in layer C (types/infer)
 *     from `literalKind` + `value`, so const-eval/overflow checks never re-lex `text`.
 *     (The literal Type is NOT stored here — that would be an upward import into C.)
 *   - initializers are expression trees (`Expr`), not `BodySpan`s.
 * `BodySpan` survives only for genuinely-opaque ranges: a POU body (parsed on demand)
 * and an `AT` address.
 *
 * Ownership: `syntax/ast` owns every AST node type. Nobody redefines a node elsewhere.
 */
import type { Span } from "./span.js"
import type { Keyword, Token } from "./tokens.js"

// ─── leaves & opaque spans ───────────────────────────────────────────────────

export interface Identifier {
  kind: "identifier"
  text: string
  span: Span
}

/**
 * An unparsed token range — carries slice + tokens so later passes walk without
 * re-lexing. Retained ONLY for a POU body (materialized to statements on demand)
 * and an `AT` address; structured concerns (bounds/lengths/inits) are proper nodes.
 */
export interface BodySpan {
  kind: "body"
  tokens: Token[]
  span: Span
}

// ─── expression tree (POU bodies + all structured initializers/bounds) ───────

export type Expr =
  | IdentExpr
  | Literal
  | BinaryExpr
  | UnaryExpr
  | MemberExpr
  | IndexExpr
  | DerefExpr
  | CallExpr
  | ParenExpr
  | AssignExpr

export interface IdentExpr {
  kind: "ident_expr"
  name: string
  span: Span
}

export type LiteralKind =
  | "int"
  | "real"
  | "string"
  | "wstring"
  | "time"
  | "date"
  | "tod"
  | "datetime"
  | "typed"
  | "bool"
  | "address"

/** A duration/time literal, normalized to nanoseconds for const-eval + ordering. */
export interface DurationValue {
  kind: "duration"
  ns: bigint
}

/** A parsed literal value. `undefined` when the text is malformed (error-tolerant). */
export type LiteralValue = bigint | number | string | boolean | DurationValue | undefined

export interface Literal {
  kind: "literal"
  literalKind: LiteralKind
  text: string
  /** Parsed value (bigint for int, number for real, bool, string body, duration). */
  value: LiteralValue
  /** For `typed`/`address` literals: the type/prefix as written (`INT`, `%IX`). */
  prefix?: string
  span: Span
}

export interface BinaryExpr {
  kind: "binary"
  op: string // canonical upper keyword or punct
  left: Expr
  right: Expr
  span: Span
}
export interface UnaryExpr {
  kind: "unary"
  op: string
  operand: Expr
  span: Span
}
export interface MemberExpr {
  kind: "member"
  base: Expr
  member: IdentExpr
  span: Span
}
export interface IndexExpr {
  kind: "index"
  base: Expr
  indices: Expr[]
  span: Span
}
export interface DerefExpr {
  kind: "deref"
  base: Expr
  span: Span
}
export interface CallExpr {
  kind: "call"
  callee: Expr
  args: CallArg[]
  span: Span
}
export interface CallArg {
  kind: "call_arg"
  param?: IdentExpr // `p := v` or `p => t`
  output: boolean // true for `=>`
  value?: Expr
  span: Span
}
export interface ParenExpr {
  kind: "paren"
  inner: Expr
  span: Span
}
/** CODESYS assignment-as-expression: `(x := v)`. */
export interface AssignExpr {
  kind: "assign_expr"
  target: Expr
  value: Expr
  span: Span
}

// ─── initializers ────────────────────────────────────────────────────────────

/**
 * A declaration initializer. A scalar init (`:= 5`, `:= foo.bar`, `:= 1 + 2`) is a
 * full `Expr` tree — const-eval + overflow checks read it directly. An aggregate init
 * (`:= (a := 1, b := 2)` struct/FB, `:= [1, 2, 3]` array) is kept as a structured but
 * opaque `AggregateInit` — round-trippable, but its per-field grammar is deferred.
 */
export type Initializer = Expr | AggregateInit

/**
 * A struct/FB/array aggregate initializer, parsed into a structured element list. `tokens` is retained for
 * round-trip formatting (`print.ts` joins them); `form` + `elements` are the analyzable structure. Parsing is
 * total and error-tolerant: anything it can't classify becomes an `unparsed` element (checks skip it → 0-FP),
 * and a shape it doesn't recognize yields `form: "unknown"` with no elements.
 */
export interface AggregateInit {
  kind: "aggregate_init"
  /** `[…]` array literal · `(…)`/`STRUCT(…)` struct/FB · `unknown` (unrecognized shape). */
  form: AggregateForm
  /** Top-level elements in source order (nested aggregates recurse into their own `AggregateInit`). */
  elements: readonly AggregateElement[]
  tokens: Token[]
  span: Span
}

export type AggregateForm = "array" | "struct" | "unknown"

/** One element of an aggregate initializer. `field`/`repeat` wrap another element as their value. */
export type AggregateElement =
  | { kind: "value"; expr: Expr; span: Span } // a scalar value — `1`, `foo`, `1 + 2`
  | { kind: "nested"; init: AggregateInit; span: Span } // a nested `[…]` / `(…)` / `STRUCT(…)`
  | { kind: "field"; name: string; value: AggregateElement; span: Span } // `name := <value>`
  | { kind: "repeat"; count: Expr; value: AggregateElement; span: Span } // `n(<value>)` — value repeated n times
  | { kind: "unparsed"; span: Span } // could not classify — a conservative skip signal

// ─── statement tree ──────────────────────────────────────────────────────────

export type Statement =
  | Assignment
  | CallStatement
  | IfStatement
  | CaseStatement
  | ForStatement
  | WhileStatement
  | RepeatStatement
  | ReturnStatement
  | ExitStatement
  | ContinueStatement
  | TryStatement
  | ExprStatement
  | EmptyStatement
export type StatementList = Statement[]

export interface Assignment {
  kind: "assign"
  target: Expr
  value: Expr
  op?: "S=" | "R=" | "REF=" // IEC set/reset/reference-rebind; undefined for `:=`
  chained?: Expr[] // intermediate l-values of `a := b := c`
  span: Span
}
export interface CallStatement {
  kind: "call_stmt"
  call: CallExpr
  span: Span
}
export interface ExprStatement {
  kind: "expr_stmt"
  expr: Expr
  span: Span
}
export interface TryStatement {
  // __TRY … __CATCH(e) … __FINALLY … __ENDTRY
  kind: "try"
  tryBody: StatementList
  catchVar?: Expr
  catchBody?: StatementList
  finallyBody?: StatementList
  span: Span
}
export interface IfStatement {
  kind: "if"
  branches: IfBranch[]
  elseBody?: StatementList
  span: Span
}
export interface IfBranch {
  kind: "if_branch"
  cond: Expr
  body: StatementList
  span: Span
}
export interface CaseStatement {
  kind: "case"
  selector: Expr
  arms: CaseArm[]
  elseBody?: StatementList
  span: Span
}
export interface CaseArm {
  kind: "case_arm"
  labels: CaseLabel[]
  body: StatementList
  span: Span
}
export interface CaseLabel {
  kind: "case_label"
  value: Expr
  upper?: Expr // `1..5`
  span: Span
}
export interface ForStatement {
  kind: "for"
  controlVar: Expr
  from: Expr
  to: Expr
  by?: Expr
  body: StatementList
  span: Span
}
export interface WhileStatement {
  kind: "while"
  cond: Expr
  body: StatementList
  span: Span
}
export interface RepeatStatement {
  kind: "repeat"
  body: StatementList
  until: Expr
  span: Span
}
export interface ReturnStatement {
  kind: "return"
  span: Span
}
export interface ExitStatement {
  kind: "exit"
  span: Span
}
export interface ContinueStatement {
  kind: "continue"
  span: Span
}
export interface EmptyStatement {
  kind: "empty"
  span: Span
}

// ─── type expressions (structured bounds — the A.1/A.2 refinement) ───────────

export type TypeExpr = NamedType | ArrayType | ReferenceType | PointerType | StringType | ImplicitEnumType

export interface NamedType {
  kind: "named_type"
  name: Identifier
  qualifiers?: Identifier[] // `Tc2_Standard.TON` → ["Tc2_Standard"]
  subrange?: Subrange // `INT(lo..hi)` — structured, not opaque
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
  span: Span
}
export interface ImplicitEnumType {
  kind: "implicit_enum_type"
  values: EnumValue[]
  span: Span
}

// ─── DUT bodies (`TYPE … END_TYPE`) ──────────────────────────────────────────

export type DutBody = StructBody | EnumBody | UnionBody | AliasBody

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
export interface EnumValue {
  kind: "enum_value"
  name: Identifier
  value?: Expr // `:= 42`
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
  nonRetain?: boolean
  persistent?: boolean
  decls: VarDecl[]
  span: Span
}
export interface VarDecl {
  kind: "var_decl"
  names: Identifier[] // `a, b, c : INT;`
  type: TypeExpr
  init?: Initializer // scalar → Expr, aggregate → AggregateInit (was opaque BodySpan)
  at?: BodySpan // `AT %IX0.0` — opaque address
  span: Span
}

// ─── top-level units ─────────────────────────────────────────────────────────

export type TopLevel =
  | FunctionBlock
  | Program
  | Function
  | Method
  | Action
  | Property
  | Interface
  | TypeDecl
  | GlobalVarList
  | Namespace

export interface Namespace {
  kind: "namespace"
  name: Identifier
  units: TopLevel[]
  span: Span
}
export interface FunctionBlock {
  kind: "function_block"
  name: Identifier
  accessModifier?: Keyword
  extends?: Identifier
  /** The illegal 2nd+ bases when the EXTENDS list has more than one (single inheritance only) — drives C0096. */
  extendsExtra?: Identifier[]
  implements?: Identifier[]
  abstract?: boolean
  final?: boolean
  varSections: VarSection[]
  body: BodySpan
  span: Span
}
export interface Program {
  kind: "program"
  name: Identifier
  /** A return type illegally declared on a PROGRAM (`PROGRAM P : BOOL`) — drives C0182. */
  returnType?: TypeExpr
  varSections: VarSection[]
  body: BodySpan
  span: Span
}
export interface Function {
  kind: "function"
  name: Identifier
  returnType?: TypeExpr
  varSections: VarSection[]
  body: BodySpan
  span: Span
}
export interface Method {
  kind: "method"
  name: Identifier
  accessModifier?: Keyword
  final?: boolean
  abstract?: boolean
  override?: boolean
  returnType?: TypeExpr
  varSections: VarSection[]
  body: BodySpan
  span: Span
}
export interface Action {
  kind: "action"
  name: Identifier
  body: BodySpan
  span: Span
}
export interface Property {
  kind: "property"
  name: Identifier
  accessModifier?: Keyword
  dataType: TypeExpr
  getter?: PropertyAccessor
  setter?: PropertyAccessor
  span: Span
}
export interface PropertyAccessor {
  kind: "get" | "set"
  varSections: VarSection[]
  body: BodySpan
  span: Span
}
export interface Interface {
  kind: "interface"
  name: Identifier
  extends?: Identifier[]
  /** An IMPLEMENTS list illegally used on an interface (should be EXTENDS) — drives C0421. */
  implementsMisused?: Identifier[]
  /** VAR sections illegally placed directly in the interface body (interfaces declare signatures only) — drives C0149. */
  strayVarSections?: VarSection[]
  methods: InterfaceMethod[]
  properties: InterfaceProperty[]
  span: Span
}
export interface InterfaceMethod {
  kind: "interface_method"
  name: Identifier
  returnType?: TypeExpr
  varSections: VarSection[]
  span: Span
}
export interface InterfaceProperty {
  kind: "interface_property"
  name: Identifier
  dataType: TypeExpr
  hasGetter: boolean
  hasSetter: boolean
  span: Span
}
export interface TypeDecl {
  kind: "type_decl"
  name: Identifier
  body: DutBody
  span: Span
}
export interface GlobalVarList {
  kind: "global_var_list"
  varSections: VarSection[]
  span: Span
}

// ─── parse result ────────────────────────────────────────────────────────────

export interface ParseError {
  message: string
  span: Span
}
export interface ParseResult {
  units: TopLevel[]
  errors: ParseError[]
}
