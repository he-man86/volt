/**
 * THE NAMED TYPE — a type written as a (qualified) name: `INT`, `Lib.FB`, with a VAR_GENERIC value list `FB<6>`, a
 * subrange `INT(0..100)` or an FB_Init argument list `FB(x := 1)` after it. Split from `type-expr.ts` (openspec
 * lsp-same-standard design.md §2.2).
 */
import type { CallArg, Expr, Identifier, Subrange, TypeExpr } from "../ast/nodes/index.js"
import type { Token } from "../lex/tokens.js"
import { SUBRANGE_BASE_TYPES } from "../lex/prefixes.js"
import { joinSpans, type Span } from "../span.js"
import type { Cursor } from "./cursor.js"
import { OPERATOR_WORDS } from "./enum-values.js"
import { typeExpected, vendorExpressionExpected, vendorTokenText } from "./errors.js"
import { parseExprFromTokens, parseGenericValue } from "./expression.js"
import { identFromToken, readQualifiedName } from "./names.js"
import { collectParenInner, topLevelDotDot } from "./scan.js"

/** NamedType — identifier with optional qualifiers + optional subrange. */
export function parseNamedType(c: Cursor): TypeExpr | undefined {
  const idTok = c.eatIdent()
  if (idTok === undefined) {
    const next = c.peek()
    c.pushError(typeExpected(next), next.span)
    return undefined
  }
  // TwinCAT has no `__VECTOR` (`lex_vector_twincat`, `type_codesys_vector`, 2026-09-30): "Type definition expected
  // instead of '__VECTOR'", and nothing more — the declaration is dropped quietly to its `;`, so its uses are "not
  // defined". The word reaches here as an identifier only in that dialect (`CODESYS_ONLY_KEYWORDS`).
  if (idTok.text.toUpperCase() === "__VECTOR") {
    c.pushError(`Type definition expected instead of ${vendorTokenText(idTok)}`, idTok.span)
    return undefined
  }

  const [first, ...rest] = readQualifiedName(c, idTok, "report")
  const head = identFromToken(first!)
  const qualifiers: Identifier[] = rest.map(identFromToken)
  let lastSpan = qualifiers.length > 0 ? qualifiers[qualifiers.length - 1].span : head.span
  const generic = parseGenericArgs(c)
  if (generic.last !== undefined) lastSpan = generic.last
  const { genericArgs, genericRefused } = generic
  const parens = parseTypeParens(c, idTok, qualifiers.length === 0 && SUBRANGE_BASE_TYPES.has(head.text.toUpperCase()))
  if (parens.last !== undefined) lastSpan = parens.last
  const { subrange, initArgs } = parens

  if (qualifiers.length > 0) {
    return {
      kind: "named_type",
      name: qualifiers[qualifiers.length - 1],
      qualifiers: [head, ...qualifiers.slice(0, -1)],
      ...(subrange !== undefined ? { subrange } : {}),
      ...(initArgs !== undefined ? { initArgs } : {}),
      ...(genericArgs !== undefined ? { genericArgs } : {}),
      ...(genericRefused ? { genericRefused } : {}),
      span: joinSpans(head.span, lastSpan),
    }
  }
  return {
    kind: "named_type",
    name: head,
    ...(subrange !== undefined ? { subrange } : {}),
    ...(initArgs !== undefined ? { initArgs } : {}),
    ...(genericArgs !== undefined ? { genericArgs } : {}),
    ...(genericRefused ? { genericRefused } : {}),
    span: joinSpans(head.span, lastSpan),
  }
}

/**
 * `FB<6>` — a VAR_GENERIC CONSTANT function block instanced with its values (`decl_var_generic*`, CODESYS 2026-10-01),
 * each a constant expression, comma-separated, up to the `>`. Read on the main cursor, so a value that is no
 * expression is refused where it breaks; the list is then skipped to its `>`, never past its declaration's end, and
 * marked refused — no value is dropped quietly, and no count is taken of a list that was not read.
 * TwinCAT has none: its `<` is where the declaration wanted its end, refused there (`endAfterType`) and the declaration
 * standing as the plain type (`decl_var_generic`, `_two_values`, `_read`, `_no_constant`, TwinCAT 2026-10-01).
 * `last` — where the list read ends, when there is one.
 */
function parseGenericArgs(c: Cursor): { genericArgs?: Expr[]; genericRefused: boolean; last?: Span } {
  if (!(c.peek().kind === "punct" && c.peek().text === "<" && c.dialect === "codesys")) return { genericRefused: false }
  let last = c.consume().span // <
  const genericArgs: Expr[] = []
  let genericRefused = false
  for (;;) {
    const value = parseGenericValue(c)
    if (value === undefined) {
      genericRefused = true
      break
    }
    genericArgs.push(value)
    last = value.span
    if (c.eatPunct(",") !== undefined) continue
    const close = c.expectPunct(">")
    if (close === undefined) genericRefused = true
    else last = close.span
    break
  }
  if (!genericRefused) return { genericArgs, genericRefused, last }
  const close = skipGenericList(c)
  if (close !== undefined) last = close.span
  return { genericRefused, last }
}

