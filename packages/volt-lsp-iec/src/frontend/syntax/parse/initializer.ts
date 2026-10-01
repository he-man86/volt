/**
 * INITIALIZERS — the right-hand side of a declaration's `:=`: a clean scalar expression stays an `Expr`; anything else
 * (a struct, FB or array aggregate) becomes an `AggregateInit` whose elements are parsed structurally, error-tolerant.
 */
import { REFUSED_PLACEHOLDER, type AggregateElement, type AggregateForm, type AggregateInit, type Initializer, type RefusedInit } from "../ast/nodes.js"
import type { Token } from "../lex/tokens.js"
import { eofSpan, joinSpans, zeroSpan } from "../span.js"
import { Cursor } from "./cursor.js"
import { parseExpression, parseExprFromTokens } from "./expression.js"
import { vendorExpressionExpected, vendorTokenText } from "./errors.js"
import { collectUntilTopLevel } from "./scan.js"

/**
 * Collect an initializer's RHS tokens, depth-aware over `()`/`[]`, up to a top-level
 * `;` (and `END_TYPE`, for TYPE-body inits). Used by every declaration-initializer site.
 */
export function collectInitTokens(cur: Cursor, stopAtEndType = false): Token[] {
  return collectUntilTopLevel(
    cur,
    (t) => (t.kind === "punct" && t.text === ";") || (stopAtEndType && t.kind === "keyword" && t.keyword === "END_TYPE"),
  )
}

/**
 * THE FIRST MALFORMED LITERAL in an initializer's tokens (`Token.malformed`), reported as both vendors report it there:
 * the declaration ENDS at it — "';' expected instead of 'X'", "Expression expected instead of 'X'", nothing about the
 * tokens after it — and the value is what was read before it with the literal as the compiler's placeholder
 * (`RefusedInit.value`): `!!!'ERROR'!!!` when the literal leads (`cc_time_microsecond_literal`, `esc_wstring_hex_*`,
 * `lit_init_bool_typed_true`), `(1 + !!!'ERROR'!!!)` after an operator (`lit_init_malformed_not_leading`). Inside an
 * open `[` aggregate it is the AGGREGATE that wants its next token — "',, ( or ]' expected instead of 'X'" — and there is
 * no value to convert (`lit_init_malformed_in_aggregate`). Undefined when there is no malformed literal.
 */
export function refuseMalformedInit(cur: Cursor, tokens: readonly Token[]): RefusedInit | undefined {
  const at = tokens.findIndex((t) => t.malformed)
  if (at < 0) return undefined
  const bad = tokens[at]!
  const before = tokens.slice(0, at)
  const inAggregate = before.reduce((depth, t) => depth + (t.kind === "punct" ? (t.text === "[" ? 1 : t.text === "]" ? -1 : 0) : 0), 0) > 0
  cur.pushError(`${inAggregate ? "',, ( or ]'" : "';'"} expected instead of ${vendorTokenText(bad)}`, bad.span)
  cur.pushError(vendorExpressionExpected(bad), bad.span)
  if (inAggregate) return { span: bad.span }
  const value = parseExprFromTokens([...before, { kind: "identifier", text: REFUSED_PLACEHOLDER, span: bad.span }])
  return value === undefined ? { span: bad.span } : { span: bad.span, value }
}

/**
 * AN OPERATOR'S TRAILING COMMA in an initializer is refused as in a body (`parse/expression` `parseCall`): `c : INT :=
 * MAX(1, 2,);` is "Expression expected instead of ')'" at the `)` (`expr_trailing_comma_operator_call_in_initializer`,
 * both vendors 2026-10-02) — where the tokens used to fall through to an aggregate, refused at the `(`. The vendor's value
 * then is `MAX(MAX(SINT#1, 2), !!!'ERROR'!!!)`, which the LSP does not build (a known divergence): no value is kept.
 * Undefined unless the initializer's expression parse stops exactly there; a `STRUCT(…)` is an aggregate, not asked.
 */
export function refuseOperatorTrailingComma(cur: Cursor, tokens: readonly Token[]): RefusedInit | undefined {
  if (tokens.length === 0 || tokens.some((t) => t.kind === "keyword" && t.keyword === "STRUCT")) return undefined
  const last = tokens[tokens.length - 1]!
  const sub = new Cursor([...tokens, { kind: "eof", text: "", span: eofSpan(last.span) }])
  parseExpression(sub)
  const errors = sub.getErrors()
  const at = tokens.findIndex((t) => t.span === errors.at(-1)?.span)
  if (at < 1 || tokens[at]!.text !== ")" || tokens[at - 1]!.text !== ",") return undefined
  if (errors.at(-1)!.message !== vendorExpressionExpected(tokens[at]!)) return undefined
  for (const e of errors) cur.pushParseError(e)
  return { span: tokens[at]!.span }
}

/**
 * Turn collected initializer tokens into an `Initializer`: a clean scalar expression
 * (parses to a single `Expr` consuming every token, no errors) stays an `Expr`;
 * anything else — a struct/FB/array aggregate — becomes an opaque `AggregateInit`.
 */
export function initializerFromTokens(tokens: Token[]): Initializer | undefined {
  if (tokens.length === 0) return undefined
  const expr = parseExprFromTokens(tokens)
  // `(y := 7)` parses as a parenthesized inline assignment, but a declaration assigns nothing: it is a one-field struct or
  // FB initializer (conformance `init_struct_by_field`, `init_fb_instance_inputs`). `STRUCT(x := 20)` parses as a call,
  // and is the same initializer spelled with its keyword.
  const aggregate =
    (expr?.kind === "paren" && expr.inner.kind === "assign_expr") ||
    (expr?.kind === "call" && expr.callee.kind === "ident_expr" && expr.callee.name.toUpperCase() === "STRUCT")
  if (expr !== undefined && !aggregate) return expr
  const first = tokens[0]
  const last = tokens[tokens.length - 1]
  const { form, elements } = parseAggregate(tokens)
  const agg: AggregateInit = { kind: "aggregate_init", form, elements, tokens, span: joinSpans(first.span, last.span) }
  return agg
}

