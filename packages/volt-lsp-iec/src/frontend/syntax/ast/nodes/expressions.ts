/**
 * THE AST'S LEAVES AND EXPRESSIONS — identifiers, opaque body spans and the `%LANGUAGE` line, the expression
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
  /** A POU body's CODE: what the IDE holds, its `%LANGUAGE` line and the `%`-lines under it taken out. */
  tokens: Token[]
  span: Span
  /** The vocabulary the tokens were lexed with — the statement parser refuses a type name only where the type exists
   *  (`syntax/lex/vocabulary.ts` `isRefusedWord`). */
  dialect: Dialect
  /** Whether the tokens were lexed with names past ASCII — what a re-lex of the body's text reads it with (a network's
   *  Execute code, `network/execute-code.ts`). */
  unicodeIdentifiers: boolean
  /** The `%LANGUAGE <LANG>` line that opened the body — absent for a body with none (`syntax/format/language-line`). */
  languageLine?: LanguageLine
  /** A METHOD's or a property accessor's body with NO `%LANGUAGE` line and nothing after its declaration: a member whose
   *  IDE object has no body slot (DIALECT C2n, openspec `language-line`). A method's property lines close its
   *  declaration (`property-peel.ts` `peelClosingProperties`) and are kept here for what prints the body back. */
  noSlot?: { folder?: string; objectProperties?: readonly string[] }
}

/** What a `%LANGUAGE` line states (`syntax/format/object-properties`, the bridge's `PropertyLines`). */
export type LanguageStatement =
  /** `ST`, `LD` or `FBD`: a body a parser reads. */
  | { kind: "read"; language: "ST" | "LD" | "FBD" }
  /** A language and `UNSUPPORTED` (never ST): a body Volt does not show, empty and read by neither parser. */
  | { kind: "unsupported"; language: string }

export interface LanguageLine {
  /** The line as written, trimmed. */
  text: string
  /** What it states — absent for a line that states no body (`%LANGUAGE CFC`, `%LANGUAGE`), which the parse reports by
   *  name and whose body neither parser reads. */
  statement?: LanguageStatement
  /** From the `%` to the line's last word. */
  span: Span
  /** The words an editor colours as keywords: the whole line. */
  words: Token[]
  /** What stands between the declaration and this line, as written (trimmed), when there is any: comments, pragmas — a
   *  `{warning}` or `{attribute}` pragma means something there — and declaration text the declaration parser did not take
   *  (`END_VAR;`'s `;`). DECLARATION text on the push side, and neither code nor the line, so it is out of the body's
   *  tokens and kept here for what prints the body back. */
  leading?: string
  /** The path of a member's `%FOLDER` directive on the line directly under this one — taken out of the body with the
   *  line, and kept here so what prints the body (the formatter) prints it back. */
  folder?: string
  /** The object's other `%`-lines under this one (`%CLASS`, `%EXCLUDE_FROM_BUILD`, …), as written, in order — its
   *  properties, not code (`property-peel.ts` `peelProperties`); kept so the formatter prints them back. */
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
/** CODESYS assignment-as-expression: `(x := v)`, and in brackets a set or reset `(x S= v)` / `(x R= v)` and a chain
 *  `(a := b := v)` (the value an inline assignment of its own). Worth its value either way. */
export interface AssignExpr {
  kind: "assign_expr"
  target: Expr
  value: Expr
  /** `S=` / `R=`; undefined for `:=`. */
  op?: "S=" | "R="
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
