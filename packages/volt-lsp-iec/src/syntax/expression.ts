/**
 * ST expression parser — precedence-climbing (Pratt) over a `Cursor`.
 *
 * Produces the `Expr` tree from `ast.ts`. Every function returns
 * `undefined` on failure and records an error on the cursor (never
 * throws); the statement parser turns "any error / unconsumed tokens"
 * into the body-level `ok = false` fallback, so no parse-error
 * diagnostic ever reaches the user from body parsing.
 *
 * Grammar and precedence follow IEC 61131-3, cross-checked against
 * RuSTy's `expressions_parser.rs` (see
 * `openspec/changes/st-body-ast/design.md` D1a): OR < XOR < AND <
 * equality < comparison < additive < multiplicative < exponent, with
 * exponent right-associative and postfix (`.` `[]` `^` `()`) binding
 * tightest.
 */
import type { Span } from "./span.js"
import type { Token } from "./tokens.js"
import { Cursor } from "./cursor.js"
import type {
  AggregateElement,
  AggregateForm,
  AggregateInit,
  CallArg,
  CallExpr,
  Expr,
  IdentExpr,
  Initializer,
  Literal,
  LiteralKind,
} from "./ast.js"
import { parseLiteralValue } from "./literal-value.js"

// ─── Precedence table (task 1.3) — lowest binding first ──────────────
const BINARY_PRECEDENCE: ReadonlyArray<{
  ops: readonly string[]
  prec: number
  rightAssoc?: boolean
}> = [
  { ops: ["OR", "OR_ELSE"], prec: 1 },
  { ops: ["XOR"], prec: 2 },
  { ops: ["AND", "AND_THEN", "&"], prec: 3 },
  { ops: ["=", "<>"], prec: 4 },
  { ops: ["<", ">", "<=", ">="], prec: 5 },
  { ops: ["+", "-"], prec: 6 },
  { ops: ["*", "/", "MOD"], prec: 7 },
  { ops: ["**"], prec: 8, rightAssoc: true },
]

const OP_INFO: ReadonlyMap<string, { prec: number; rightAssoc: boolean }> = new Map(
  BINARY_PRECEDENCE.flatMap((row) =>
    row.ops.map((op) => [op, { prec: row.prec, rightAssoc: row.rightAssoc ?? false }] as const),
  ),
)

/** Keywords that are operators (not names), excluded from primary/ident position. */
const OPERATOR_KEYWORDS: ReadonlySet<string> = new Set([
  "AND",
  "AND_THEN",
  "OR",
  "OR_ELSE",
  "XOR",
  "NOT",
  "MOD",
  "TRUE",
  "FALSE",
])

const LIT_KIND: Partial<Record<Token["kind"], LiteralKind>> = {
  int_lit: "int",
  real_lit: "real",
  string_lit: "string",
  wstring_lit: "wstring",
  time_lit: "time",
  date_lit: "date",
  tod_lit: "tod",
  datetime_lit: "datetime",
  typed_lit: "typed",
  address_lit: "address",
}

function merge(a: Span, b: Span): Span {
  return {
    start: a.start,
    end: b.end,
    startLine: a.startLine,
    startCol: a.startCol,
    endLine: b.endLine,
    endCol: b.endCol,
  }
}

/** Canonical operator string for a token, or undefined if it's not a binary operator. */
function binaryOp(t: Token): { op: string; prec: number; rightAssoc: boolean } | undefined {
  const key = t.kind === "keyword" ? t.keyword : t.kind === "punct" ? t.text : undefined
  if (key === undefined) return undefined
  const info = OP_INFO.get(key)
  return info === undefined ? undefined : { op: key, ...info }
}

/** Prefix unary operator text, or undefined. */
function unaryOp(t: Token): string | undefined {
  if (t.kind === "keyword" && t.keyword === "NOT") return "NOT"
  if (t.kind === "punct" && (t.text === "-" || t.text === "+" || t.text === "&")) return t.text
  return undefined
}

