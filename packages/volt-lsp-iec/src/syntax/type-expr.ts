/**
 * Type expression parser — produces the STRUCTURED type nodes (A.1/A.2 refinement):
 * subrange as `{ lo, hi }` expressions, array dims as const-expr bounds (+ a `dynamic`
 * flag for `ARRAY[*]`), string length as an expression, implicit-enum values with
 * parsed value expressions. No opaque `BodySpan`s for bounds anymore.
 *
 * Grammar:
 *   TypeExpr      := ImplicitEnum | StringType | ReferenceType | PointerType | ArrayType | NamedType
 *   NamedType     := Identifier ('.' Identifier)* ( '(' Subrange ')' )?
 *   Subrange      := Expr '..' Expr                    // else `(…)` is an FB-init constraint (consumed, opaque)
 *   ArrayType     := ARRAY '[' ArrayDim (',' ArrayDim)* ']' OF TypeExpr
 *   ArrayDim      := '*' | Expr '..' Expr
 *   StringType    := (STRING|WSTRING) ( ('(' | '[') Expr (')' | ']') )?
 *
 * Primitive names (BOOL/INT/REAL) lex as identifiers; the semantic layer classifies them.
 */
import type { Token } from "./tokens.js"
import type { ArrayDim, EnumValue, Expr, Identifier, Subrange, TypeExpr } from "./ast.js"
import type { Span } from "./span.js"
import { Cursor } from "./cursor.js"
// Inherent recursive-descent recursion: type-expr ↔ util ↔ var-section parse into each other. Function-body imports, no init hazard.
import { identFromToken, joinSpans } from "./util.js"
import { parseExpression, parseExprFromTokens } from "./expression.js"

