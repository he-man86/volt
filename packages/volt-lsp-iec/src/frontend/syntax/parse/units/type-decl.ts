/**
 * `TYPE Name [EXTENDS Base] : <body> END_TYPE`
 *
 * Dispatches on the first keyword/punct after the colon:
 *
 *   STRUCT … END_STRUCT      → struct (fields are declarations, `parse/declarations`)
 *   UNION  … END_UNION       → union (struct-like)
 *   '(' … ')' [base]         → enum (comma-separated values, optional base type)
 *   anything else            → alias (just parses a TypeExpr)
 *
 * MEASURED, both vendors (`fixtures/grammar/units.ts`, 2026-10-01):
 *
 *   EXTENDS stands in ONE place, between the name and the `:`, and names ONE base. `STRUCT EXTENDS B` is the field
 *   parser's "Unexpected token 'EXTENDS' found" (`unit_struct_extends_after_struct`), `EXTENDS A, B` is "':' expected
 *   instead of ','" (`unit_struct_extends_list`). It is hoisted onto the STRUCT body (the AST puts the inheritance next
 *   to the fields); on any other body it is `extendsMisused`, a check's.
 *
 *   The `;` before END_TYPE: an alias REQUIRES it ("':= or ;' expected instead of 'END_TYPE'", `unit_alias_no_semicolon`),
 *   an enum takes it, and a STRUCT or UNION refuses it ("'END_TYPE' expected instead of ';'", `unit_struct_end_semicolon`,
 *   `unit_union_end_semicolon`).
 *
 *   A refused token is CONSUMED, and the end of the object is quoted as '' — so `TYPE X : END_TYPE` is "Type
 *   definition expected instead of 'END_TYPE'", "':= or ;' expected instead of ''", "'END_TYPE' expected instead of
 *   ''" (`unit_type_no_body`). A header the vendor cannot read (no `:`, an EXTENDS list) is skipped through the next `;`,
 *   and END_TYPE is then expected (`unit_type_missing_colon`: "': or EXTENDS' expected instead of 'STRUCT'", "'END_TYPE'
 *   expected instead of 'END_STRUCT'"). Either way the type is KEPT, bodiless (`RefusedBody`): it is no unknown type
 *   where it is used.
 */
import type {
  AliasBody,
  RefusedBody,
  DutBody,
  EnumBody,
  Identifier,
  StructBody,
  TypeDecl,
  UnionBody,
  VarDecl,
} from "../../ast/nodes.js"
import type { Token } from "../../lex/tokens.js"
import { DECL_LIST_ENDERS, UNIT_STARTERS } from "../../lex/vocabulary.js"
import type { Cursor } from "../cursor.js"
import { parseEnumBase, parseEnumValues, parseTypeExpression } from "../type-expr.js"
import { atSectionInStruct, FIELD_LIST, parseDeclInto, refuseSectionInStruct } from "../declarations.js"
import { joinSpans } from "../../span.js"
import { vendorTokenText } from "../errors.js"
import { identFromToken, readHeaderName } from "../names.js"
import { collectInitTokens, initializerFromTokens, refuseMalformedInit } from "../initializer.js"

export function parseTypeDecl(c: Cursor): TypeDecl | undefined {
  const start = c.expectKeyword("TYPE")
  if (start === undefined) return undefined
  const nameTok = c.expectIdent()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)
  // Optional `EXTENDS Base` between the name and the `:` (`TYPE S_PENTAGON EXTENDS S_POLYGONLINE : STRUCT ...`).
  let extendsName: Identifier | undefined
  if (c.eatKeyword("EXTENDS") !== undefined) extendsName = readHeaderName(c)

  let body: DutBody
  if (c.eatPunct(":") === undefined) {
    // what may stand here is the colon, or EXTENDS while none was written
    refuse(c, extendsName !== undefined ? "':'" : "': or EXTENDS'")
    body = { kind: "refused", span: name.span }
    skipThroughSemicolon(c)
  } else {
    body = parseDutBody(c, name)
    endBody(c, body)
  }
  // Hoist the EXTENDS onto the STRUCT body (the AST stores it there). EXTENDS on any other DUT is illegal — captured as
  // `extendsMisused` for the check (a bodiless type's included: both vendors give it an alias's messages).
  let extendsMisused: Identifier | undefined
  if (extendsName !== undefined) {
    if (body.kind === "struct") body.extends = extendsName
    else extendsMisused = extendsName
  }
  // a refused token is consumed, so END_TYPE may stand right behind it (`… instead of 'END_STRUCT'`, then END_TYPE)
  let endType = c.eatKeyword("END_TYPE")
  if (endType === undefined) {
    refuse(c, "'END_TYPE'")
    endType = c.eatKeyword("END_TYPE")
  }
  return {
    kind: "type_decl",
    name,
    body,
    ...(extendsMisused !== undefined ? { extendsMisused } : {}),
    // without its END_TYPE the unit ends at the last token it consumed — so the errors it raised lie inside it
    span: joinSpans(start.span, endType?.span ?? c.previous().span),
  }
}

