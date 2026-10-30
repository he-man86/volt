/**
 * Type expression parser — produces the STRUCTURED type nodes (A.1/A.2 refinement):
 * subrange as `{ lo, hi }` expressions, array dims as const-expr bounds (+ a `dynamic`
 * flag for `ARRAY[*]`), string length as an expression, implicit-enum values with
 * parsed value expressions. No opaque `BodySpan`s for bounds anymore.
 *
 * Grammar:
 *   TypeExpr      := ImplicitEnum | StringType | ReferenceType | PointerType | ArrayType | NamedType
 *   NamedType     := Identifier ('.' Identifier)* ( '<' Expr (',' Expr)* '>' )? ( '(' Subrange ')' )?
 *   Subrange      := Expr '..' Expr                    // after an integer/bit type only; else `(…)` is FB_Init's arguments
 *   ArrayType     := ARRAY '[' ArrayDim (',' ArrayDim)* ']' OF TypeExpr
 *   ArrayDim      := '*' | Expr '..' Expr              // all '*' or none
 *   StringType    := STRING ( ('(' | '[') Expr (')' | ']') )? | WSTRING ( '(' Expr ')' )?
 *   ImplicitEnum  := '(' EnumValue (',' EnumValue)* ','? ')' TypeExpr?
 *
 * Primitive names (BOOL/INT/REAL) lex as identifiers; the semantic layer classifies them.
 */
import type { Token } from "../lex/tokens.js"
import type { Dialect } from "../lex/vocabulary.js"
import { ELEMENTARY_TYPE_WORDS } from "../lex/word-sets.js"
import type { ArrayDim, Expr, StringLengthDelimiters, TypeExpr } from "../ast/nodes/index.js"
import { eofSpan, joinSpans, type Span } from "../span.js"
import { Cursor } from "./cursor.js"
// Inherent recursive-descent recursion: type-expr ↔ util ↔ var-section parse into each other. Function-body imports, no init hazard.
import { parseExpression, parseExprFromTokens } from "./expression.js"
import { vendorTokenText } from "./errors.js"
import { collectUntilTopLevel, topLevelDotDot } from "./scan.js"
import { parseEnumValues } from "./enum-values.js"
import { parseNamedType } from "./named-type.js"

export function parseTypeExpression(c: Cursor): TypeExpr | undefined {
  // Implicit enumeration — `(A, B, C := 10, D)` declared inline, with an optional base type after it: `( … ) INT`
  // (`decl_implicit_enum_with_base` builds and runs, both vendors 2026-10-01 — the base was consumed and dropped).
  const openParen = c.eatPunct("(")
  if (openParen !== undefined) return parseImplicitEnum(c, openParen)

  // STRING / WSTRING with optional length
  const stringTok = c.eatAnyKeyword("STRING", "WSTRING")
  if (stringTok !== undefined) return parseStringType(c, stringTok)

  // REFERENCE TO X
  const refTok = c.eatKeyword("REFERENCE")
  if (refTok !== undefined) return parseTargetType(c, refTok, "reference_type")

  // POINTER TO X
  const ptrTok = c.eatKeyword("POINTER")
  if (ptrTok !== undefined) return parseTargetType(c, ptrTok, "pointer_type")

  // ARRAY [a..b, c..d] OF X
  const arrTok = c.eatKeyword("ARRAY")
  if (arrTok !== undefined) return parseArrayType(c, arrTok)

  const vectorTok = c.eatKeyword("__VECTOR")
  if (vectorTok !== undefined) return parseVectorType(c, vectorTok)

  return parseNamedType(c)
}

function parseImplicitEnum(c: Cursor, openParen: Token): TypeExpr {
  const { values, close } = parseEnumValues(c, true)
  const baseType = parseEnumBase(c)
  const lastSpan = baseType?.span ?? close?.span ?? values.at(-1)?.span ?? openParen.span
  return {
    kind: "implicit_enum_type",
    values,
    ...(baseType !== undefined ? { baseType } : {}),
    span: joinSpans(openParen.span, lastSpan),
  }
}