export function parseTypeExpression(c: Cursor): TypeExpr | undefined {
  // Implicit enumeration — `(A, B, C := 10, D)` declared inline.
  const openParen = c.eatPunct("(")
  if (openParen !== undefined) {
    const values: EnumValue[] = []
    while (true) {
      if (c.peek().kind === "eof" || c.eatPunct(")") !== undefined) break
      const nameTok = c.eatIdent()
      if (nameTok === undefined) {
        c.pushError("expected enum value name in implicit enumeration", c.peek().span)
        break
      }
      const name = identFromToken(nameTok)
      let value: Expr | undefined
      if (c.eatPunct(":=") !== undefined) value = parseExpression(c)
      values.push({
        kind: "enum_value",
        name,
        ...(value !== undefined ? { value } : {}),
        span: value !== undefined ? joinSpans(name.span, value.span) : name.span,
      })
      if (c.eatPunct(",") !== undefined) continue
      c.expectPunct(")", "closing implicit enumeration")
      break
    }
    // Optional explicit base type after the value list: `( … ) DINT` — a sized enum.
    const baseTypeTok = c.peek().kind === "identifier" ? c.consume() : undefined
    const lastSpan = baseTypeTok?.span ?? (values.length > 0 ? values[values.length - 1].span : openParen.span)
    return { kind: "implicit_enum_type", values, span: joinSpans(openParen.span, lastSpan) }
  }

  // STRING / WSTRING with optional length
  const stringTok = c.eatAnyKeyword("STRING", "WSTRING")
  if (stringTok !== undefined) {
    const wide = stringTok.keyword === "WSTRING"
    const len = parseOptionalStringLength(c)
    return {
      kind: "string_type",
      wide,
      ...(len?.length !== undefined ? { length: len.length } : {}),
      span: joinSpans(stringTok.span, len?.end ?? stringTok.span),
    }
  }

  // REFERENCE TO X
  const refTok = c.eatKeyword("REFERENCE")
  if (refTok !== undefined) {
    c.expectKeyword("TO", "after REFERENCE")
    const target = parseTypeExpression(c)
    if (target === undefined) return undefined
    return { kind: "reference_type", target, span: joinSpans(refTok.span, target.span) }
  }

  // POINTER TO X
  const ptrTok = c.eatKeyword("POINTER")
  if (ptrTok !== undefined) {
    c.expectKeyword("TO", "after POINTER")
    const target = parseTypeExpression(c)
    if (target === undefined) return undefined
    return { kind: "pointer_type", target, span: joinSpans(ptrTok.span, target.span) }
  }

  // ARRAY [a..b, c..d] OF X
  const arrTok = c.eatKeyword("ARRAY")
  if (arrTok !== undefined) {
    c.expectPunct("[", "after ARRAY")
    const dims: ArrayDim[] = []
    while (true) {
      if (c.peek().kind === "eof" || c.eatPunct("]") !== undefined) break
      const dim = parseArrayDim(c)
      if (dim !== undefined) dims.push(dim)
      if (c.eatPunct(",") !== undefined) continue
      c.expectPunct("]", "closing ARRAY dimensions")
      break
    }
    c.expectKeyword("OF", "after ARRAY dimensions")
    const element = parseTypeExpression(c)
    if (element === undefined) return undefined
    return { kind: "array_type", dims, element, span: joinSpans(arrTok.span, element.span) }
  }

  // NamedType — identifier with optional qualifiers + optional subrange
  const idTok = c.eatIdent()
  if (idTok === undefined) {
    const next = c.peek()
    c.pushError(`expected type, got ${tokenDescription(next)}`, next.span)
    return undefined
  }
  // CODESYS `__VECTOR[<size>] OF <type>` — SIMD fixed-size container. Same shape as
  // ARRAY[0..size-1] OF <type>; modeled as a single-dim array (TC rejects it — conformance encodes that).
  if (idTok.text.toUpperCase() === "__VECTOR") {
    c.expectPunct("[", "after __VECTOR")
    const size = parseExpression(c)
    c.expectPunct("]", "closing __VECTOR size")
    c.expectKeyword("OF", "after __VECTOR size")
    const element = parseTypeExpression(c)
    if (element === undefined) return undefined
    const dim: ArrayDim = {
      kind: "array_dim",
      dynamic: false,
      ...(size !== undefined ? { upper: size } : {}),
      span: size?.span ?? idTok.span,
    }
    return { kind: "array_type", dims: [dim], element, span: joinSpans(idTok.span, element.span) }
  }

  const head = identFromToken(idTok)
  const qualifiers: Identifier[] = []
  while (c.eatPunct(".") !== undefined) {
    const part = c.eatIdent()
    if (part === undefined) {
      c.pushError("expected identifier after '.'", c.peek().span)
      break
    }
    qualifiers.push(identFromToken(part))
  }
  let lastSpan = qualifiers.length > 0 ? qualifiers[qualifiers.length - 1].span : head.span

  // A `(...)` after a named type is either a SUBRANGE (`INT(0..100)`, structured) or an
  // FB-instance init constraint (`FB(x := 1)`, `FB()`) — the latter consumed opaquely, not modeled.
  // Scan the balanced group first, then parse the bounds in a contained sub-cursor, so an
  // FB-init or a malformed bound never pushes a spurious error onto the main parse.
  let subrange: Subrange | undefined
  if (c.peek().kind === "punct" && c.peek().text === "(") {
    const open = c.consume() // (
    const { inner, closeSpan } = collectBalancedParenInner(c)
    lastSpan = closeSpan
    const cut = topLevelDotDot(inner)
    if (cut >= 0) {
      const lo = parseExprFromTokens(inner.slice(0, cut))
      const hi = parseExprFromTokens(inner.slice(cut + 1))
      if (lo !== undefined && hi !== undefined) {
        subrange = { kind: "subrange", lo, hi, span: joinSpans(open.span, closeSpan) }
      }
    }
  }

  if (qualifiers.length > 0) {
    return {
      kind: "named_type",
      name: qualifiers[qualifiers.length - 1],
      qualifiers: [head, ...qualifiers.slice(0, -1)],
      ...(subrange !== undefined ? { subrange } : {}),
      span: joinSpans(head.span, lastSpan),
    }
  }
  return {
    kind: "named_type",
    name: head,
    ...(subrange !== undefined ? { subrange } : {}),
    span: joinSpans(head.span, lastSpan),
  }
}

/**
 * Parse a METHOD/FUNCTION header's optional `: ReturnType`, then eat an optional trailing `;`.
 * The `;` MUST be consumed or `collectVarSections` stops at it and drops every local.
 */