// ─── aggregate-initializer element parser ────────────────────────────────────
// Turns the raw aggregate tokens (`[…]` / `(…)` / `STRUCT(…)`) into a structured element list. Total and
// error-tolerant: an element it can't classify becomes `unparsed`; an unrecognized outer shape → `unknown`.

/** Parse aggregate `tokens` (including the outer delimiters) into a form + top-level elements. */
function parseAggregate(tokens: Token[]): { form: AggregateForm; elements: AggregateElement[] } {
  const peeled = peelAggregate(tokens)
  if (peeled === undefined) return { form: "unknown", elements: [] }
  return { form: peeled.form, elements: splitTopLevel(peeled.inner).map(parseElement) }
}

/** Strip the outer delimiter, returning the form and the inner token slice, or undefined for an unknown shape. */
function peelAggregate(t: Token[]): { form: AggregateForm; inner: Token[] } | undefined {
  const last = t[t.length - 1]?.text
  if (t[0]?.text === "[" && last === "]") return { form: "array", inner: t.slice(1, -1) }
  if (t[0]?.text === "STRUCT" && t[1]?.text === "(" && last === ")") return { form: "struct", inner: t.slice(2, -1) }
  if (t[0]?.text === "(" && last === ")") return { form: "struct", inner: t.slice(1, -1) }
  return undefined
}

/** Split tokens on commas at bracket-depth 0 (so nested `[…]`/`(…)` stay intact). */
function splitTopLevel(toks: Token[]): Token[][] {
  const groups: Token[][] = []
  let cur: Token[] = []
  let depth = 0
  for (const tok of toks) {
    if (tok.text === "[" || tok.text === "(") depth++
    else if (tok.text === "]" || tok.text === ")") depth--
    if (tok.text === "," && depth === 0) {
      groups.push(cur)
      cur = []
    } else cur.push(tok)
  }
  if (cur.length > 0) groups.push(cur)
  return groups
}

function parseElement(g: Token[]): AggregateElement {
  if (g.length === 0) return { kind: "unparsed", span: zeroSpan() }
  const span = joinSpans(g[0].span, g[g.length - 1].span)
  if (g.length >= 2 && g[1].text === ":=") return { kind: "field", name: g[0].text, value: parseValue(g.slice(2)), span }
  return parseValue(g)
}

function parseValue(g: Token[]): AggregateElement {
  if (g.length === 0) return { kind: "unparsed", span: zeroSpan() }
  const span = joinSpans(g[0].span, g[g.length - 1].span)
  const lead = g[0].text
  // Nested aggregate: `[…]`, `(…)`, or `STRUCT(…)` spanning the whole group.
  if ((lead === "[" || lead === "(" || (lead === "STRUCT" && g[1]?.text === "(")) && isBalancedAggregate(g)) {
    const sub = parseAggregate(g)
    const init: AggregateInit = { kind: "aggregate_init", form: sub.form, elements: sub.elements, tokens: g, span }
    return { kind: "nested", init, span }
  }
  // Repeat: `<count>(<value>)`, as CODESYS reads it (2026-10-01):
  //   - a NAME then the group that closes the element is a repeat, the name its count: `[1, i(7)]` is C0162's "Number
  //     'i' of array initialisations is no constant value" (`error-catalog.json`, both vendors);
  //   - a group after a LITERAL is a repeat whose count is the whole expression before it: `[INT#2+INT#3(7)]` is five
  //     sevens (`decl_repeat_count_expression`), as `[5(7)]` is — a literal is no callee;
  //   - a group after a name INSIDE an expression is that name's call: `[K+L(7)]` is "Program name, function or function
  //     block instance expected instead of 'L'" (`decl_repeat_count_expression_names`) — the element is a value.
  const open = g[g.length - 1].text === ")" ? openerOfLast(g) : -1
  const before = open >= 1 ? g[open - 1] : undefined
  const counted = before !== undefined && (open === 1 ? before.kind === "identifier" || isLiteral(before) : isLiteral(before))
  if (counted && g.length - open >= 3 && lead !== "[" && lead !== "(" && lead !== "STRUCT") {
    const count = parseExprFromTokens(g.slice(0, open))
    if (count !== undefined) return { kind: "repeat", count, value: parseValue(g.slice(open + 1, -1)), span }
  }
  const expr = parseExprFromTokens(g)
  return expr !== undefined ? { kind: "value", expr, span } : { kind: "unparsed", span }
}

/** A literal token — no callee, so a `(` after it opens a repeat's value. */
const isLiteral = (t: Token): boolean => t.kind.endsWith("_lit") && t.kind !== "address_lit"

/** The index of the `(` the last token `)` of `g` closes, or -1. */
function openerOfLast(g: Token[]): number {
  let depth = 0
  for (let i = g.length - 1; i >= 0; i--) {
    const t = g[i].text
    if (t === ")" || t === "]") depth++
    else if (t === "(" || t === "[") {
      depth--
      if (depth === 0) return t === "(" ? i : -1
    }
  }
  return -1
}

/** True when the first bracket opened in `g` closes exactly at the last token (a single balanced aggregate). */
function isBalancedAggregate(g: Token[]): boolean {
  let depth = 0
  for (let i = 0; i < g.length; i++) {
    const t = g[i].text
    if (t === "[" || t === "(") depth++
    else if (t === "]" || t === ")") {
      depth--
      if (depth === 0) return i === g.length - 1
    }
  }
  return false
}
