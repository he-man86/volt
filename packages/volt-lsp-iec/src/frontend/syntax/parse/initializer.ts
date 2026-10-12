/**
 * INITIALIZERS — the right-hand side of a declaration's `:=`: a clean scalar expression stays an `Expr`; anything else
 * (a struct, FB or array aggregate) becomes an `AggregateInit` whose elements are parsed structurally, error-tolerant.
 */
import { REFUSED_PLACEHOLDER, type AggregateElement, type AggregateForm, type AggregateInit, type Initializer, type RefusedInit } from "../ast/nodes/index.js"
import type { Token } from "../lex/tokens.js"
import { eofSpan, joinSpans, zeroSpan } from "../span.js"
import { Cursor } from "./cursor.js"
import { parseExpression, parseExprFromTokens } from "./expression.js"
import { expectedInsteadOf, vendorExpressionExpected, vendorTokenText } from "./errors.js"
import { collectUntilTopLevel } from "./scan.js"
import { isRefusedWord } from "../lex/word-sets.js"

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
 *
 * A SYSTEM NAME THE DIALECT DOES NOT HAVE leading the initializer is refused the same way: `n : DINT := __NO_SUCH_THING;`
 * (`cc_decl_init_dunder_unknown`, both vendors) and, on TwinCAT, which has no `__POSITION`, `here : DINT := __POSITION;` and
 * `… := __POSITION();` (`sysop_position_initializer`, `sysop_position_value`). Every `__` operator a dialect has is its
 * KEYWORD, so the name is an IDENTIFIER spelled `__…` — but the `__SYSTEM` namespace, read through its `.` (corpus:
 * `M_TYPE : __SYSTEM.TYPE_CLASS := __SYSTEM.TYPE_CLASS.TYPE_NONE`). `analysis/checks/declarations/system-initializer`
 * held this until frontend-conformance 2.8.3, from name resolution, which answered every `__` name on CODESYS. The one
 * operator the vocabulary does not list that a vendor documents, TwinCAT's `__TRY_CAST`, is refused there too, on both
 * vendors (`rec_dunder_try_cast_initializer`, 2026-10-02): leading an initializer it is no operator either compiler has.
 *
 * And A REFUSED WORD (`isRefusedWord`, rule R6) as an operand: `x : INT := dint;`, `x : INT := 1 + word;` — the same
 * pair and placeholder (`rec_refused_word_initializer_alone`, `rec_refused_word_initializer`, both vendors 2026-10-02).
 * A callee (`LTIME()`), a lone argument (`XSIZEOF(DINT)`) and a member after a `.` are names, as in a body.
 */
export function refuseMalformedInit(cur: Cursor, tokens: readonly Token[]): RefusedInit | undefined {
  const at = tokens.findIndex((t, i) => t.malformed || (i === 0 && isUnknownSystemName(tokens)) || isRefusedOperand(cur, tokens, i))
  if (at < 0) return undefined
  const bad = tokens[at]!
  const before = tokens.slice(0, at)
  const inAggregate = before.reduce((depth, t) => depth + (t.kind === "punct" ? (t.text === "[" ? 1 : t.text === "]" ? -1 : 0) : 0), 0) > 0
  cur.pushError(expectedInsteadOf(inAggregate ? "',, ( or ]'" : "';'", bad), bad.span)
  cur.pushError(vendorExpressionExpected(bad), bad.span)
  if (inAggregate) return { span: bad.span }
  const value = parseExprFromTokens([...before, { kind: "identifier", text: REFUSED_PLACEHOLDER, span: bad.span }])
  return value === undefined ? { span: bad.span } : { span: bad.span, value }
}

/** Is `tokens[i]` a refused word standing as an operand — not a callee, a lone argument or a member (`refuseMalformedInit`)? */
function isRefusedOperand(cur: Cursor, tokens: readonly Token[], i: number): boolean {
  const t = tokens[i]!
  if (t.kind !== "identifier" || !isRefusedWord(t.text, cur.dialect)) return false
  const before = tokens[i - 1]
  const after = tokens[i + 1]
  const punct = (x: Token | undefined, ...texts: string[]): boolean => x?.kind === "punct" && texts.includes(x.text)
  if (punct(after, "(") || punct(before, ".")) return false
  return !(punct(before, "(", ",") && punct(after, ")", ","))
}

/** An initializer leading with a `__` IDENTIFIER — no system operator the dialect has (those are keywords) — that is not
 *  read through a `.` as the `__SYSTEM` namespace is (`refuseMalformedInit`), nor a platform conversion (`__XINT_TO_DINT`,
 *  rule TY11: it builds there on both vendors, `tr_b5_platform_conversion_initializers`). */
function isUnknownSystemName(tokens: readonly Token[]): boolean {
  const first = tokens[0]
  const next = tokens[1]
  return first?.kind === "identifier" && first.text.startsWith("__") && !PLATFORM_CONVERSION.test(first.text) && !(next?.kind === "punct" && next.text === ".")
}

