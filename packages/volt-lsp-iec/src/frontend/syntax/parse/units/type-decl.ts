/**
 * `TYPE Name [EXTENDS Base] : <body> [;] END_TYPE`
 *
 * Dispatches on the first keyword/punct after the colon:
 *
 *   STRUCT … END_STRUCT      → struct (fields look like VAR decls; supports EXTENDS)
 *   UNION  … END_UNION       → union (struct-like)
 *   '(' … ')' [base]         → enum (comma-separated values, optional base type)
 *   anything else            → alias (just parses a TypeExpr)
 *
 * The `EXTENDS BaseStruct` clause between the name and the `:`
 * applies to STRUCT DUTs only (OOP-style structs in TwinCAT 3 /
 * CODESYS 3.5). It's hoisted onto the STRUCT body so the AST puts
 * the inheritance info next to the fields.
 *
 * The trailing `;` before END_TYPE is consumed here (single source
 * of truth) — TwinCAT-idiomatic C-style terminator is tolerated for
 * struct/union/enum and required for aliases.
 */
import type {
  AliasBody,
  DutBody,
  EnumBody,
  Identifier,
  StructBody,
  TypeDecl,
  UnionBody,
  VarDecl,
} from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import { parseEnumBase, parseEnumValues, parseTypeExpression } from "../type-expr.js"
import { atSectionInStruct, FIELD_LIST, parseDeclInto, refuseSectionInStruct } from "../declarations.js"
import { joinSpans } from "../../span.js"
import { identFromToken, readIdent, readNameList } from "../names.js"
import { collectInitTokens, initializerFromTokens, refuseMalformedInit } from "../initializer.js"

export function parseTypeDecl(c: Cursor): TypeDecl | undefined {
  const start = c.expectKeyword("TYPE")
  if (start === undefined) return undefined
  const nameTok = c.expectIdent()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)
  // Optional `EXTENDS Base` clause between the name and the `:` —
  // applies to STRUCT DUTs (CODESYS / TwinCAT 3.5+ OO-style structs).
  // Per 06-data-types.md: `TYPE S_PENTAGON EXTENDS S_POLYGONLINE : STRUCT ...`.
  let extendsName: Identifier | undefined
  if (c.eatKeyword("EXTENDS") !== undefined) {
    const t = c.expectIdent()
    if (t !== undefined) extendsName = identFromToken(t)
  }
  const colon = c.expectPunct(":")
  if (colon === undefined) return undefined
  const body = parseDutBody(c)
  // Hoist the EXTENDS onto the STRUCT body (the AST stores it there). EXTENDS on any other DUT kind
  // (enum/alias → C0144, union → C0542) is illegal — capture it as `extendsMisused` for the check.
  let extendsMisused: Identifier | undefined
  if (extendsName !== undefined && body !== undefined) {
    if (body.kind === "struct" && body.extends === undefined) body.extends = extendsName
    else if (body.kind !== "struct") extendsMisused = extendsName
  }
  // TwinCAT-idiomatic optional `;` after the body (engineers C-style
  // terminate the enum/struct/alias before END_TYPE). Spec-permissive
  // for aliases (always required), tolerated by TC for the others.
  c.eatPunct(";")
  const endType = c.expectKeyword("END_TYPE")
  const endSpan = endType?.span ?? body?.span ?? start.span
  if (body === undefined) {
    return {
      kind: "type_decl",
      name,
      body: {
        kind: "alias",
        target: { kind: "named_type", name: { kind: "identifier", text: "?", span: name.span }, span: name.span },
        span: name.span,
      } satisfies DutBody,
      span: joinSpans(start.span, endSpan),
    }
  }
  return {
    kind: "type_decl",
    name,
    body,
    ...(extendsMisused !== undefined ? { extendsMisused } : {}),
    span: joinSpans(start.span, endSpan),
  }
}

// ─── DUT body parsers ────────────────────────────────────────────────

function parseDutBody(c: Cursor): DutBody | undefined {
  const next = c.peek()
  if (next.kind === "keyword" && next.keyword === "STRUCT") {
    return parseStructBody(c)
  }
  if (next.kind === "keyword" && next.keyword === "UNION") {
    return parseUnionBody(c)
  }
  if (next.kind === "punct" && next.text === "(") {
    return parseEnumBody(c)
  }
  return parseAliasBody(c)
}

