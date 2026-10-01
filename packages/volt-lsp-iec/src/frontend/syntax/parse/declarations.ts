/**
 * DECLARATIONS — VAR sections (every keyword of `VAR_SECTION_KEYWORDS`, twelve, with their modifiers CONSTANT, RETAIN,
 * NON_RETAIN, PERSISTENT), the declarations in them, and a STRUCT's or UNION's fields (`parseStructField`, beside
 * `parseVarDecl` until conformance 2.3.5 makes them one).
 *
 * Grammar (simplified):
 *   VarSection := VarKw Modifiers* VarDecl* END_VAR
 *   Modifier   := CONSTANT | RETAIN | NON_RETAIN | PERSISTENT
 *   VarDecl    := Name (',' Name)* ('AT' Address)? ':' TypeExpr ('AT' Address)? (':=' Initializer)? ';'
 *
 * Recovery: on a bad declaration, skip to the next ';' or END_VAR so one malformed variable does not poison the rest
 * of the section — reporting as the vendor does (`errors.ts` `reportBrokenDeclaration`).
 */
import type { Token } from "../lex/tokens.js"
import { type Identifier, type RefusedInit, type VarDecl, type VarSection, type VarSectionKind } from "../ast/nodes.js"
import { Cursor } from "./cursor.js"
import { parseTypeExpression } from "./type-expr.js"
import { parseExprFromTokens } from "./expression.js"
import { VAR_SECTION_KEYWORDS, type Keyword } from "../lex/vocabulary.js"
import { joinSpans } from "../span.js"
import { reportBrokenDeclaration } from "./errors.js"
import { identFromToken, joinedName, readIdent, readNameList, readQualifiedName } from "./names.js"
import { bodySpanFromTokens } from "../format/implementation-line.js"
import { collectInitTokens, initializerFromTokens, refuseMalformedInit } from "./initializer.js"
import { addressShape } from "../literal/address.js"

/**
 * The first token after a COMPLETE scalar initializer, or undefined. `x : INT := 5 abc;` does not compile —
 * "';' expected instead of 'abc'" (conformance `cc_decl_init_trailing_ident`, `_int`) — but the initializer's tokens were
 * collected up to the `;` and anything that did not parse became an opaque aggregate, silently (gap 12). An aggregate
 * shape (`(`, `[`, `STRUCT`) is the aggregate parser's; a malformed literal is `refuseMalformedInit`'s, asked first.
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
 * The `;` that ends a declaration straight after its TYPE — where CODESYS, finding a NAME instead, lists everything a
 * declaration may go on with: "';, :=, REF=, ( or [' expected instead of 'nSpeed'" (conformance
 * `pwh_var_missing_semicolon` in a POU's VAR block, `pwh_struct_missing_semicolon` in a STRUCT — the same words). The
 * declaration that name opens is swallowed with it, up to its `;`: the body's use of it answers "Identifier 'nSpeed'
 * not defined". Only the measured shape — a name — is worded so; anything else is `expectPunct`'s as before, and the
 * recovery never runs past the END of the list. In a VAR_GLOBAL list (`global`) the error carries that fact: CODESYS
 * reports nothing for it there, TwinCAT the same words (`pwh_gvl_missing_semicolon`) — `ParseError.globalMissingSemicolon`.
 */
export function endAfterType(c: Cursor, global: boolean): Token | undefined {
  const next = c.peek()
  if (next.kind !== "identifier") return c.expectPunct(";")
  const message = `';, :=, REF=, ( or [' expected instead of '${next.text}'`
  c.pushParseError(global ? { message, span: next.span, globalMissingSemicolon: true } : { message, span: next.span })
  c.recoverTo({ keywords: ["END_VAR", "END_STRUCT", "END_UNION"], puncts: [";"] })
  return c.eatPunct(";")
}

/** Returns true if the next meaningful token starts a VAR section. */
export function atVarSection(c: Cursor): boolean {
  const t = c.peek()
  return t.kind === "keyword" && t.keyword !== undefined && VAR_SECTION_KEYWORDS.includes(t.keyword)
}