/** A conversion FROM a platform integer — the only conversion name that starts with `__` (`types/conversion-name.ts` is the
 *  parser of the whole name; syntax sits below types, so only the prefix is read here). */
const PLATFORM_CONVERSION = /^__U?X(?:INT|WORD)_TO_/i

/**
 * AN OPERATOR'S TRAILING COMMA in an initializer is refused as in a body (`parse/expression` `parseCall`): `c : INT :=
 * MAX(1, 2,);` is "Expression expected instead of ')'" at the `)` (`expr_trailing_comma_operator_call_in_initializer`,
 * both vendors 2026-10-02) — where the tokens used to fall through to an aggregate, refused at the `(`. The vendor's value
 * then is `MAX(MAX(SINT#1, 2), !!!'ERROR'!!!)`, which the LSP does not build (a known divergence): no value is kept.
 * Undefined unless the initializer's expression parse stops exactly there; a `STRUCT(…)` is an aggregate, not asked.
 */
function refuseOperatorTrailingComma(cur: Cursor, tokens: readonly Token[]): RefusedInit | undefined {
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
  if (g.length >= 2 && g[1].text === ":=") return { kind: "field", name: g[0].text, value: parseValue(g.slice(2), true), span }
  return parseValue(g)
}

/** `field`: the value of a struct field — where a name then a group is that name's CALL (`c := F(g)`,
 *  `var_temp_dynamic_aggregate_init`), the name-then-group repeat being an ARRAY element's rule only. */