/** Accept a name token (identifier, or a keyword used as a member/function name). */
function eatName(cur: Cursor): Token | undefined {
  const t = cur.peek()
  if (t.kind === "identifier") return cur.consume()
  if (t.kind === "keyword" && t.keyword !== undefined) return cur.consume()
  return undefined
}

/** Parse a full expression. Returns undefined (and records an error) on failure. */
export function parseExpression(cur: Cursor): Expr | undefined {
  return parseBinary(cur, 1)
}

/**
 * An expression that may be an inline assignment `x := value` (CODESYS). Used where an assignment can
 * legitimately appear in expression position — inside parentheses `(x := y)` and as an IF/WHILE/REPEAT
 * condition `IF x := f() THEN`. NOT used by the general expression parser, so `:=` never hijacks a
 * statement-level assignment. `:=` binds lowest and right, so the whole RHS is captured.
 */
export function parseAssignable(cur: Cursor): Expr | undefined {
  const target = parseExpression(cur)
  if (target === undefined) return undefined
  if (cur.peek().kind === "punct" && cur.peek().text === ":=") {
    cur.consume()
    const value = parseExpression(cur)
    if (value === undefined) return undefined
    return { kind: "assign_expr", target, value, span: merge(target.span, value.span) }
  }
  return target
}

function parseBinary(cur: Cursor, minPrec: number): Expr | undefined {
  let left = parseUnary(cur)
  if (left === undefined) return undefined
  for (;;) {
    const info = binaryOp(cur.peek())
    if (info === undefined || info.prec < minPrec) break
    cur.consume()
    const right = parseBinary(cur, info.rightAssoc ? info.prec : info.prec + 1)
    if (right === undefined) return undefined
    left = { kind: "binary", op: info.op, left, right, span: merge(left.span, right.span) }
  }
  return left
}

function parseUnary(cur: Cursor): Expr | undefined {
  const t = cur.peek()
  const op = unaryOp(t)
  if (op !== undefined) {
    cur.consume()
    const operand = parseUnary(cur)
    if (operand === undefined) return undefined
    return { kind: "unary", op, operand, span: merge(t.span, operand.span) }
  }
  return parsePostfix(cur)
}

function parsePostfix(cur: Cursor): Expr | undefined {
  let base = parsePrimary(cur)
  if (base === undefined) return undefined
  for (;;) {
    const t = cur.peek()
    if (t.kind !== "punct") break
    if (t.text === ".") {
      cur.consume()
      // CODESYS bit access `x.0` .. `x.63` — the member is a numeric bit index, not a name.
      const bitTok = cur.peek()
      if (bitTok.kind === "int_lit") {
        cur.consume()
        const member: IdentExpr = { kind: "ident_expr", name: bitTok.text, span: bitTok.span }
        base = { kind: "member", base, member, span: merge(base.span, bitTok.span) }
        continue
      }
      // CODESYS partial variable access `x.%X0` / `.%B3` / `.%W1` / `.%D0` — a sub-bit/byte/word/dword slice
      // of an integer. The lexer yields `. % <spec>`; recombine into one member named `%<spec>` (like the
      // numeric bit-access above, its "member" is a slice selector, not a struct component).
      const pct = cur.peek()
      if (pct.kind === "punct" && pct.text === "%") {
        cur.consume() // %
        const specTok = cur.eatIdent()
        if (specTok === undefined) {
          cur.pushError("expected partial-access specifier after '.%'", cur.peek().span)
          return undefined
        }
        const member: IdentExpr = { kind: "ident_expr", name: `%${specTok.text}`, span: merge(pct.span, specTok.span) }
        base = { kind: "member", base, member, span: merge(base.span, specTok.span) }
        continue
      }
      const nameTok = eatName(cur)
      if (nameTok === undefined) {
        cur.pushError("expected member name after '.'", cur.peek().span)
        return undefined
      }
      const member: IdentExpr = { kind: "ident_expr", name: nameTok.text, span: nameTok.span }
      base = { kind: "member", base, member, span: merge(base.span, nameTok.span) }
    } else if (t.text === "[") {
      cur.consume()
      const indices: Expr[] = []
      if (!(cur.peek().kind === "punct" && cur.peek().text === "]")) {
        for (;;) {
          const idx = parseExpression(cur)
          if (idx === undefined) return undefined
          indices.push(idx)
          // Tolerate a trailing comma (common when a subscript is edited/commented).
          if (cur.eatPunct(",") !== undefined && !(cur.peek().kind === "punct" && cur.peek().text === "]")) continue
          break
        }
      }
      const close = cur.expectPunct("]", "closing array index")
      if (close === undefined) return undefined
      base = { kind: "index", base, indices, span: merge(base.span, close.span) }
    } else if (t.text === "^") {
      const caret = cur.consume()
      base = { kind: "deref", base, span: merge(base.span, caret.span) }
    } else if (t.text === "(") {
      const call = parseCall(cur, base)
      if (call === undefined) return undefined
      base = call
    } else break
  }
  return base
}

