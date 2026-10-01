/**
 * The complete IEC 61131-3 Structured Text AST.
 *
 * The AST models the language *completely* so consumers read structured nodes and never re-parse spans
 * (`docs/data-model.md`). Concretely:
 *   - type-expr bounds are STRUCTURED: subrange `{ lo, hi }`, array dims as const-expr
 *     nodes, string length as an expr — not opaque `BodySpan`s re-parsed ad hoc.
 *   - literals carry a parsed `value`; the *type* is inferred in layer C (types/infer)
 *     from `literalKind` + `value`, so const-eval/overflow checks never re-lex `text`.
 *     (The literal Type is NOT stored here — that would be an upward import into C.)
 *   - initializers are expression trees (`Expr`), not `BodySpan`s.
 * `BodySpan` survives only for genuinely-opaque ranges: a POU body (parsed on demand)
 * and an `AT` address.
 *
 * Ownership: `syntax/ast/nodes` owns every AST node type. Nobody redefines a node elsewhere.
 */
import type { Span } from "../span.js"
import type { Token } from "../lex/tokens.js"
import type { Dialect, Keyword } from "../lex/vocabulary.js"

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
  /** A POU body's CODE: what the IDE holds, its keyword line (and a member's `%FOLDER` under it) taken out. */
  tokens: Token[]
  span: Span
  /** The `IMPLEMENTATION <LANG>` line that opened the body — absent for a body that opens with anything else
   *  (`syntax/format/implementation-line`). */
  implementation?: ImplementationLine
}

/** What an `IMPLEMENTATION` line states (`syntax/format/implementation-line`, the bridge's `ImplementationMarker`). */
export type ImplementationStatement =
  /** `ST`, `LD` or `FBD`: a body a parser reads. */
  | { kind: "read"; language: "ST" | "LD" | "FBD" }
  /** A language and `UNSUPPORTED` (never ST): a body Volt does not show, empty and read by neither parser. */
  | { kind: "unsupported"; language: string }
  /** `CFC`, `SFC` or `IL` without `UNSUPPORTED`: no line a body can state since section 3b, reported naming the line to
   *  write. Its own kind so the finding can name that line; read by neither parser. */
  | { kind: "bare-hidden"; language: string }
  /** The keyword alone. */
  | { kind: "no-language" }
  /** The keyword and something no body can state (`XYZ`, `LD;`, `ST UNSUPPORTED`, `LD // note`). */
  | { kind: "not-a-language"; stated: string }

