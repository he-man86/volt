/**
 * THE AST'S LEAVES AND EXPRESSIONS — identifiers, opaque body spans and the `IMPLEMENTATION` line, the expression
 * tree, and the initializers built of it. One family of `ast/nodes/` (openspec lsp-same-standard design.md §8).
 */
import type { Token } from "../../lex/tokens.js"
import type { Dialect } from "../../lex/vocabulary.js"
import type { Span } from "../../span.js"

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
  /** The vocabulary the tokens were lexed with — the statement parser refuses a type name only where the type exists
   *  (`syntax/lex/vocabulary.ts` `isRefusedWord`). */
  dialect: Dialect
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
  /** `IMPLEMENTATION NONE`: a member the IDE holds with NO body slot (a CODESYS abstract method or abstract property's
   *  GET — openspec `abstract-member-push`, DIALECT C2n). No language; nothing under it, read by neither parser. Not
   *  `IMPLEMENTATION NONE UNSUPPORTED`, which is a hidden body of a vendor language spelled NONE. */
  | { kind: "none" }
  // A line that only LOOKS like the boundary — the keyword alone, a bare CFC/SFC/IL, a word no body can state — is no
  // boundary line and so no statement (openspec bridge-refusal-review D9): it is code, named only as the hint of the
  // finding for a body that states no language (`lookalikeLine`).

export interface ImplementationLine {
  /** The line as written, trimmed. */
  text: string
  statement: ImplementationStatement
  /** From the keyword to the line's last word. */
  span: Span
  /** The words an editor colours as keywords: the whole statement. */
  words: Token[]
  /** The comments and pragmas between the declaration and this line, as written (trimmed), when there are any. They
   *  are DECLARATION text on the push side — a `{warning}` or `{attribute}` pragma means something there — and neither
   *  code nor the line, so they are out of the body's tokens and kept here for what prints the body back. */
  leading?: string
  /** The path of a member's `%FOLDER` directive on the line directly under this one — taken out of the body with the
   *  line, and kept here so what prints the body (the formatter) prints it back. */
  folder?: string
  /** The object's other `%`-lines under this one (`%CLASS`, `%EXCLUDE_FROM_BUILD`, …), as written, in order — its
   *  properties, not code (`object-properties.ts` `peelProperties`); kept so the formatter prints them back. */
  objectProperties?: readonly string[]
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
  | GlobalExpr

export interface IdentExpr {
  kind: "ident_expr"
  name: string
  span: Span
}

/**
 * THE GLOBAL-NAMESPACE OPERATOR — a leading dot, `.gv`: the name looked up past every local scope, in the global one only
 * (rule E33; `expr_global_namespace_*`, both vendors 2026-10-02: `.gShadow` reads the global past a local of the same
 * name, `.loc` naming only a local is "There is no global definition for 'loc'", a space may stand after the dot). Its
 * own node, not a flag on `IdentExpr`: every reader that resolves an `ident_expr` resolves it LOCALS FIRST, which is the
 * one thing this name is not — so `name` is no CHILD of the tree (`exprChildren` stops here), and a reader that does not
 * know the node has to say so rather than resolve it the wrong way.
 */
export interface GlobalExpr {
  kind: "global_expr"
  /** The name after the dot, with its own span. */
  name: IdentExpr
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