function parseStringType(c: Cursor, stringTok: Token): TypeExpr {
  const wide = stringTok.keyword === "WSTRING"
  const len = parseOptionalStringLength(c, wide)
  return {
    kind: "string_type",
    wide,
    ...(len?.length !== undefined ? { length: len.length } : {}),
    ...(len?.delimiters !== undefined ? { delimiters: len.delimiters } : {}),
    span: joinSpans(stringTok.span, len?.end ?? stringTok.span),
  }
}

/** `REFERENCE TO X` / `POINTER TO X`, the keyword read. */
function parseTargetType(c: Cursor, kw: Token, kind: "reference_type" | "pointer_type"): TypeExpr | undefined {
  c.expectKeyword("TO")
  const target = parseTypeExpression(c)
  if (target === undefined) return undefined
  return { kind, target, span: joinSpans(kw.span, target.span) }
}

function parseArrayType(c: Cursor, arrTok: Token): TypeExpr | undefined {
  c.expectPunct("[")
  const dims: ArrayDim[] = []
  // the FIRST dimension decides what the rest are: all variable-length (`[*, *]`) or all bounded
  let variable: boolean | undefined
  // a dimension the vendor refuses costs the whole declaration — what follows it is the vendor's recovery (2.8.2)
  let refused = false
  const refuse = (message: string, at: Token) => {
    c.pushError(message, at.span)
    refused = true
  }
  // no dimension at all, `ARRAY[] OF INT`: the bound's `..` was wanted at the `]` (`decl_array_empty_dims`, both vendors)
  if (c.peek().kind === "punct" && c.peek().text === "]") refuse(`'..' expected instead of ']'`, c.peek())
  while (true) {
    if (c.peek().kind === "eof" || c.eatPunct("]") !== undefined) break
    const dim = parseArrayDim(c, variable, refuse)
    if (dim !== undefined) dims.push(dim)
    variable ??= dim?.dynamic
    if (c.eatPunct(",") !== undefined) continue
    c.expectPunct("]")
    break
  }
  c.expectKeyword("OF")
  const element = parseTypeExpression(c)
  if (element === undefined || refused) return undefined
  return { kind: "array_type", dims, element, span: joinSpans(arrTok.span, element.span) }
}

/**
 * CODESYS `__VECTOR[<size>] OF <type>` — SIMD fixed-size container. Same shape as
 * ARRAY[0..size-1] OF <type>; modeled as a single-dim array. A keyword only in the CODESYS dialect: on TwinCAT the
 * word lexes as an identifier and is refused as a named type (`named-type.ts`).
 */