/** Parse a single VAR section starting at one of the section keywords. */
export function parseVarSection(c: Cursor): VarSection | undefined {
  const header = c.eatAnyKeyword(...VAR_SECTION_KEYWORDS)
  if (header === undefined) return undefined

  const sectionKind = header.keyword as VarSectionKind
  const section: VarSection = {
    kind: "var_section",
    sectionKind,
    decls: [],
    span: header.span,
  }

  // Modifiers — any combination of CONSTANT / RETAIN / NON_RETAIN / PERSISTENT.
  while (true) {
    const mod = c.eatAnyKeyword("CONSTANT", "RETAIN", "NON_RETAIN", "PERSISTENT")
    if (mod === undefined) break
    if (mod.keyword === "CONSTANT") section.constant = true
    if (mod.keyword === "RETAIN") section.retain = true
    if (mod.keyword === "NON_RETAIN") section.nonRetain = true
    if (mod.keyword === "PERSISTENT") section.persistent = true
  }

  // Decls until END_VAR.
  while (!c.atEof()) {
    if (c.eatPunct(";") !== undefined) continue // stray/empty declaration — CODESYS accepts `x : T;;`
    const endVar = c.eatKeyword("END_VAR")
    if (endVar !== undefined) {
      section.span = joinSpans(header.span, endVar.span)
      return section
    }
    // A section-ending keyword here (a unit closer like END_FUNCTION_BLOCK, or the next section) means the
    // section was never closed — stop cleanly with ONE "unterminated" error and LEAVE the token for the
    // caller. Choking `parseVarDecl` on it instead cascades: a bogus "expected identifier" AND recovery eats
    // the unit's closer, drawing a third "unterminated <unit>" from the unit parser.
    // Any OTHER non-name token is a reserved word used as a variable name (`Limit : INT;`) — a bad decl, not
    // an unterminated section. Fall through: `parseVarDecl` reports it on the name and recovers to the `;`.
    if (c.atDeclListEnd()) break
    const decl = parseVarDecl(c, sectionKind === "VAR_GLOBAL")
    if (decl !== undefined && decl !== "bad-name") {
      section.decls.push(decl)
    } else {
      // A BAD NAME resyncs the VENDOR'S way. `expectName` leaves the offending name UNCONSUMED and has already
      // reported it, so the name is taken here and the rest of the declaration reported token by token. Any OTHER
      // failure keeps the quiet recovery: `x : INT := 5 abc;` is ONE message on CODESYS, not a cascade.
      if (decl === "bad-name") {
        c.consume()
        reportBrokenDeclaration(c, ["END_VAR"])
      }
      if (!c.recoverTo({ keywords: ["END_VAR"], puncts: [";"] })) break
      c.eatPunct(";") // consume the ';' anchor if that's what we landed on
    }
  }
  c.pushError("unterminated VAR section: expected END_VAR", header.span)
  return section
}

/**
 * A BAD NAME is a different failure from a bad anything-else, and the vendor treats them differently: `Limit : INT;`
 * with `Limit` reserved is five messages, while `x : INT := 5 abc;` is ONE. So the caller has to know which it was.
 */
type DeclFailure = "bad-name"

/**
 * An `AT` operand that is an address with a size and NO POSITION is no address at all — `AT %IW*` (which lexes `%IW` then
 * `*`) and `AT %MW` are "Direct address expected after AT instead of %IW" on both vendors, and the declaration is lost
 * (`lit_address_incomplete_sized`, `lit_address_no_position`, 2026-10-01; the lost uses are `analysis` at-address's).
 * A malformed address is a declaration that stands, with an error of its own (`literal/address`, the analysis).
 */
function refuseAtOperand(c: Cursor, tokens: readonly Token[]): void {
  const op = tokens[0]
  if (op?.kind !== "address_lit" || addressShape(op.text).kind !== "no-position") return
  c.pushParseError({ message: `Direct address expected after AT instead of ${op.text}`, span: op.span, directAddressExpected: op.text })
}