function parseCall(cur: Cursor, callee: Expr): CallExpr | undefined {
  cur.consume() // '('
  const args: CallArg[] = []
  if (!(cur.peek().kind === "punct" && cur.peek().text === ")")) {
    for (;;) {
      const arg = parseCallArg(cur)
      if (arg === undefined) return undefined
      args.push(arg)
      // Tolerate a trailing comma before `)` — common in CODESYS when a call's
      // last argument(s) are commented out but the separating comma remains.
      if (cur.eatPunct(",") !== undefined && !(cur.peek().kind === "punct" && cur.peek().text === ")")) continue
      break
    }
  }
  const close = cur.expectPunct(")", "closing call arguments")
  if (close === undefined) return undefined
  return { kind: "call", callee, args, span: merge(callee.span, close.span) }
}

function parseCallArg(cur: Cursor): CallArg | undefined {
  // Named input `p := v` or output `p => tgt` — an identifier followed by := / =>.
  const t = cur.peek()
  if (t.kind === "identifier") {
    const next = cur.peek(1)
    if (next.kind === "punct" && (next.text === ":=" || next.text === "=>")) {
      const nameTok = cur.consume()
      const opTok = cur.consume()
      const output = opTok.text === "=>"
      const param: IdentExpr = { kind: "ident_expr", name: nameTok.text, span: nameTok.span }
      // Either side may be left unconnected: `out => ,` / `in := ,` / `… )`. CODESYS accepts an
      // empty input (routed from nowhere) as well as an empty output.
      const after = cur.peek()
      if (after.kind === "punct" && (after.text === "," || after.text === ")")) {
        return { kind: "call_arg", param, output, span: merge(nameTok.span, opTok.span) }
      }
      const value = parseExpression(cur)
      if (value === undefined) return undefined
      return { kind: "call_arg", param, output, value, span: merge(nameTok.span, value.span) }
    }
  }
  const value = parseExpression(cur)
  if (value === undefined) return undefined
  return { kind: "call_arg", output: false, value, span: value.span }
}

function parsePrimary(cur: Cursor): Expr | undefined {
  const t = cur.peek()
  const lk = LIT_KIND[t.kind]
  if (lk !== undefined) {
    cur.consume()
    return makeLiteral(lk, t)
  }
  if (t.kind === "keyword" && (t.keyword === "TRUE" || t.keyword === "FALSE")) {
    cur.consume()
    return makeLiteral("bool", t)
  }
  if (t.kind === "identifier") {
    cur.consume()
    return { kind: "ident_expr", name: t.text, span: t.span }
  }
  // A keyword that isn't an operator can start an expression as a name —
  // standard functions/operators lexed as keywords (`ADR`, `SIZEOF`, `SEL`, …).
  if (t.kind === "keyword" && t.keyword !== undefined && !OPERATOR_KEYWORDS.has(t.keyword)) {
    cur.consume()
    return { kind: "ident_expr", name: t.text, span: t.span }
  }
  if (t.kind === "punct" && t.text === "(") {
    const open = cur.consume()
    // Allow an inline assignment `(x := value)` inside the parens (CODESYS).
    const inner = parseAssignable(cur)
    if (inner === undefined) return undefined
    const close = cur.expectPunct(")", "closing parenthesis")
    if (close === undefined) return undefined
    return { kind: "paren", inner, span: merge(open.span, close.span) }
  }
  cur.pushError(`expected expression, got ${t.kind} '${t.text}'`, t.span)
  return undefined
}