export function parseOptionalReturnType(c: Cursor): TypeExpr | undefined {
  let returnType: TypeExpr | undefined
  if (c.eatPunct(":") !== undefined) returnType = parseTypeExpression(c)
  c.eatPunct(";")
  return returnType
}

function parseArrayDim(c: Cursor): ArrayDim | undefined {
  const start = c.peek().span
  // Variable-length dimension `ARRAY[*]` — no bounds.
  if (c.peek().kind === "punct" && c.peek().text === "*") {
    const star = c.consume()
    return { kind: "array_dim", dynamic: true, span: star.span }
  }
  // Collect the dim's tokens (depth-aware) up to the top-level `,`/`]`, then split on `..`
  // and parse each bound in a contained sub-cursor. Bounds that don't form a clean expression
  // (e.g. a `Up...Left` source typo) are left undefined rather than aborting the parse.
  const toks = collectDimTokens(c)
  if (toks.length === 0) return undefined
  const end = toks[toks.length - 1].span
  const cut = topLevelDotDot(toks)
  if (cut < 0) {
    // No `..` — malformed; keep it as a best-effort single lower bound, don't error out.
    const lower = parseExprFromTokens(toks)
    return { kind: "array_dim", dynamic: false, ...(lower !== undefined ? { lower } : {}), span: joinSpans(start, end) }
  }
  const lower = parseExprFromTokens(toks.slice(0, cut))
  const upper = parseExprFromTokens(toks.slice(cut + 1))
  return {
    kind: "array_dim",
    dynamic: false,
    ...(lower !== undefined ? { lower } : {}),
    ...(upper !== undefined ? { upper } : {}),
    span: joinSpans(start, end),
  }
}

/** Collect an array dimension's tokens up to the top-level `,` or `]` (depth-aware, not consumed). */
function collectDimTokens(c: Cursor): Token[] {
  const out: Token[] = []
  let depth = 0
  while (!c.atEof()) {
    const t = c.peek()
    if (depth === 0 && t.kind === "punct" && (t.text === "," || t.text === "]")) break
    if (t.kind === "punct" && (t.text === "(" || t.text === "[")) depth += 1
    else if (t.kind === "punct" && (t.text === ")" || t.text === "]")) depth -= 1
    out.push(c.consume())
  }
  return out
}

/** Consume through the matching `)` (the `(` already consumed); returns inner tokens + closing span. */
function collectBalancedParenInner(c: Cursor): { inner: Token[]; closeSpan: Span } {
  const inner: Token[] = []
  let depth = 1
  let closeSpan = c.peek().span
  while (!c.atEof() && depth > 0) {
    const t = c.consume()
    closeSpan = t.span
    if (t.kind === "punct" && t.text === "(") depth += 1
    else if (t.kind === "punct" && t.text === ")") {
      depth -= 1
      if (depth === 0) break
    }
    inner.push(t)
  }
  return { inner, closeSpan }
}

/** Index of the first top-level `..` in a token slice (depth-aware over `()`/`[]`), or -1. */
function topLevelDotDot(tokens: readonly Token[]): number {
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.kind === "punct" && (t.text === "(" || t.text === "[")) depth += 1
    else if (t.kind === "punct" && (t.text === ")" || t.text === "]")) depth -= 1
    else if (depth === 0 && t.kind === "punct" && t.text === "..") return i
  }
  return -1
}

/** The optional `(n)`/`[n]` length clause, with the span of its closer so the STRING type covers the paren. */
function parseOptionalStringLength(c: Cursor): { length?: Expr; end: Span } | undefined {
  const open = c.eatPunct("(") ?? c.eatPunct("[")
  if (open === undefined) return undefined
  const closer = open.text === "(" ? ")" : "]"
  const length = parseExpression(c)
  const close = c.expectPunct(closer, "closing string length")
  return { ...(length !== undefined ? { length } : {}), end: (close ?? length ?? open).span }
}

function tokenDescription(t: Token): string {
  if (t.kind === "eof") return "end of input"
  if (t.kind === "keyword") return `keyword '${t.keyword ?? t.text}'`
  return `'${t.text}'`
}