/**
 * A `(...)` after a named type is either a SUBRANGE (`INT(0..100)`, structured) or an
 * FB-instance init constraint (`FB(x := 1)`, `FB()`) — the latter consumed opaquely, not modeled.
 * Scan the balanced group first, then parse the bounds in a contained sub-cursor, so an
 * FB-init or a malformed bound never pushes a spurious error onto the main parse.
 * WHICH a `(…)` is depends on the TYPE (`decl_subrange_*`, both vendors 2026-10-01): after an integer or a bit string
 * (`integer`) it is a subrange, so `INT(5)` is "'..' expected instead of ')'"; after anything else — REAL, BOOL, an
 * alias of INT, a function block — it is an argument list, so `REAL(0..1)` is "',' or ')' expected instead of '..'" and
 * keeps neither a subrange nor arguments. `REAL(5)` builds (and its 5 is no value: `v` runs as 0).
 * `last` — the group's closer, when there is one.
 */
function parseTypeParens(c: Cursor, idTok: Token, integer: boolean): { subrange?: Subrange; initArgs?: CallArg[]; last?: Span } {
  if (!(c.peek().kind === "punct" && c.peek().text === "(")) return {}
  const open = c.consume() // (
  const { inner, closeSpan } = collectParenInner(c)
  const cut = topLevelDotDot(inner)
  // a MALFORMED literal in a bound (`Token.malformed`) is refused as an operand AND ends the subrange where it stands:
  // "')' expected instead of 'BOOL#2'" and "Expression expected instead of 'BOOL#2'" (`lit_malformed_subrange_bound`,
  // both vendors) — said on the main cursor, since the bounds' contained sub-parse would drop it. No subrange is kept.
  const malformed = cut >= 0 ? inner.find((t) => t.malformed) : undefined
  if (malformed !== undefined) {
    c.pushError(`')' expected instead of ${vendorTokenText(malformed)}`, malformed.span)
    c.pushError(vendorExpressionExpected(malformed), malformed.span)
  } else if (cut >= 0 && !integer) {
    c.pushError(`',' or ')' expected instead of ${vendorTokenText(inner[cut]!)}`, inner[cut]!.span)
  } else if (integer && cut < 0) {
    const wanted = afterLongestExpression(inner) ?? { ...open, text: ")", span: closeSpan }
    c.pushError(`'..' expected instead of ${vendorTokenText(wanted)}`, wanted.span)
  } else if (cut >= 0) {
    const lo = parseExprFromTokens(inner.slice(0, cut))
    const hi = parseExprFromTokens(inner.slice(cut + 1))
    if (lo !== undefined && hi !== undefined) {
      return { subrange: { kind: "subrange", lo, hi, span: joinSpans(open.span, closeSpan) }, last: closeSpan }
    }
  } else {
    // An FB_Init call on the declaration (`inst : FB(x := 1)`, conformance `fb_init_runs_with_declared_arguments`): its
    // arguments, parsed as the call they are written as. They were consumed and dropped, so no consumer could see them.
    const close = { ...open, text: ")", span: closeSpan }
    const call = parseExprFromTokens([idTok, open, ...inner, close])
    if (call?.kind === "call") return { initArgs: call.args, last: closeSpan }
  }
  return { last: closeSpan }
}

/**
 * Past a refused generic value list to its closing `>` (consumed, returned) — but never past the end of its declaration:
 * a `;`, a `:=`, or a keyword that is no operator stops it unconsumed, so an unclosed `FB<` costs its own declaration only.
 */
function skipGenericList(c: Cursor): Token | undefined {
  let depth = 0
  while (!c.atEof()) {
    const t = c.peek()
    if (depth === 0 && t.kind === "punct" && (t.text === ";" || t.text === ":=")) return undefined
    if (t.kind === "keyword" && t.keyword !== undefined && !OPERATOR_WORDS.has(t.keyword)) return undefined
    if (depth === 0 && t.kind === "punct" && t.text === ">") return c.consume()
    if (t.kind === "punct" && (t.text === "(" || t.text === "[")) depth++
    else if (t.kind === "punct" && (t.text === ")" || t.text === "]")) depth = Math.max(0, depth - 1)
    c.consume()
  }
  return undefined
}

/** The token after the longest run of `tokens` that is one expression — undefined when all of them are one. */
function afterLongestExpression(tokens: readonly Token[]): Token | undefined {
  if (parseExprFromTokens(tokens) !== undefined) return undefined
  for (let k = tokens.length - 1; k >= 1; k--) if (parseExprFromTokens(tokens.slice(0, k)) !== undefined) return tokens[k]
  return tokens[0]
}
