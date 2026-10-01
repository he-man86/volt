/**
 * ST EXPRESSIONS — a precedence-climbing (Pratt) parser over a `Cursor`, producing the `Expr` tree of `ast/nodes.ts`.
 *
 * Every function returns `undefined` on failure and records an error on the cursor (never throws); the error reaches
 * the user through the statement or declaration parse that called it (`BodyParse.errors`, `ParseResult.errors`).
 * `parseExprFromTokens` parses a token slice in a CONTAINED sub-cursor, for callers that decide a fallback themselves.
 * Initializers (`:=` right-hand sides, aggregates) are `initializer.ts`'s.
 *
 * Precedence, lowest first: OR < XOR < AND < equality < comparison < additive < multiplicative < exponent, with
 * exponent right-associative and postfix (`.` `[]` `^` `()`) binding tightest (`BINARY_PRECEDENCE`).
 */
import { eofSpan, joinSpans, type Span, zeroSpan } from "../span.js"
import type { Token } from "../lex/tokens.js"
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
} from "../ast/nodes.js"
import { parseLiteralValue } from "../literal/value.js"
import { addressShape } from "../literal/address.js"
import { expressionExpected, vendorExpressionExpected, vendorTokenText } from "./errors.js"
import { CALL_OPERATOR_OPERANDS, NOT_AN_OPERAND } from "../lex/vocabulary.js"

// ─── Precedence table (task 1.3) — lowest binding first ──────────────
// Exported for `test/conformance/coverage.test.ts`, which requires every operator here to appear in at least one
// conformance fixture — so an operator the grammar accepts can never again go unmeasured, the way `**` did.
export const BINARY_PRECEDENCE: ReadonlyArray<{
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
 * A VAR_GENERIC value in `FB<…>` (`decl_var_generic*`): a whole expression in which `>` is no operator, since the list's
 * own `>` closes it — every other operator stands (AND/OR/XOR, `=`, `<`, `>=`), and a `>` inside parentheses is the
 * comparison it is. Only `<6>`, `<6, 7>` and the empty list are recorded, so nothing the `>` does not force is refused.
 * Reports its own errors on `cur`.
 */
export function parseGenericValue(cur: Cursor): Expr | undefined {
  return parseBinary(cur, 1, ">")
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
    return { kind: "assign_expr", target, value, span: joinSpans(target.span, value.span) }
  }
  return target
}

/** `closer` — an operator that closes an enclosing list instead (`>` in `FB<…>`, `parseGenericValue`). */
function parseBinary(cur: Cursor, minPrec: number, closer?: string): Expr | undefined {
  let left = parseUnary(cur)
  if (left === undefined) return undefined
  for (;;) {
    const info = binaryOp(cur.peek())
    if (info === undefined || info.prec < minPrec || info.op === closer) break
    cur.consume()
    const right = parseBinary(cur, info.rightAssoc ? info.prec : info.prec + 1, closer)
    if (right === undefined) return undefined
    left = { kind: "binary", op: info.op, left, right, span: joinSpans(left.span, right.span) }
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
    return { kind: "unary", op, operand, span: joinSpans(t.span, operand.span) }
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
        base = { kind: "member", base, member, span: joinSpans(base.span, bitTok.span) }
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
        const member: IdentExpr = { kind: "ident_expr", name: `%${specTok.text}`, span: joinSpans(pct.span, specTok.span) }
        base = { kind: "member", base, member, span: joinSpans(base.span, specTok.span) }
        continue
      }
      const nameTok = eatName(cur)
      if (nameTok === undefined) {
        cur.pushError("expected member name after '.'", cur.peek().span)
        return undefined
      }
      const member: IdentExpr = { kind: "ident_expr", name: nameTok.text, span: nameTok.span }
      base = { kind: "member", base, member, span: joinSpans(base.span, nameTok.span) }
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
      const close = cur.expectPunct("]")
      if (close === undefined) return undefined
      base = { kind: "index", base, indices, span: joinSpans(base.span, close.span) }
    } else if (t.text === "^") {
      const caret = cur.consume()
      base = { kind: "deref", base, span: joinSpans(base.span, caret.span) }
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
  // A CALL's argument list can still take a COMMA here, and CODESYS says so: `',' or ')' expected instead of ';'`
  // (`sysop_position_as_argument`), not the bare `')' expected` a plain `expectPunct` would give.
  const close = cur.eatPunct(")")
  if (close === undefined) {
    const next = cur.peek()
    cur.pushError(`',' or ')' expected instead of ${vendorTokenText(next)}`, next.span)
    return undefined
  }
  return { kind: "call", callee, args, span: joinSpans(callee.span, close.span) }
}