function parseStructBody(c: Cursor): StructBody | undefined {
  const start = c.expectKeyword("STRUCT")
  if (start === undefined) return undefined

  let extendsName: Identifier | undefined
  if (c.eatKeyword("EXTENDS") !== undefined) {
    const t = c.expectIdent()
    if (t !== undefined) extendsName = identFromToken(t)
  }

  const fields: VarDecl[] = []
  while (!c.atEof()) {
    if (c.eatPunct(";") !== undefined) continue // stray/empty field — CODESYS accepts `x : T;;`
    const endStruct = c.eatKeyword("END_STRUCT")
    if (endStruct !== undefined) {
      return {
        kind: "struct",
        ...(extendsName !== undefined ? { extends: extendsName } : {}),
        fields,
        span: joinSpans(start.span, endStruct.span),
      }
    }
    // A VAR-section keyword inside a STRUCT is illegal (C0173) — the whole misplaced `VAR_* … END_VAR` is read and
    // refused as ONE echo (`refuseSectionInStruct`), instead of choking the field parser on `VAR_INPUT` and `END_VAR`.
    if (atSectionInStruct(c)) {
      refuseSectionInStruct(c)
      continue
    }
    // A list-ending keyword here (e.g. the outer `END_TYPE` when `END_STRUCT` is missing) means the struct
    // wasn't closed — stop with ONE "unterminated STRUCT" error and leave the token for the TYPE parser,
    // instead of choking the field parser on it AND letting recovery eat the `END_TYPE` the outer parser
    // needs. Any other non-name token is a bad field name — reported there, not on the header (see
    // `atDeclListEnd`).
    if (c.atDeclListEnd()) break
    // a field is a declaration (`parse/declarations`, one parser for both)
    if (!parseDeclInto(c, FIELD_LIST, fields)) break
  }
  c.pushError("unterminated STRUCT: expected END_STRUCT", start.span)
  return {
    kind: "struct",
    ...(extendsName !== undefined ? { extends: extendsName } : {}),
    fields,
    span: start.span,
  }
}

function parseUnionBody(c: Cursor): UnionBody | undefined {
  const start = c.expectKeyword("UNION")
  if (start === undefined) return undefined
  const fields: VarDecl[] = []
  while (!c.atEof()) {
    if (c.eatPunct(";") !== undefined) continue // stray/empty field — CODESYS accepts `x : T;;`
    const endUnion = c.eatKeyword("END_UNION")
    if (endUnion !== undefined) {
      return {
        kind: "union",
        fields,
        span: joinSpans(start.span, endUnion.span),
      }
    }
    if (c.atDeclListEnd()) break // list-ending keyword → unterminated union; leave it for the TYPE parser (see struct)
    if (!parseDeclInto(c, FIELD_LIST, fields)) break
  }
  c.pushError("unterminated UNION: expected END_UNION", start.span)
  return { kind: "union", fields, span: start.span }
}

function parseEnumBody(c: Cursor): EnumBody | undefined {
  const open = c.expectPunct("(")
  if (open === undefined) return undefined
  // the values and the base type are read as an implicit enum's are (`parse/type-expr`, one parser), but a TYPE enum's
  // list may not end in a comma (`decl_type_enum_trailing_comma`, both vendors 2026-10-01)
  const { values } = parseEnumValues(c, false)
  // Optional explicit base type after the parens: `(VAL1, VAL2) BYTE`
  const baseType = parseEnumBase(c)

  // Optional default initializer: `(A, B) := A;` — the enum type's default value.
  let init: EnumBody["init"]
  if (c.eatPunct(":=") !== undefined) {
    // a malformed literal is refused there as in a VAR declaration (`refuseMalformedInit`), and leaves no value
    const initTokens = collectInitTokens(c, true)
    if (refuseMalformedInit(c, initTokens) === undefined) init = initializerFromTokens(initTokens)
  }

  const endSpan = init?.span ?? baseType?.span ?? open.span
  return {
    kind: "enum",
    ...(baseType !== undefined ? { baseType } : {}),
    ...(init !== undefined ? { init } : {}),
    values,
    span: joinSpans(open.span, endSpan),
  }
}

function parseAliasBody(c: Cursor): AliasBody | undefined {
  const start = c.peek().span
  const target = parseTypeExpression(c)
  if (target === undefined) return undefined

  let init: AliasBody["init"]
  if (c.eatPunct(":=") !== undefined) {
    // a malformed literal is refused there as in a VAR declaration (`refuseMalformedInit`), and leaves no value
    const initTokens = collectInitTokens(c, true)
    if (refuseMalformedInit(c, initTokens) === undefined) init = initializerFromTokens(initTokens)
  }

  // Note: the trailing `;` (and the optional one for struct/union/enum)
  // is consumed at the parseTypeDecl level — single source of truth.

  const endSpan = init?.span ?? target.span
  return {
    kind: "alias",
    target,
    ...(init !== undefined ? { init } : {}),
    span: joinSpans(start, endSpan),
  }
}