/** Build a `Literal` node with its value parsed up front (kills re-lexing downstream). */
function makeLiteral(literalKind: LiteralKind, tok: Token): Literal {
  const { value, prefix } = parseLiteralValue(literalKind, tok.text)
  return {
    kind: "literal",
    literalKind,
    text: tok.text,
    value,
    ...(prefix !== undefined ? { prefix } : {}),
    span: tok.span,
  }
}

/**
 * Collect an initializer's RHS tokens, depth-aware over `()`/`[]`, up to a top-level
 * `;` (and `END_TYPE`, for TYPE-body inits). Used by every declaration-initializer site.
 */
export function collectInitTokens(cur: Cursor, stopAtEndType = false): Token[] {
  const out: Token[] = []
  let depth = 0
  while (!cur.atEof()) {
    const t = cur.peek()
    if (depth === 0) {
      if (t.kind === "punct" && t.text === ";") break
      if (stopAtEndType && t.kind === "keyword" && t.keyword === "END_TYPE") break
    }
    if (t.kind === "punct" && (t.text === "(" || t.text === "[")) depth += 1
    else if (t.kind === "punct" && (t.text === ")" || t.text === "]")) depth -= 1
    out.push(cur.consume())
  }
  return out
}

/**
 * Parse a token slice as a single expression in a CONTAINED sub-cursor, so a speculative
 * failure never pollutes the caller's error list. Returns the `Expr` only if it consumes
 * every token cleanly; otherwise `undefined` (the caller decides the fallback). Used for
 * structured-but-tolerant bounds (subrange/array-dim) and scalar initializers.
 */
export function parseExprFromTokens(tokens: readonly Token[]): Expr | undefined {
  if (tokens.length === 0) return undefined
  const first = tokens[0]
  const last = tokens[tokens.length - 1]
  const span = merge(first.span, last.span)
  const eof: Token = {
    kind: "eof",
    text: "",
    span: {
      start: span.end,
      end: span.end,
      startLine: span.endLine,
      startCol: span.endCol,
      endLine: span.endLine,
      endCol: span.endCol,
    },
  }
  const cur = new Cursor([...tokens, eof])
  const expr = parseExpression(cur)
  return expr !== undefined && cur.atEof() && cur.getErrors().length === 0 ? expr : undefined
}

/**
 * Turn collected initializer tokens into an `Initializer`: a clean scalar expression
 * (parses to a single `Expr` consuming every token, no errors) stays an `Expr`;
 * anything else — a struct/FB/array aggregate — becomes an opaque `AggregateInit`.
 */
export function initializerFromTokens(tokens: Token[]): Initializer | undefined {
  if (tokens.length === 0) return undefined
  const expr = parseExprFromTokens(tokens)
  if (expr !== undefined) return expr
  const first = tokens[0]
  const last = tokens[tokens.length - 1]
  const { form, elements } = parseAggregate(tokens)
  const agg: AggregateInit = { kind: "aggregate_init", form, elements, tokens, span: merge(first.span, last.span) }
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
  if (g.length === 0) return { kind: "unparsed", span: { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 } }
  const span = merge(g[0].span, g[g.length - 1].span)
  if (g.length >= 2 && g[1].text === ":=") return { kind: "field", name: g[0].text, value: parseValue(g.slice(2)), span }
  return parseValue(g)
}

function parseValue(g: Token[]): AggregateElement {
  if (g.length === 0) return { kind: "unparsed", span: { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 } }
  const span = merge(g[0].span, g[g.length - 1].span)
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

export { merge as mergeSpans }
