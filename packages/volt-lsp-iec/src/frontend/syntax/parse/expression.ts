/**
 * ST EXPRESSIONS — a precedence-climbing (Pratt) parser over a `Cursor`, producing the `Expr` tree of `ast/nodes/`.
 *
 * Every function returns `undefined` on failure and records an error on the cursor (never throws); the error reaches
 * the user through the statement or declaration parse that called it (`BodyParse.errors`, `ParseResult.errors`).
 * `parseExprFromTokens` parses a token slice in a CONTAINED sub-cursor, for callers that decide a fallback themselves.
 * Initializers (`:=` right-hand sides, aggregates) are `initializer.ts`'s.
 *
 * Precedence, lowest first: OR/OR_ELSE/XOR < AND/AND_THEN < equality < comparison < additive < multiplicative, every
 * level left-associative, unary (`-` `+` NOT) above them and postfix (`.` `[]` `^` `()`) binding tightest
 * (`BINARY_PRECEDENCE`, `precedence.ts`). Measured level by level on both vendors (rules E1, E3, E4, E6, E7, E9; `expr_*`,
 * `fixtures/grammar/expressions.ts`, 2026-10-01). `**` and `&` are NO operators (E2, E5): the expression ends before
 * them and whatever was reading it says what it expected instead (`REFUSED_OPERATORS`).
 *
 * The postfix suffixes are `postfix.ts`'s, the operand `primary.ts`'s; both recurse into this grammar through `GRAMMAR`.
 */
import { eofSpan, joinSpans } from "../span.js"
import type { Token } from "../lex/tokens.js"
import { Cursor } from "./cursor.js"
import type { Expr } from "../ast/nodes/index.js"
import { parsePostfix } from "./postfix.js"
import { binaryOp, unaryOp } from "./precedence.js"
import type { ExpressionGrammar } from "./primary.js"

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
    const right = parseBinary(cur, info.prec + 1, closer)
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
  return parsePostfix(cur, GRAMMAR)
}

/** This grammar, as the operand and postfix parsers recurse into it. */
const GRAMMAR: ExpressionGrammar = { expression: parseExpression, assignable: parseAssignable, unary: parseUnary }

/**
 * Parse a token slice as a single expression in a CONTAINED sub-cursor, so a speculative
 * failure never pollutes the caller's error list. Returns the `Expr` only if it consumes
 * every token cleanly; otherwise `undefined` (the caller decides the fallback). Used for
 * structured-but-tolerant bounds (subrange/array-dim) and scalar initializers.
 * `assignable` reads it as a condition is read (`parseAssignable`): an inline assignment stands bare.
 */
export function parseExprFromTokens(tokens: readonly Token[], assignable = false): Expr | undefined {
  if (tokens.length === 0) return undefined
  const first = tokens[0]
  const last = tokens[tokens.length - 1]
  const span = joinSpans(first.span, last.span)
  const eof: Token = { kind: "eof", text: "", span: eofSpan(span) }
  const cur = new Cursor([...tokens, eof])
  const expr = assignable ? parseAssignable(cur) : parseExpression(cur)
  return expr !== undefined && cur.atEof() && cur.getErrors().length === 0 ? expr : undefined
}