function parseVectorType(c: Cursor, vectorTok: Token): TypeExpr | undefined {
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

/**
 * An enum's optional BASE TYPE, after its value list: `(A, B) DINT` — a TYPE enum's (`TYPE E : (A, B) BYTE;`) and an
 * implicit one's (`decl_implicit_enum_with_base`). Read when what follows is an ELEMENTARY type's name or a type keyword:
 * any other name stands where the declaration's `:=` or `;` belongs, and is the syntax error the vendor reports there —
 * the name of an alias the project declares as much as one nothing declares (`tref_enum_base_alias`, `tref_enum_base`,
 * `tref_implicit_enum_base`, CODESYS SP21 2026-10-30).
 */
export function parseEnumBase(c: Cursor): TypeExpr | undefined {
  const next = c.peek()
  const typeStart =
    (next.kind === "identifier" && ELEMENTARY_TYPE_WORDS.has(next.text.toUpperCase())) ||
    (next.kind === "keyword" && next.keyword !== undefined && TYPE_KEYWORDS.has(next.keyword))
  return typeStart ? parseTypeExpression(c) : undefined
}

/** The keywords a type expression opens with. */
const TYPE_KEYWORDS: ReadonlySet<string> = new Set(["STRING", "WSTRING", "ARRAY", "POINTER", "REFERENCE", "__VECTOR"])

/**
 * One dimension of an ARRAY: `lo..hi`, or `*` (variable length). `variable` is what the dimensions before it were —
 * undefined for the first. Measured on both vendors (`decl_array_*`, 2026-10-01), each refusal at the token where the
 * vendor wanted something else, and the declaration dropped with it (`refuse`):
 *   - a dimension with no `..` — "'..' expected instead of ']'": one bound (`[5]`), none (`[]`), a `*` after a bounded
 *     dimension (`[0..1, *]`, the `*` taken for the bound);
 *   - a bound after a `*` — "'*' expected instead of '0'" (`[*, 0..1]`): after a variable-length dimension, every
 *     dimension is one.
 */
function parseArrayDim(c: Cursor, variable: boolean | undefined, refuse: (message: string, at: Token) => void): ArrayDim | undefined {
  const start = c.peek().span
  const isStar = c.peek().kind === "punct" && c.peek().text === "*"
  if (variable === true && !isStar) {
    refuse(`'*' expected instead of ${vendorTokenText(c.peek())}`, c.peek())
    collectUntilTopLevel(c, (t) => t.kind === "punct" && (t.text === "," || t.text === "]"))
    return undefined
  }
  // Variable-length dimension `ARRAY[*]` — no bounds.
  if (isStar && variable !== false) {
    const star = c.consume()
    return { kind: "array_dim", dynamic: true, span: star.span }
  }
  // Collect the dim's tokens (depth-aware) up to the top-level `,`/`]`, then split on `..`
  // and parse each bound in a contained sub-cursor. Bounds that don't form a clean expression
  // (e.g. a `Up...Left` source typo) are left undefined rather than aborting the parse.
  const toks = collectUntilTopLevel(c, (t) => t.kind === "punct" && (t.text === "," || t.text === "]"))
  // a MALFORMED literal (`Token.malformed`) ends the bound it stands in, and the dimension wants its next token there:
  // "'] or ,' expected instead of '3#'" (`lit_malformed_array_bound`, `_typed`: an UPPER bound, both vendors; a lower
  // bound is unmeasured and refused the same way). Said on the main cursor — the bounds' contained sub-parse would drop
  // it — and the bound it stands in is not kept.
  const malformed = toks.find((t) => t.malformed)
  if (malformed !== undefined) c.pushError(`'] or ,' expected instead of ${vendorTokenText(malformed)}`, malformed.span)
  const cut = topLevelDotDot(toks)
  if (cut < 0) {
    if (malformed === undefined) refuse(`'..' expected instead of ${vendorTokenText(c.peek())}`, c.peek())
    if (toks.length === 0 || isStar) return undefined
    const lower = parseExprFromTokens(toks)
    return { kind: "array_dim", dynamic: false, ...(lower !== undefined ? { lower } : {}), span: joinSpans(start, toks.at(-1)!.span) }
  }
  const end = toks[toks.length - 1].span
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

/**
 * The optional length clause, with the span of its closer so the STRING type covers it. A STRING's length is in `(…)` or
 * `[…]`, and EITHER closer ends either opener: `STRING[5]`, `STRING(5]` and `STRING[5)` build on both vendors
 * (`decl_string_brackets`, `_mismatched`, `_mismatched_other`, 2026-10-01). A WSTRING's is in `(…)` only: `WSTRING[3]` is
 * no length — the `[` opens a bracket initializer, refused there (`decl_wstring_brackets`: "'(' expected instead of
 * '3'", D16's words) — and `WSTRING(3]` is "')' expected instead of ']'" (`decl_wstring_brackets_mismatched`).
 */
function parseOptionalStringLength(
  c: Cursor,
  wide: boolean,
): { length?: Expr; delimiters?: StringLengthDelimiters; end: Span } | undefined {
  const open = c.eatPunct("(") ?? (wide ? undefined : c.eatPunct("["))
  if (open === undefined) return undefined
  const length = parseExpression(c)
  const close = wide
    ? c.expectPunct(")")
    : (c.eatPunct(")") ?? c.eatPunct("]") ?? c.expectPunct(open.text === "(" ? ")" : "]"))
  // the delimiters as written travel with the length — a missing closer too (`STRING(80;`, a parse error), so hover prints
  // what is written there
  const delimiters = length !== undefined ? stringDelimiters(`${open.text}${close?.text ?? ""}`) : undefined
  return {
    ...(length !== undefined ? { length } : {}),
    ...(delimiters !== undefined ? { delimiters } : {}),
    end: (close ?? length ?? open).span,
  }
}

const STRING_DELIMITERS: readonly StringLengthDelimiters[] = ["()", "[]", "(]", "[)", "(", "["]

function stringDelimiters(written: string): StringLengthDelimiters {
  const d = STRING_DELIMITERS.find((x) => x === written)
  if (d === undefined) throw new Error(`'${written}' are no STRING length delimiters`)
  return d
}