function parseValue(g: Token[], field = false): AggregateElement {
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
  //     block instance expected instead of 'L'" (`decl_repeat_count_expression_names`) — the element is a value;
  //   - a STRUCT FIELD's `F(g)` is a call (`var_temp_dynamic_aggregate_init`: `c := F(g)` evaluated per call).
  const open = g[g.length - 1].text === ")" ? openerOfLast(g) : -1
  const before = open >= 1 ? g[open - 1] : undefined
  const counted = before !== undefined && (open === 1 && !field ? before.kind === "identifier" || isLiteral(before) : isLiteral(before))
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

/**
 * The first token after a COMPLETE scalar initializer, or undefined. `x : INT := 5 abc;` does not compile —
 * "';' expected instead of 'abc'" (conformance `cc_decl_init_trailing_ident`, `_int`, `decl_struct_field_stray_token`) —
 * but the initializer's tokens were collected up to the `;` and anything that did not parse became an opaque aggregate,
 * silently (gap 12). An aggregate shape (`(`, `[`, `STRUCT`) is the aggregate parser's; a malformed literal is
 * `refuseMalformedInit`'s, asked first.
 * ponytail: tries each prefix, longest first — quadratic in the initializer's token count, which is a handful.
 */
function strayAfterScalarInit(tokens: readonly Token[]): Token | undefined {
  const first = tokens[0]
  if (first === undefined || ["(", "[", "STRUCT"].includes(first.text.toUpperCase())) return undefined
  if (parseExprFromTokens(tokens) !== undefined) return undefined
  for (let k = tokens.length - 1; k >= 1; k--) {
    if (parseExprFromTokens(tokens.slice(0, k)) === undefined) continue
    return tokens[k]!
  }
  return undefined
}

/**
 * A declaration's initializer, if one follows its type. Two forms:
 *   - `:= <expr>` / `REF= <target>` — a scalar, a struct `( f := v, … )`, an array literal;
 *   - `[ (…), (…) ]` with no `:=` — an ARRAY OF a function block, element by element (`decl_bracket_init_no_assign_fb`).
 * A clean scalar init becomes an `Expr`; an aggregate stays an `AggregateInit`. WHICH operator it was is kept: a
 * REFERENCE binds its target with `REF=`, and dropping the operator made that declaration indistinguishable from an
 * assignment to whatever the reference points at.
 */
export function parseInitializer(c: Cursor): { init?: Initializer; initOp?: "REF=" | "FB_Init"; refusedInit?: RefusedInit } {
  if (c.peek().kind === "punct" && c.peek().text === "[") {
    const tokens = collectInitTokens(c)
    const refused = refuseBracketElement(c, tokens)
    if (refused !== undefined) return { refusedInit: refused }
    const init = initializerFromTokens(tokens)
    return init === undefined ? {} : { init, initOp: "FB_Init" }
  }
  const assign = c.eatPunct(":=") ?? c.eatPunct("REF=")
  if (assign === undefined) return {}
  const initOp = assign.text === "REF=" ? ("REF=" as const) : undefined
  const op = initOp !== undefined ? { initOp } : {}
  const tokens = collectInitTokens(c)
  // `v : INT := ;` — "Expression expected instead of ';'", and the value is the compiler's placeholder (`decl_init_empty`)
  if (tokens.length === 0) {
    const next = c.peek()
    c.pushError(vendorExpressionExpected(next), next.span)
    return { ...op, refusedInit: { span: next.span, value: { kind: "ident_expr", name: REFUSED_PLACEHOLDER, span: next.span } } }
  }
  const malformed = refuseMalformedInit(c, tokens)
  if (malformed !== undefined) return { ...op, refusedInit: malformed }
  const trailingComma = refuseOperatorTrailingComma(c, tokens)
  if (trailingComma !== undefined) return { ...op, refusedInit: trailingComma }
  const emptyRepeat = refuseEmptyRepeat(c, tokens)
  if (emptyRepeat !== undefined) return { ...op, refusedInit: emptyRepeat }
  const positional = positionalStructInit(c, tokens)
  if (positional !== undefined) return { ...op, ...positional }
  const init = initializerFromTokens(tokens)
  const stray = strayAfterScalarInit(tokens)
  if (stray !== undefined) c.pushError(`';' expected instead of '${stray.text}'`, stray.span)
  return init === undefined ? op : { ...op, init }
}

/** The top-level groups of `tokens` between `[`/`(` and its closer (the outer pair excluded), split at their commas. */
function topLevelGroups(inner: readonly Token[]): Token[][] {
  const groups: Token[][] = [[]]
  let depth = 0
  for (const t of inner) {
    if (t.text === "(" || t.text === "[") depth++
    else if (t.text === ")" || t.text === "]") depth--
    if (depth === 0 && t.text === ",") groups.push([])
    else groups.at(-1)!.push(t)
  }
  return groups
}

/**
 * A `[` straight after the type opens a list of PARENTHESIZED elements — an ARRAY OF a function block's per-element
 * initialization. Any other element is refused at its first token: "'(' expected instead of '1'" (`decl_bracket_init_
 * no_assign`, `_scalar`, `decl_struct_field_bracket_init`, both vendors 2026-10-01; what each vendor says after it is the
 * declaration recovery's, task 2.8.2), and no initializer is kept.
 */
function refuseBracketElement(c: Cursor, tokens: readonly Token[]): RefusedInit | undefined {
  const inner = tokens.at(-1)?.text === "]" ? tokens.slice(1, -1) : tokens.slice(1)
  for (const group of topLevelGroups(inner)) {
    const first = group[0]
    if (first === undefined || first.text === "(") continue
    c.pushError(`'(' expected instead of ${vendorTokenText(first)}`, first.span)
    return { span: first.span }
  }
  return undefined
}

/**
 * A REPEAT COUNT WITH NO VALUE, `[3()]` — "Expression expected instead of ')'" (`decl_repeat_count_empty`, both vendors
 * 2026-10-01), and nothing else: the initializer is gone.
 */
function refuseEmptyRepeat(c: Cursor, tokens: readonly Token[]): RefusedInit | undefined {
  if (tokens[0]?.text !== "[") return undefined
  // the count is a literal that opens an element (`[` or `,` before it) — `F()` is a call with no arguments, not this
  for (let i = 2; i + 1 < tokens.length; i++) {
    if (tokens[i].text !== "(" || tokens[i + 1].text !== ")") continue
    if (!tokens[i - 1].kind.endsWith("_lit") || !["[", ","].includes(tokens[i - 2].text)) continue
    const close = tokens[i + 1]
    c.pushError(vendorExpressionExpected(close), close.span)
    return { span: close.span }
  }
  return undefined
}

/**
 * A PARENTHESIZED LIST WITHOUT FIELD NAMES, `(1, 2)`, is no struct initializer: it is a parenthesized expression `(1`
 * that wants its `)` at the comma, and a declaration that wants its `;` there — "';' expected instead of ','" and "')'
 * expected instead of ','" — after which the compiler keeps the FIRST value as the initializer and type-checks it against
 * the declared type: "Cannot convert type 'SINT' to type 'DUT_…'" (`decl_struct_init_positional_five`, both vendors
 * 2026-10-01). Only that shape — the first element a value, a comma at the top level — is refused so.
 */
function positionalStructInit(c: Cursor, tokens: readonly Token[]): { init?: Initializer; refusedInit?: RefusedInit } | undefined {
  if (tokens[0]?.text !== "(" || tokens.at(-1)?.text !== ")") return undefined
  const groups = topLevelGroups(tokens.slice(1, -1))
  if (groups.length < 2) return undefined
  const first = groups[0]!
  if (first.length === 0 || first[1]?.text === ":=") return undefined
  const comma = tokens[first.length + 1]!
  c.pushError(`';' expected instead of ${vendorTokenText(comma)}`, comma.span)
  c.pushError(`')' expected instead of ${vendorTokenText(comma)}`, comma.span)
  const value = parseExprFromTokens(first)
  return value === undefined ? { refusedInit: { span: comma.span } } : { init: value }
}