/** The end of the object, as both vendors quote it in a TYPE: '' — the end of the text, or the next POU's or TYPE's start
 *  (a workspace holds one object per file; a fixture several). A VAR section keyword is no such start: inside a broken
 *  STRUCT it is the DUT's own text (`decl_var_access_inside_struct`), and a GVL follows no TYPE in one file. */
function atObjectEnd(t: Token): boolean {
  return t.kind === "eof" || (t.kind === "keyword" && OBJECT_STARTERS.has(t.keyword ?? ""))
}
const OBJECT_STARTERS: ReadonlySet<string> = new Set(
  UNIT_STARTERS.filter((k) => k !== "VAR_GLOBAL" && k !== "VAR_CONFIG" && k !== "VAR_ACCESS"),
)

/** "`<expected>` expected instead of 'T'", and the token CONSUMED — the vendor's recovery in a TYPE (`consumeRefused`).
 *  The end of the object is quoted as ''. */
function refuse(c: Cursor, expected: string): void {
  const t = c.peek()
  c.pushError(`${expected} expected instead of ${atObjectEnd(t) ? "''" : vendorTokenText(t)}`, t.span)
  consumeRefused(c)
}

/** Past the token a TYPE refused, as the vendor reads on — never the end of the object, and never a keyword recovery must
 *  not eat past (`DECL_LIST_ENDERS`): a VAR section keyword in a broken STRUCT is left for the recovery that reads it. */
function consumeRefused(c: Cursor): void {
  const t = c.peek()
  if (!atObjectEnd(t) && !(t.kind === "keyword" && DECL_LIST_ENDERS.has(t.keyword ?? ""))) c.consume()
}

/** Past the next `;` (a header the vendor could not read), stopping at the end of the object. */
function skipThroughSemicolon(c: Cursor): void {
  while (!atObjectEnd(c.peek())) if (c.consume().text === ";") return
}

/** What ends a body before END_TYPE: an alias's required `;` (`:=` while it has no initializer), an enum's optional
 *  one, and a STRUCT's or UNION's refused one. */
function endBody(c: Cursor, body: DutBody): void {
  if (body.kind === "alias" || body.kind === "refused") {
    if (c.eatPunct(";") === undefined) refuse(c, body.kind === "alias" && body.init !== undefined ? "';'" : "':= or ;'")
  } else if (body.kind === "enum") c.eatPunct(";")
  else if (c.peek().kind === "punct" && c.peek().text === ";") refuse(c, "'END_TYPE'")
}

// ─── DUT body parsers ────────────────────────────────────────────────

function parseDutBody(c: Cursor, name: Identifier): DutBody {
  const next = c.peek()
  if (next.kind === "keyword" && next.keyword === "STRUCT") return parseStructBody(c)
  if (next.kind === "keyword" && next.keyword === "UNION") return parseUnionBody(c)
  if (next.kind === "punct" && next.text === "(") return parseEnumBody(c)
  return parseAliasBody(c, name)
}

function parseStructBody(c: Cursor): StructBody {
  const start = c.consume() // STRUCT
  const fields: VarDecl[] = []
  while (!c.atEof()) {
    if (c.eatPunct(";") !== undefined) continue // stray/empty field — CODESYS accepts `x : T;;`
    const endStruct = c.eatKeyword("END_STRUCT")
    if (endStruct !== undefined) return { kind: "struct", fields, span: joinSpans(start.span, endStruct.span) }
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
  return { kind: "struct", fields, span: start.span }
}

function parseUnionBody(c: Cursor): UnionBody {
  const start = c.consume() // UNION
  const fields: VarDecl[] = []
  while (!c.atEof()) {
    if (c.eatPunct(";") !== undefined) continue // stray/empty field — CODESYS accepts `x : T;;`
    const endUnion = c.eatKeyword("END_UNION")
    if (endUnion !== undefined) return { kind: "union", fields, span: joinSpans(start.span, endUnion.span) }
    if (c.atDeclListEnd()) break // list-ending keyword → unterminated union; leave it for the TYPE parser (see struct)
    if (!parseDeclInto(c, FIELD_LIST, fields)) break
  }
  c.pushError("unterminated UNION: expected END_UNION", start.span)
  return { kind: "union", fields, span: start.span }
}

function parseEnumBody(c: Cursor): EnumBody {
  const open = c.consume() // (
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

/** An alias, or — its type refused ("Type definition expected instead of 'END_TYPE'") — a bodiless type, the refused
 *  token consumed as the vendor does (`unit_type_no_body`). */
function parseAliasBody(c: Cursor, name: Identifier): AliasBody | RefusedBody {
  const start = c.peek().span
  const target = parseTypeExpression(c)
  if (target === undefined) {
    consumeRefused(c)
    return { kind: "refused", span: name.span }
  }

  let init: AliasBody["init"]
  if (c.eatPunct(":=") !== undefined) {
    // a malformed literal is refused there as in a VAR declaration (`refuseMalformedInit`), and leaves no value
    const initTokens = collectInitTokens(c, true)
    if (refuseMalformedInit(c, initTokens) === undefined) init = initializerFromTokens(initTokens)
  }

  const endSpan = init?.span ?? target.span
  return {
    kind: "alias",
    target,
    ...(init !== undefined ? { init } : {}),
    span: joinSpans(start, endSpan),
  }
}
