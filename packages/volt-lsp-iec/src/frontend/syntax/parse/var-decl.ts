/**
 * ONE VARIABLE DECLARATION — `name [, name] [AT %addr] : type [:= init];`, the refusals of a name or an access path the
 * vendors do not read, and the `;` after the type (`endAfterType`). Split from `declarations.ts` (openspec
 * lsp-same-standard design.md §2.2), which keeps the VAR sections around it.
 */
import type { AccessPath, VarDecl, Identifier } from "../ast/nodes/index.js"
import { bodySpanFromTokens } from "../format/language-line.js"
import type { Token } from "../lex/tokens.js"
import type { Keyword } from "../lex/vocabulary.js"
import { addressShape } from "../literal/address.js"
import { joinSpans } from "../span.js"
import type { Cursor } from "./cursor.js"
import { parseInitializer } from "./initializer.js"
import { readQualifiedName, identFromToken, joinedName, readNameList } from "./names.js"
import { parseTypeExpression } from "./type-expr.js"

/**
 * WHERE A DECLARATION STANDS — what its list ends at (the recovery anchors), and the two lists whose declarations differ:
 * a VAR_GLOBAL list (`global`: a missing `;` there is a vendor fact, `endAfterType`) and a VAR_ACCESS list (`access`: an
 * access path between the name and the type).
 */
export interface DeclList {
  ends: readonly Keyword[]
  global: boolean
  access: boolean
}

/**
 * The `;` that ends a declaration straight after its TYPE — where CODESYS, finding a NAME or an `AT` instead, lists
 * everything a declaration may go on with: "';, :=, REF=, ( or [' expected instead of 'nSpeed'" (conformance
 * `pwh_var_missing_semicolon` in a POU's VAR block, `pwh_struct_missing_semicolon` in a STRUCT — the same words), and
 * "… instead of 'AT'" for an address after the type, which neither vendor reads (`decl_at_after_type*`, `decl_at_twice`,
 * `decl_struct_field_at_after_type`, 2026-10-01). The rest is swallowed up to the `;`: a name's declaration with it (the
 * body's use of it answers "Identifier 'nSpeed' not defined"), and after `AT` the address and any initializer — the
 * declaration itself STANDS, with no initializer (`decl_at_after_type_with_init`: one message). Only the measured shapes
 * are worded so; anything else is `expectPunct`'s as before, and the recovery never runs past the END of the list. In a
 * VAR_GLOBAL list (`global`) the error carries that fact: CODESYS reports nothing for a missing `;` there, TwinCAT the
 * same words (`pwh_gvl_missing_semicolon`) — `ParseError.globalMissingSemicolon`.
 */
function endAfterType(c: Cursor, global: boolean): Token | undefined {
  const next = c.peek()
  const at = next.kind === "keyword" && next.keyword === "AT"
  // TwinCAT's `F<6>`: no generic value list there (`parse/type-expr` reads one on CODESYS only) — "';, :=, REF=, ( or ['
  // expected instead of '<'" (`decl_var_generic*`, TwinCAT 2026-10-01), never a missing `;`
  const generic = next.kind === "punct" && next.text === "<" && c.dialect === "twincat"
  if (next.kind !== "identifier" && !at && !generic) return c.expectPunct(";")
  const message = `';, :=, REF=, ( or [' expected instead of '${next.text}'`
  c.pushParseError(global && !at && !generic ? { message, span: next.span, globalMissingSemicolon: true } : { message, span: next.span })
  c.recoverTo({ keywords: ["END_VAR", "END_STRUCT", "END_UNION"], puncts: [";"] })
  return c.eatPunct(";")
}

/**
 * A BAD NAME is a different failure from a bad anything-else, and the vendor treats them differently: `Limit : INT;`
 * with `Limit` reserved is five messages, while `x : INT := 5 abc;` is ONE. So the caller has to know which it was.
 */
type DeclFailure = "bad-name"

/**
 * An `AT` operand that is NO ADDRESS is refused here, on both vendors in the same words: "Direct address expected after AT
 * instead of X" — X the operand as written (`ABC`, `16#10`, `'x'`: `cc5_at_address_not_direct`, `decl_at_not_an_address*`),
 * or the `:` when there is none (`decl_at_empty`), or an address with a size and NO POSITION (`AT %IW*`, which lexes
 * `%IW` then `*`, and `AT %MW`: `lit_address_incomplete_sized`, `lit_address_no_position`). The declaration is LOST —
 * every use of its names is "not defined" — which `VarDecl.atRefused` carries to `analysis` at-address. A malformed
 * address is a declaration that stands, with an error of its own (`literal/address`, the analysis). True when refused.
 */
