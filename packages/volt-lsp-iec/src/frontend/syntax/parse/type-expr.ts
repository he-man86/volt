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
import type { Token } from "../lex/tokens.js"
import type { ArrayDim, CallArg, EnumValue, Expr, Identifier, Subrange, TypeExpr } from "../ast/nodes.js"
import { eofSpan, joinSpans, type Span } from "../span.js"
import { Cursor } from "./cursor.js"
// Inherent recursive-descent recursion: type-expr ↔ util ↔ var-section parse into each other. Function-body imports, no init hazard.
import { parseExpression, parseExprFromTokens } from "./expression.js"
import { typeExpected, vendorTokenText } from "./errors.js"
import { identFromToken, readQualifiedName } from "./names.js"
import { collectParenInner, collectUntilTopLevel, topLevelDotDot } from "./scan.js"

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
      c.expectPunct(")")
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
    c.expectKeyword("TO")
    const target = parseTypeExpression(c)
    if (target === undefined) return undefined
    return { kind: "reference_type", target, span: joinSpans(refTok.span, target.span) }
  }

  // POINTER TO X
  const ptrTok = c.eatKeyword("POINTER")
  if (ptrTok !== undefined) {
    c.expectKeyword("TO")
    const target = parseTypeExpression(c)
    if (target === undefined) return undefined
    return { kind: "pointer_type", target, span: joinSpans(ptrTok.span, target.span) }
  }

  // ARRAY [a..b, c..d] OF X
  const arrTok = c.eatKeyword("ARRAY")
  if (arrTok !== undefined) {
    c.expectPunct("[")
    const dims: ArrayDim[] = []
    while (true) {
      if (c.peek().kind === "eof" || c.eatPunct("]") !== undefined) break
      const dim = parseArrayDim(c)
      if (dim !== undefined) dims.push(dim)
      if (c.eatPunct(",") !== undefined) continue
      c.expectPunct("]")
      break
    }
    c.expectKeyword("OF")
    const element = parseTypeExpression(c)
    if (element === undefined) return undefined
    return { kind: "array_type", dims, element, span: joinSpans(arrTok.span, element.span) }
  }

  // CODESYS `__VECTOR[<size>] OF <type>` — SIMD fixed-size container. Same shape as
  // ARRAY[0..size-1] OF <type>; modeled as a single-dim array. A keyword only in the CODESYS dialect: on TwinCAT the
  // word lexes as an identifier and is refused below.
  const vectorTok = c.eatKeyword("__VECTOR")
  if (vectorTok !== undefined) {
    c.expectPunct("[")
    const size = parseExpression(c)
    c.expectPunct("]")
    c.expectKeyword("OF")
    const element = parseTypeExpression(c)
    if (element === undefined) return undefined
    // `[4]` IS A COUNT, AND `ArrayDim` HOLDS INDICES. Storing the count as `upper` with no `lower` left a `__VECTOR`
    // resolving to an array with neither bounds nor open dims (`resolve.ts` needs both ends to fold) — a third state
    // nothing downstream models, so its size, its index checks and its members were all working from nothing. The
    // comment above already said what it is: `ARRAY[0..size-1]`, written out so `constEval` folds it like any other.
    const zero: Expr = { kind: "literal", literalKind: "int", text: "0", value: 0n, span: vectorTok.span }
    const one: Expr = { kind: "literal", literalKind: "int", text: "1", value: 1n, span: vectorTok.span }
    const dim: ArrayDim = {
      kind: "array_dim",
      dynamic: false,
      ...(size !== undefined
        ? { lower: zero, upper: { kind: "binary", op: "-", left: size, right: one, span: size.span } as Expr }
        : {}),
      span: size?.span ?? vectorTok.span,
    }
    return {
      kind: "array_type",
      dims: [dim],
      element,
      vector: size !== undefined ? { size } : {},
      span: joinSpans(vectorTok.span, element.span),
    }
  }

  // NamedType — identifier with optional qualifiers + optional subrange
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

  // A `(...)` after a named type is either a SUBRANGE (`INT(0..100)`, structured) or an
  // FB-instance init constraint (`FB(x := 1)`, `FB()`) — the latter consumed opaquely, not modeled.
  // Scan the balanced group first, then parse the bounds in a contained sub-cursor, so an
  // FB-init or a malformed bound never pushes a spurious error onto the main parse.
  let subrange: Subrange | undefined
  let initArgs: CallArg[] | undefined
  if (c.peek().kind === "punct" && c.peek().text === "(") {
    const open = c.consume() // (
    const { inner, closeSpan } = collectParenInner(c)
    lastSpan = closeSpan
    const cut = topLevelDotDot(inner)
    if (cut >= 0) {
      const lo = parseExprFromTokens(inner.slice(0, cut))
      const hi = parseExprFromTokens(inner.slice(cut + 1))
      if (lo !== undefined && hi !== undefined) {
        subrange = { kind: "subrange", lo, hi, span: joinSpans(open.span, closeSpan) }
      }
    } else {
      // An FB_Init call on the declaration (`inst : FB(x := 1)`, conformance `fb_init_runs_with_declared_arguments`): its
      // arguments, parsed as the call they are written as. They were consumed and dropped, so no consumer could see them.
      const close = { ...open, text: ")", span: closeSpan }
      const call = parseExprFromTokens([idTok, open, ...inner, close])
      if (call?.kind === "call") initArgs = call.args
    }
  }

  if (qualifiers.length > 0) {
    return {
      kind: "named_type",
      name: qualifiers[qualifiers.length - 1],
      qualifiers: [head, ...qualifiers.slice(0, -1)],
      ...(subrange !== undefined ? { subrange } : {}),
      ...(initArgs !== undefined ? { initArgs } : {}),
      span: joinSpans(head.span, lastSpan),
    }
  }
  return {
    kind: "named_type",
    name: head,
    ...(subrange !== undefined ? { subrange } : {}),
    ...(initArgs !== undefined ? { initArgs } : {}),
    span: joinSpans(head.span, lastSpan),
  }
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
  const toks = collectUntilTopLevel(c, (t) => t.kind === "punct" && (t.text === "," || t.text === "]"))
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

/** The optional `(n)`/`[n]` length clause, with the span of its closer so the STRING type covers the paren. */
function parseOptionalStringLength(c: Cursor): { length?: Expr; end: Span } | undefined {
  const open = c.eatPunct("(") ?? c.eatPunct("[")
  if (open === undefined) return undefined
  const closer = open.text === "(" ? ")" : "]"
  const length = parseExpression(c)
  const close = c.expectPunct(closer)
  return { ...(length !== undefined ? { length } : {}), end: (close ?? length ?? open).span }
}

/**
 * A whole token run parsed as ONE type, or undefined when it is not one (trailing tokens, an error). The type of a
 * network-text wire is written in its network's `VAR_TEMP` block (`g1 : BOOL;`), which the network-text parser reads
 * itself; this is how it hands the type to the one type engine.
 */
export function parseTypeExprFromTokens(tokens: readonly Token[]): TypeExpr | undefined {
  if (tokens.length === 0) return undefined
  const last = tokens[tokens.length - 1]!
  const cur = new Cursor([...tokens, { kind: "eof", text: "", span: eofSpan(last.span) }])
  const type = parseTypeExpression(cur)
  return type !== undefined && cur.atEof() && cur.getErrors().length === 0 ? type : undefined
}