function parseVarDecl(c: Cursor, global: boolean): VarDecl | DeclFailure | undefined {
  // `expectName` (not `expectIdent`): the soft keywords GET/SET/OVERRIDE are legal variable names — the Standard `RS`
  // FB literally declares `SET : BOOL`, and CODESYS accepts it (`lex_soft_keyword_name_*`). An IL operator or `__`
  // name is refused by `analysis/checks/names/refused-name.ts` until conformance 2.8.3 gives the two declaration
  // cascades one home: they differ on `s : ST_Foo;`, which no recording decides.
  // The token that could not be a name is REMEMBERED, not just reported: a declaration that fails binds nothing,
  // and without this every later mention of the name is "not defined" where CODESYS stops at the parse error.
  // See `ParseResult.failedDeclarations`.
  const failing = c.peek()
  const firstName = c.expectName()
  if (firstName === undefined) {
    c.declarationFailed(failing)
    return "bad-name"
  }
  const names: Identifier[] = [
    joinedName(readQualifiedName(c, firstName, "consume")),
    ...readNameList(c, () => {
      const more = c.expectName()
      return more === undefined ? undefined : joinedName(readQualifiedName(c, more, "consume"))
    }),
  ]

  // `AT <address>` can appear *before* the colon (standard IEC and
  // TwinCAT memory-mapped vars like `digIn AT %I*`) or *after* the
  // type (less common but seen). We support both — capture whichever
  // fires first into `at`.
  let at: VarDecl["at"]
  const atKwBefore = c.eatKeyword("AT")
  if (atKwBefore !== undefined) {
    const tokens: Token[] = []
    while (!c.atEof()) {
      const next = c.peek()
      if (next.kind === "punct" && (next.text === ":" || next.text === ":=" || next.text === ";")) break
      tokens.push(c.consume())
    }
    refuseAtOperand(c, tokens)
    at = bodySpanFromTokens(tokens, atKwBefore.span)
  }

  const colon = c.expectPunct(":")
  if (colon === undefined) return undefined

  const type = parseTypeExpression(c)
  if (type === undefined) return undefined

  // Optional `AT <address>` clause *after* the type (alternative position).
  if (at === undefined) {
    const atKw = c.eatKeyword("AT")
    if (atKw !== undefined) {
      const tokens: Token[] = []
      while (!c.atEof()) {
        const next = c.peek()
        if (next.kind === "punct" && (next.text === ":=" || next.text === ";")) break
        tokens.push(c.consume())
      }
      refuseAtOperand(c, tokens)
      at = bodySpanFromTokens(tokens, atKw.span)
    }
  }

  // Optional initializer. Two forms (either or both):
  //   - an array-element list `[ (f := v, …), … ]` after an `ARRAY[…] OF <FB>` type;
  //   - a `:= <expr>` clause (scalar, struct `( f := v, … )`, or array literal).
  // A clean scalar init becomes an `Expr`; an aggregate stays an opaque `AggregateInit`.
  // `REF=` binds a REFERENCE TO var to its target.
  let init: VarDecl["init"]
  const hasBracketInit = c.peek().kind === "punct" && c.peek().text === "["
  const assign = hasBracketInit ? undefined : (c.eatPunct(":=") ?? c.eatPunct("REF="))
  // WHICH one it was is kept: a REFERENCE binds its target with `REF=`, and dropping the operator made that
  // declaration indistinguishable from an assignment to whatever the reference points at.
  const initOp = assign?.text === "REF=" ? ("REF=" as const) : undefined
  let refusedInit: RefusedInit | undefined
  if (hasBracketInit || assign !== undefined) {
    const initTokens = collectInitTokens(c)
    refusedInit = refuseMalformedInit(c, initTokens)
    if (refusedInit === undefined) {
      init = initializerFromTokens(initTokens)
      const stray = strayAfterScalarInit(initTokens)
      if (stray !== undefined) c.pushError(`';' expected instead of '${stray.text}'`, stray.span)
    }
  }

  const semi =
    init === undefined && refusedInit === undefined && at === undefined
      ? endAfterType(c, global)
      : c.expectPunct(";")
  const endSpan = semi?.span ?? init?.span ?? refusedInit?.span ?? at?.span ?? type.span

  return {
    kind: "var_decl",
    names,
    type,
    ...(init !== undefined ? { init } : {}),
    ...(refusedInit !== undefined ? { refusedInit } : {}),
    ...(initOp !== undefined ? { initOp } : {}),
    ...(at !== undefined ? { at } : {}),
    span: joinSpans(firstName.span, endSpan),
  }
}

/**
 * A STRUCT or UNION field — the same shape as a VAR declaration without the VAR/END_VAR wrapper, parsed by its own
 * reader beside `parseVarDecl` until conformance 2.3.5 makes them one.
 */
export function parseStructField(c: Cursor): VarDecl | undefined {
  const first = c.expectIdent()
  if (first === undefined) return undefined
  const names: Identifier[] = [identFromToken(first), ...readNameList(c, () => readIdent(c))]
  const colon = c.expectPunct(":")
  if (colon === undefined) return undefined
  const type = parseTypeExpression(c)
  if (type === undefined) return undefined

  let init: VarDecl["init"]
  let refusedInit: RefusedInit | undefined
  if (c.eatPunct(":=") !== undefined) {
    const initTokens = collectInitTokens(c)
    refusedInit = refuseMalformedInit(c, initTokens)
    if (refusedInit === undefined) init = initializerFromTokens(initTokens)
  }

  const semi = init === undefined && refusedInit === undefined ? endAfterType(c, false) : c.expectPunct(";")
  const endSpan = semi?.span ?? init?.span ?? refusedInit?.span ?? type.span
  return {
    kind: "var_decl",
    names,
    type,
    ...(init !== undefined ? { init } : {}),
    ...(refusedInit !== undefined ? { refusedInit } : {}),
    span: joinSpans(first.span, endSpan),
  }
}

/**
 * Consume as many consecutive VAR sections as appear at the cursor.
 * Used by every POU-shape parser — FB, PROGRAM, FUNCTION, METHOD —
 * after the header, before the body.
 */
export function collectVarSections(c: Cursor): VarSection[] {
  const sections: VarSection[] = []
  while (atVarSection(c)) {
    const s = parseVarSection(c)
    if (s !== undefined) sections.push(s)
    else break
  }
  return sections
}