function refuseAtOperand(c: Cursor, tokens: readonly Token[]): boolean {
  const op = tokens[0] ?? c.peek()
  if (op.kind === "address_lit" && addressShape(op.text).kind !== "no-position") return false
  c.pushParseError({ message: `Direct address expected after AT instead of ${op.text}`, span: op.span, directAddressExpected: op.text })
  return true
}

/**
 * A NAME WHERE `,`, `AT` OR `:` BELONGS — the next word after a declaration's name. Both vendors: "',, AT or :' expected
 * instead of 'x'", and the declaration is gone to its `;` — `VAR NON_RETAIN x : T;` declares neither (NON_RETAIN is a
 * name, `lex/vocabulary`; `var_non_retain`, `decl_non_retain_in_*`, `decl_retain_non_retain`, 2026-10-01). So is a `;`
 * there — and the refused `;` is passed, so the recovery runs to the NEXT one and the declaration after it is gone too:
 * `ld : TON; out : INT;` resumes a declaration at `TON` and loses `out` ("Identifier 'out' not defined",
 * `rec_refused_name_declared_fb_type`, CODESYS 2026-10-02). Anything else is `expectPunct(":")`'s as before. True when
 * refused.
 */
function refuseNameAfterName(c: Cursor): boolean {
  const next = c.peek()
  const semicolon = next.kind === "punct" && next.text === ";"
  if (next.kind !== "identifier" && !semicolon) return false
  c.pushError(`',, AT or :' expected instead of '${next.text}'`, next.span)
  if (semicolon) c.consume()
  return true
}

/** A VAR_ACCESS declaration's path and direction (`AccessDecl`), the cursor after the path's own `:`. */
function readAccessPath(c: Cursor): AccessPath | undefined {
  const first = c.expectIdent()
  if (first === undefined) return undefined
  const parts = readQualifiedName(c, first, "report")
  return { path: parts.map(identFromToken), span: joinSpans(first.span, parts.at(-1)!.span) }
}

export function parseVarDecl(c: Cursor, list: DeclList): VarDecl | DeclFailure | undefined {
  // `expectName` (not `expectIdent`): the soft keywords GET/SET/OVERRIDE are legal variable names — the Standard `RS`
  // FB literally declares `SET : BOOL`, and CODESYS accepts it (`lex_soft_keyword_name_*`), in a STRUCT too
  // (`decl_struct_field_soft_name`). An IL operator, an elementary type's name or a `__` name is refused there too
  // (`isRefusedDeclaredName`, rule R6, frontend-conformance 2.8.3).
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
  if (refuseNameAfterName(c)) return undefined

  // `AT <address>` before the colon (`digIn AT %I*`, `a, b AT %MW40 : INT;`, a STRUCT field `a AT %MW50 : INT;`).
  let at: VarDecl["at"]
  let atRefused = false
  const atKw = c.eatKeyword("AT")
  if (atKw !== undefined) {
    const tokens: Token[] = []
    while (!c.atEof()) {
      const next = c.peek()
      if (next.kind === "punct" && (next.text === ":" || next.text === ":=" || next.text === ";")) break
      tokens.push(c.consume())
    }
    atRefused = refuseAtOperand(c, tokens)
    at = bodySpanFromTokens(tokens, atKw.span, c.dialect)
  }

  const colon = c.expectPunct(":")
  if (colon === undefined) return undefined

  let access: AccessPath | undefined
  if (list.access) {
    access = readAccessPath(c)
    if (access === undefined || c.expectPunct(":") === undefined) return undefined
  }

  const type = parseTypeExpression(c)
  if (type === undefined) return undefined

  if (access !== undefined) {
    const direction = c.eatAnyKeyword("READ_ONLY", "READ_WRITE")
    if (direction !== undefined) access = { ...access, direction: direction.keyword === "READ_ONLY" ? "READ_ONLY" : "READ_WRITE" }
  }

  const { init, initOp, refusedInit } = parseInitializer(c)

  const semi = init === undefined && refusedInit === undefined ? endAfterType(c, list.global) : c.expectPunct(";")
  const endSpan = semi?.span ?? init?.span ?? refusedInit?.span ?? type.span

  return {
    kind: "var_decl",
    names,
    type,
    ...(init !== undefined ? { init } : {}),
    ...(refusedInit !== undefined ? { refusedInit } : {}),
    ...(initOp !== undefined ? { initOp } : {}),
    ...(at !== undefined ? { at } : {}),
    ...(atRefused ? { atRefused: true as const } : {}),
    ...(access !== undefined ? { access } : {}),
    span: joinSpans(firstName.span, endSpan),
  }
}
