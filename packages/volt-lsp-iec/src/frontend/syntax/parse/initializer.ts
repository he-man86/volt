/**
 * INITIALIZERS — the right-hand side of a declaration's `:=`: a clean scalar expression stays an `Expr`; anything else
 * (a struct, FB or array aggregate) becomes an `AggregateInit` whose elements are parsed structurally, error-tolerant.
 */
import type { AggregateElement, AggregateForm, AggregateInit, Initializer } from "../ast/nodes.js"
import type { Token } from "../lex/tokens.js"
import { joinSpans, zeroSpan } from "../span.js"
import type { Cursor } from "./cursor.js"
import { parseExprFromTokens } from "./expression.js"
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
  // Repeat: `<count>(<value>)` — count is a single leading token, not a delimiter.
  if (g.length >= 4 && g[1]?.text === "(" && g[g.length - 1].text === ")" && lead !== "[" && lead !== "(" && lead !== "STRUCT") {
    const count = parseExprFromTokens([g[0]])
    if (count !== undefined) return { kind: "repeat", count, value: parseValue(g.slice(2, -1)), span }
  }
  const expr = parseExprFromTokens(g)
  return expr !== undefined ? { kind: "value", expr, span } : { kind: "unparsed", span }
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