export interface ImplementationLine {
  /** The line as written, trimmed. */
  text: string
  statement: ImplementationStatement
  /** From the keyword to the line's last word. */
  span: Span
  /** The words an editor colours as keywords: the whole statement when it states one, else the keyword alone. */
  words: Token[]
  /** The comments and pragmas between the declaration and this line, as written (trimmed), when there are any. They
   *  are DECLARATION text on the push side — a `{warning}` or `{attribute}` pragma means something there — and neither
   *  code nor the line, so they are out of the body's tokens and kept here for what prints the body back. */
  leading?: string
  /** The path of a member's `%FOLDER` directive on the line directly under this one — taken out of the body with the
   *  line, and kept here so what prints the body (the formatter) prints it back. */
  folder?: string
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
  | JmpStatement
  | LabelStatement
  | ExprStatement
  | EmptyStatement
export type StatementList = Statement[]

export interface Assignment {
  kind: "assign"
  target: Expr
  value: Expr
  op?: "S=" | "R=" | "REF=" // IEC set/reset/reference-rebind; undefined for `:=` — the operator after `target`
  chained?: Expr[] // intermediate l-values of `a := b := c` / `a S= b R= c`
  /** The operator AFTER each `chained[i]` (undefined for `:=`), parallel to `chained`. A chain can MIX operators —
   *  `a S= b R= c` compiles in CODESYS (conformance `set_reset_chained`) — so one `op` for the whole chain is not
   *  enough, and the formatter printing that one `op` for every link silently rewrote `R=` into `S=`. */
  chainOps?: ("S=" | "R=" | "REF=" | undefined)[]
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
  /**
   * The statement the vendor RESUMED at after refusing a token before it — `NS;` in `t := T#5NS;`, `RUE;` in
   * `b := BOOL#TRUE;` (`parse/errors.ts` `reportStatementCascade`). Both vendors warn it has no effect although nothing
   * declares the name: a body that did not parse is never resolved, and the warning does not need it
   * (`cc_time_nanosecond_literal`, `lit_bool_typed_true`).
   */
  resumed?: true
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
/** `JMP <label>;` — CODESYS/TwinCAT jump. `target` is a bare IdentExpr for a real label; anything else
 *  (a numeric literal, an expression) is an invalid destination (C0114) the label check flags. */
export interface JmpStatement {
  kind: "jmp"
  target: Expr
  span: Span
}
/** A jump label `<name>:` at statement start (distinct from `:=` assignment and CASE labels). */
export interface LabelStatement {
  kind: "label"
  name: Identifier
  span: Span
}

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
  span: Span
}
export interface ImplicitEnumType {
  kind: "implicit_enum_type"
  values: EnumValue[]
  /** `e : (A, B) INT` — the base type written after the values (`decl_implicit_enum_with_base`). */
  baseType?: TypeExpr
  span: Span
}

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
  persistent?: boolean
  decls: VarDecl[]
  span: Span
}
export interface VarDecl {
  kind: "var_decl"
  names: Identifier[] // `a, b, c : INT;`
  type: TypeExpr
  init?: Initializer // scalar → Expr, aggregate → AggregateInit (was opaque BodySpan)
  /**
   * WHICH OPERATOR introduced `init` — `REF=` for a reference bind, undefined for `:=`.
   *
   * The parser accepted both and recorded neither, so `r : REFERENCE TO UDINT REF= v` reached every consumer as
   * an ordinary assignment. Lowering then bound no target and refused every read of `r` as `pointer-order` — the
   * single largest line in that refusal's histogram (141 corpus POUs, `ONTIME.fb`'s `refSeconds`). The
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
  /** Its END_NAMESPACE as written — absent when the text runs out first (the keyword line alone is a text the push hands
   *  the IDE, rule U28) and on a library's namespace, which no text spells. The printer writes a closer only where one
   *  stood. */
  closer?: Span
  span: Span
}
export interface FunctionBlock {
  kind: "function_block"
  name: Identifier
  /** Every modifier as written, in order (`PUBLIC FINAL`): the header's text, kept so a check reads it and the formatter
   *  prints it back as written (conformance 2.4.3). An access modifier stands only first; one written later is kept here
   *  too — it is the file's text — and refused by the parser (`parse/names` `refusedAccessModifier`). */
  modifiers: Keyword[]
  /** An access modifier written after another modifier (`FUNCTION_BLOCK FINAL PUBLIC X`): both vendors then declare no
   *  FB at all and say nothing about the header — only "Unknown type" where it is used (`unit_fb_final_public_order`,
   *  `unit_fb_public_internal`, 2026-10-01). The binder declares no symbol for it. */
  headerRefused?: true
  extends?: Identifier
  /** The illegal 2nd+ bases when the EXTENDS list has more than one (single inheritance only) — drives C0096. */
  extendsExtra?: Identifier[]
  implements?: Identifier[]
  varSections: VarSection[]
  body: BodySpan
  span: Span
}
export interface Program {
  kind: "program"
  name: Identifier
  /** A return type illegally declared on a PROGRAM (`PROGRAM P : BOOL`) — drives C0182. */
  returnType?: TypeExpr
  /** A `: <type>` the parser refused (`METHOD M : final`; `__VECTOR` on TwinCAT) — `returnType` is then absent, and this
   *  says it was DECLARED, so nothing reads the unit as one that returns nothing. */
  returnTypeRefused?: true
  varSections: VarSection[]
  body: BodySpan
  span: Span
}
export interface Function {
  kind: "function"
  name: Identifier
  returnType?: TypeExpr
  /** A `: <type>` the parser refused (`METHOD M : final`; `__VECTOR` on TwinCAT) — `returnType` is then absent, and this
   *  says it was DECLARED, so nothing reads the unit as one that returns nothing. */
  returnTypeRefused?: true
  /** An illegal `IMPLEMENTS` clause on a FUNCTION (only FBs implement interfaces) — drives C0145. */
  implementsMisused?: Identifier[]
  /** An illegal `EXTENDS` clause on a FUNCTION — its base is never found (`hdr_function_extends_no_return`). */
  extendsMisused?: Identifier
  varSections: VarSection[]
  body: BodySpan
  span: Span
}
export interface Method {
  kind: "method"
  name: Identifier
  /** Every modifier as written, in order (`PUBLIC FINAL`): the header's text, kept so a check reads it and the formatter
   *  prints it back as written (conformance 2.4.3). An access modifier stands only first; one written later is kept here
   *  too — it is the file's text — and refused by the parser (`parse/names` `refusedAccessModifier`). */
  modifiers: Keyword[]
  returnType?: TypeExpr
  /** A `: <type>` the parser refused (`METHOD M : final`; `__VECTOR` on TwinCAT) — `returnType` is then absent, and this
   *  says it was DECLARED, so nothing reads the unit as one that returns nothing. */
  returnTypeRefused?: true
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
  /** Every modifier as written, in order (`PUBLIC ABSTRACT`): declaration text the push keeps, so the formatter prints
   *  it back — eaten and dropped, formatting rewrote the member's signature. */
  modifiers: Keyword[]
  /** The member's `%FOLDER` path: the last line of its declaration, where the push reads it
   *  (`StReader.PeelFolderClosing`). Kept so the formatter prints it back — skipped, the next push read "no folder". */
  folder?: string
  dataType: TypeExpr
  getter?: PropertyAccessor
  setter?: PropertyAccessor
  span: Span
}
export interface PropertyAccessor {
  kind: "get" | "set"
  /** Every modifier as written, in order (`PUBLIC ABSTRACT`): declaration text the push keeps, so the formatter prints
   *  it back — eaten and dropped, formatting rewrote the member's signature. */
  modifiers: Keyword[]
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
  /** VAR sections illegally placed directly in the interface body (interfaces declare signatures only) — drives
   *  C0149, which fires once an FB IMPLEMENTS the interface (an interface nobody implements is never compiled). */
  strayVarSections?: VarSection[]
  methods: InterfaceMethod[]
  properties: InterfaceProperty[]
  span: Span
}
export interface InterfaceMethod {
  kind: "interface_method"
  name: Identifier
  /** Every modifier as written, in order (`PUBLIC ABSTRACT`): declaration text the push keeps, so the formatter prints
   *  it back — eaten and dropped, formatting rewrote the member's signature. */
  modifiers: Keyword[]
  /** The member's `%FOLDER` path: the last line of its declaration, where the push reads it
   *  (`StReader.PeelFolderClosing`). Kept so the formatter prints it back — skipped, the next push read "no folder". */
  folder?: string
  returnType?: TypeExpr
  varSections: VarSection[]
  span: Span
}
export interface InterfaceProperty {
  kind: "interface_property"
  name: Identifier
  /** Every modifier as written, in order (`PUBLIC ABSTRACT`): declaration text the push keeps, so the formatter prints
   *  it back — eaten and dropped, formatting rewrote the member's signature. */
  modifiers: Keyword[]
  /** The member's `%FOLDER` path: the last line of its declaration, where the push reads it
   *  (`StReader.PeelFolderClosing`). Kept so the formatter prints it back — skipped, the next push read "no folder". */
  folder?: string
  dataType: TypeExpr
  hasGetter: boolean
  hasSetter: boolean
  /** The VAR sections each accessor declares — the vendor's stored content, not a body (DIALECT D21: an interface
   *  accessor has none). Kept so the formatter prints them back; read and dropped, formatting deleted them (U21). */
  getterVarSections: VarSection[]
  setterVarSections: VarSection[]
  span: Span
}
export interface TypeDecl {
  kind: "type_decl"
  name: Identifier
  body: DutBody
  /** An `EXTENDS Base` clause on a non-STRUCT DUT (enum/alias → C0144, union → C0542) — inheritance is only
   *  legal on structs (and FBs/interfaces). The parser sets this only in the illegal case. */
  extendsMisused?: Identifier
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
  /**
   * THE TOKEN THIS IS THE "Unexpected token" ERROR ABOUT — set only for that one shape, and only so the
   * analysis layer can word it per vendor (CODESYS "token", TwinCAT "Token"; measured 2026-09-20 on `echo_*`
   * and every reserved-name cascade). The parser stays vendor-blind: it carries the FACT and `message` keeps a
   * readable default, and `checkParseErrors` — which knows the vendor — renders the final wording. Without
   * this the only other way to reach TwinCAT's spelling is a vendor-aware parser, which is a much larger
   * change than one capital letter is worth.
   */
  unexpectedToken?: string
  /**
   * A GLOBAL missing its `;` after the type (`endAfterType` in a VAR_GLOBAL section). A vendor FACT like
   * `unexpectedToken`: TwinCAT reports it, CODESYS reports nothing for it in a GVL (conformance
   * `pwh_gvl_missing_semicolon`, measured on both 2026-09-30), and only the analysis layer knows the vendor.
   */
  globalMissingSemicolon?: true
  /**
   * A CALL OPERATOR WRITTEN WITHOUT ITS `(` — "'ABS' needs exactly '1' operands" (`CALL_OPERATOR_OPERANDS`). A fact like
   * `unexpectedToken`, for the same reason: TwinCAT capitalises "Operands", and only the analysis layer knows the vendor.
   */
  operandCount?: { operator: string; count: number; atLeast: boolean }
  /**
   * AN `AT` OPERAND THAT IS NO ADDRESS — a size letter and no position, `AT %IW*` / `AT %MW`: "Direct address expected
   * after AT instead of %IW" (`lit_address_incomplete_sized`, `lit_address_no_position`). A fact like `unexpectedToken`:
   * TwinCAT words it 'Direct Address expected after "AT" instead of %IW', and only the analysis layer knows the vendor.
   */
  directAddressExpected?: string
  /**
   * A VAR SECTION INSIDE A STRUCT, by its keyword (`parse/declarations` `refuseSectionInStruct`) — the placement error the
   * vendors word each their own way ("VAR_TEMP declaration not allowed in this place" / "'VAR_TEMP' declaration …",
   * `decl_<kw>_inside_struct`). A fact like `unexpectedToken`: only the analysis layer knows the vendor.
   */
  sectionInStruct?: VarSectionKind
  /**
   * …and that section ECHOED as the compiler reads it back — "Variable declaration expected instead of VAR\r\n\ta:INT;
   * \r\nEND_VAR\r\n" (`decl_var_inside_struct*`). The keyword as echoed (none for VAR_INST and VAR_CONFIG) and the
   * declarations; the analysis writes the text, as it prints types and values (the parser imports no printer).
   */
  sectionEcho?: { keyword: string; decls: readonly VarDecl[] }
}
export interface ParseResult {
  units: TopLevel[]
  errors: ParseError[]
  /**
   * NAMES A DECLARATION TRIED TO DECLARE AND COULD NOT, lower-cased — so the semantic pass can stay quiet about
   * every later use of one.
   *
   * A declaration that fails to parse binds nothing, and then every mention of the name downstream is undefined
   * and each is reported. CODESYS stops at the parse error. That cascade is the whole reason the sixteen reserved
   * IL operator names are not in the keyword table: adding them cost 44 LSP-only messages against 16 real misses
   * (`docs/reserved-il-operators.md`). It is not specific to them — ANY malformed declaration does it, and the only
   * reason it has been invisible is that no fixture had a malformed declaration AND a later use of the name.
   */
  failedDeclarations: string[]
  /**
   * The token stream the parse read — trivia included, lexed ONCE with the parse's dialect. A consumer that needs the
   * tokens (a check reading pragmas or literals as written) reads them here rather than lexing the source a second
   * time, possibly with another vocabulary.
   */
  tokens: readonly Token[]
  /** The vocabulary `tokens` were lexed with — so a consumer reading them can refuse a parse made for another vendor
   *  (`computeSemanticDiagnostics`) instead of answering with the wrong vocabulary. */
  dialect: Dialect
}