function parseCallArg(cur: Cursor): CallArg | undefined {
  // Named input `p := v` or output `p => tgt` — a name followed by := / =>.
  // `atNameStart` (not `kind === "identifier"`): the soft keywords are legal PARAMETER names for the same
  // reason they are legal variable names — the Standard `RS` FB declares `SET : BOOL`, so `rs(SET := x)` is
  // how you call it by name. The declaration side already allowed this (`var-section.ts`); the call side did
  // not, which made that input reachable only positionally.
  if (cur.atNameStart()) {
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
        return { kind: "call_arg", param, output, span: joinSpans(nameTok.span, opTok.span) }
      }
      const value = parseExpression(cur)
      if (value === undefined) return undefined
      return { kind: "call_arg", param, output, value, span: joinSpans(nameTok.span, value.span) }
    }
  }
  const value = parseExpression(cur)
  if (value === undefined) return undefined
  return { kind: "call_arg", output: false, value, span: value.span }
}

const isOpenParen = (t: Token): boolean => t.kind === "punct" && t.text === "("

/** The address shapes that are no operand: complete only after AT (`%I*`), or no address at all (`%MW`). */
const NO_OPERAND_ADDRESS: ReadonlySet<string> = new Set(["incomplete", "no-position"])

function parsePrimary(cur: Cursor): Expr | undefined {
  const t = cur.peek()
  const lk = LIT_KIND[t.kind]
  // A MALFORMED literal (`Token.malformed`) is refused as a keyword that is no operand is, and left where it stands for
  // the statement's resync: "Expression expected instead of '3#'", then the pair and a pair per token to the `;`
  // (`lit_invalid_base_3`, `lit_int_typed_plus`, `cc_time_nanosecond_literal`, both vendors).
  // An INCOMPLETE address (`%I*`) is refused the same way where it is an operand — it is completed by a VAR_CONFIG,
  // so it belongs after `AT` only (`lit_address_incomplete_in_body`, both vendors 2026-10-01). So is one with a size
  // and NO POSITION (`%MW`; `%IW*` is `%IW` then `*`), which is no address at all (`lit_address_no_position_in_body`,
  // `lit_address_sized_star_in_body`, CODESYS 2026-10-01).
  if (lk !== undefined && (t.malformed || (lk === "address" && NO_OPERAND_ADDRESS.has(addressShape(t.text).kind)))) {
    cur.pushError(vendorExpressionExpected(t), t.span)
    cur.refuseOperand()
    return undefined
  }
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
  // Every keyword rule below was measured with a token AFTER the word (`n := cal;`). A keyword that ENDS the tokens is
  // read as a name, as before: network text reads a callee on its own (`MAX` of `MAX(a, b)`), and a stray block closer
  // at the end of a body is unmeasured.
  const followed = cur.peek(1).kind !== "eof"
  // A keyword that is NO OPERAND (`NOT_AN_OPERAND`) — `n := cal;`, `t(Public := TRUE);` — is refused on the word and
  // left where it stands: the vendor resyncs from it as from a refused statement, which the statement list runs.
  // Before `(` it is not refused here — the IL call form `ADD(a, b)` is still refused by the analysis (task 2.5.5).
  if (t.kind === "keyword" && t.keyword !== undefined && NOT_AN_OPERAND.has(t.keyword) && followed && !isOpenParen(cur.peek(1))) {
    cur.pushError(expressionExpected(t), t.span)
    cur.refuseOperand()
    return undefined
  }
  // A CALL OPERATOR WITHOUT ITS `(` TAKES THE NEXT TOKEN FOR IT (`CALL_OPERATOR_OPERANDS`): `n := abs;` is "'(' expected
  // instead of ';'" and "'ABS' needs exactly '1' operands", and the `;` is gone — so the statement then says "';'
  // expected instead of end of POU" by itself, as for `__POSITION` below. Measured per operator (`lex_keyword_operand_*`,
  // `lex_keyword_assigned_sys_queryinterface` …, CODESYS 2026-09-30).
  const operands = t.kind === "keyword" && t.keyword !== undefined ? CALL_OPERATOR_OPERANDS.get(t.keyword) : undefined
  if (t.keyword !== undefined && operands !== undefined && followed && !isOpenParen(cur.peek(1))) {
    cur.consume()
    const taken = cur.peek()
    cur.pushError(`'(' expected instead of ${vendorTokenText(taken)}`, taken.span)
    const operator = t.keyword
    const { count, atLeast } = operands
    cur.pushParseError({
      message: `'${operator}' needs ${atLeast ? "at least" : "exactly"} '${count}' operands`,
      span: t.span,
      operandCount: { operator, count, atLeast },
    })
    cur.consume()
    return { kind: "ident_expr", name: t.text, span: t.span }
  }
  // `__NEW` WITHOUT ITS `(` takes the next token for it too, then wants a TYPE where the calls above want operands:
  // `n := __new;` is "'(' expected instead of ';'", "Type definition expected as operand for __NEW", "')' expected
  // instead of ''" — and the `;` gone, the statement's "';' expected instead of end of POU" (`lex_keyword_operand_sys_new`,
  // CODESYS and TwinCAT alike, 2026-09-30). Only that position was measured.
  if (t.kind === "keyword" && t.keyword === "__NEW" && followed && !isOpenParen(cur.peek(1))) {
    cur.consume()
    const taken = cur.consume()
    cur.pushError(`'(' expected instead of ${vendorTokenText(taken)}`, taken.span)
    const next = cur.peek()
    cur.pushError("Type definition expected as operand for __NEW", next.span)
    cur.pushError(`')' expected instead of ${next.kind === "eof" ? "''" : vendorTokenText(next)}`, next.span)
    return { kind: "ident_expr", name: t.text, span: t.span }
  }
  // A BINARY OPERATOR WORD where an operand belongs is read as the operator, its left operand missing: CODESYS names the
  // word, then — having taken it as the operator — the token where the right operand should be (`n := and;`: "Expression
  // expected instead of 'and'", "Expression expected instead of ';'"; `lex_keyword_operand_and` and its five siblings).
  if (t.kind === "keyword" && binaryOp(t) !== undefined && followed) {
    cur.pushError(expressionExpected(t), t.span)
    cur.consume()
    const operand = cur.peek()
    if (operand.kind === "punct") cur.pushError(vendorExpressionExpected(operand), operand.span)
    else parseUnary(cur)
    return undefined
  }
  // A keyword that isn't an operator can start an expression as a name —
  // standard functions/operators lexed as keywords (`ADR`, `SIZEOF`, `SEL`, …).
  if (t.kind === "keyword" && t.keyword !== undefined && !OPERATOR_KEYWORDS.has(t.keyword)) {
    cur.consume()
    // `__POSITION` IS A CALL, AND WITHOUT ITS PARENTHESES THE COMPILER EATS THE NEXT TOKEN. Seven positions were
    // recorded on SP21 (`sysop_position_*`) and every answer follows from that one rule:
    //
    //   here := __POSITION();     the call form — STRING(INT#23) into a DINT, and NOTHING else is wrong
    //   here := __POSITION;       eats the `;`  -> "';' expected instead of end of POU"
    //   here := __POSITION; …     eats the `;`  -> "';' expected instead of 'after'" (the next statement's name)
    //   here := __POSITION + 1;   eats the `+`  -> "';' expected instead of '1'"
    //   here := ABS(__POSITION);  eats the `)`  -> "',' or ')' expected instead of ';'"
    //
    // Modelling it as "an unknown operand" fits none of them: the compiler never names `__POSITION`, it names
    // whatever stands after it. Emulating the bite makes the ordinary statement parser say the vendor's words.
    //
    // `__POUNAME` answers the same way (`lex_keyword_operand_sys_pouname`, CODESYS 2026-09-30: `n := __pouname;` is
    // "';' expected instead of end of POU" and nothing else). On TwinCAT neither is a keyword (`CODESYS_ONLY_KEYWORDS`).
    if ((t.keyword === "__POSITION" || t.keyword === "__POUNAME") && !isOpenParen(cur.peek())) cur.consume()
    // `__CURRENTTASK` IS REFUSED IN ST, AND ALWAYS WITH THE SAME TWO WORDS. Six positions were recorded on SP21
    // (`op_sys_currenttask`, `sysop_currenttask_*`) — a method, an FB body, a bare statement, the call form, a
    // dereference-and-read, and one with a statement after it — and every one answers:
    //
    //   ';' expected instead of end of POU
    //   Expression expected instead of ''
    //
    // Both name the END of the input whatever stood in the way, so the compiler runs off the end of the POU on
    // this token and nothing after it is read. The parse CONTINUES here rather than doing that: the two messages
    // are the whole answer, and swallowing the rest of the unit would invent a cascade CODESYS does not report.
    if (t.keyword === "__CURRENTTASK") {
      cur.pushError("';' expected instead of end of POU", t.span)
      cur.pushError("Expression expected instead of ''", t.span)
    }
    return { kind: "ident_expr", name: t.text, span: t.span }
  }
  if (t.kind === "punct" && t.text === "(") {
    const open = cur.consume()
    // Allow an inline assignment `(x := value)` inside the parens (CODESYS).
    const inner = parseAssignable(cur)
    if (inner === undefined) return undefined
    const close = cur.expectPunct(")")
    if (close === undefined) return undefined
    return { kind: "paren", inner, span: joinSpans(open.span, close.span) }
  }
  cur.pushError(expressionExpected(t), t.span)
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
 * Parse a token slice as a single expression in a CONTAINED sub-cursor, so a speculative
 * failure never pollutes the caller's error list. Returns the `Expr` only if it consumes
 * every token cleanly; otherwise `undefined` (the caller decides the fallback). Used for
 * structured-but-tolerant bounds (subrange/array-dim) and scalar initializers.
 */
export function parseExprFromTokens(tokens: readonly Token[]): Expr | undefined {
  if (tokens.length === 0) return undefined
  const first = tokens[0]
  const last = tokens[tokens.length - 1]
  const span = joinSpans(first.span, last.span)
  const eof: Token = { kind: "eof", text: "", span: eofSpan(span) }
  const cur = new Cursor([...tokens, eof])
  const expr = parseExpression(cur)
  return expr !== undefined && cur.atEof() && cur.getErrors().length === 0 ? expr : undefined
}
