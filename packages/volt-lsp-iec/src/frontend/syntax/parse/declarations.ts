/**
 * DECLARATIONS — VAR sections (every keyword of `VAR_SECTION_KEYWORDS` with its qualifiers CONSTANT, RETAIN,
 * PERSISTENT), the declarations in them, a STRUCT's or UNION's fields, and a file-scope VAR_ACCESS list's access paths.
 * ONE declaration parser (`parseVarDecl`) reads all of them: a STRUCT field is a declaration to both vendors — a soft
 * keyword names one, `REF=` binds one, `AT` places one, a stray token after its initializer is the same error
 * (`decl_struct_field_*`, 2026-10-01).
 *
 * Grammar (simplified):
 *   VarSection := VarKw Qualifier* VarDecl* END_VAR
 *   Qualifier  := CONSTANT | RETAIN | PERSISTENT          (NON_RETAIN is a NAME, `lex/vocabulary`)
 *   VarDecl    := Name (',' Name)* ('AT' Address)? ':' TypeExpr Init? ';'
 *   Init       := (':=' | 'REF=') Initializer | '[' ('(' … ')') (',' '(' … ')')* ']'
 *   AccessDecl := Name ':' Path ':' TypeExpr (READ_ONLY | READ_WRITE)? ';'
 *
 * `AT` after the type is no grammar either vendor has: "';, :=, REF=, ( or [' expected instead of 'AT'"
 * (`decl_at_after_type*`). Recovery: on a bad declaration, skip to the next ';' or the list's end so one malformed
 * variable does not poison the rest — reporting as the vendor does (`errors.ts` `reportBrokenDeclaration`).
 */
import type { Token } from "../lex/tokens.js"
import {
  REFUSED_PLACEHOLDER,
  type AccessPath,
  type Identifier,
  type Initializer,
  type RefusedInit,
  type VarDecl,
  type VarSection,
  type VarSectionKind,
} from "../ast/nodes.js"
import { Cursor } from "./cursor.js"
import { parseTypeExpression } from "./type-expr.js"
import { parseExprFromTokens } from "./expression.js"
import { VAR_SECTION_KEYWORDS, type Keyword } from "../lex/vocabulary.js"
import { joinSpans } from "../span.js"
import { reportBrokenDeclaration, vendorExpressionExpected, vendorTokenText } from "./errors.js"
import { identFromToken, joinedName, readNameList, readQualifiedName } from "./names.js"
import { bodySpanFromTokens } from "../format/implementation-line.js"
import { collectInitTokens, initializerFromTokens, refuseMalformedInit, refuseOperatorTrailingComma } from "./initializer.js"
import { addressShape } from "../literal/address.js"

/**
 * WHERE A DECLARATION STANDS — what its list ends at (the recovery anchors), and the two lists whose declarations differ:
 * a VAR_GLOBAL list (`global`: a missing `;` there is a vendor fact, `endAfterType`) and a VAR_ACCESS list (`access`: an
 * access path between the name and the type).
 */
interface DeclList {
  ends: readonly Keyword[]
  global: boolean
  access: boolean
}

const VAR_LIST = (sectionKind: VarSectionKind): DeclList => ({
  ends: ["END_VAR"],
  global: sectionKind === "VAR_GLOBAL",
  access: sectionKind === "VAR_ACCESS",
})

/** A STRUCT's or UNION's field list. */
export const FIELD_LIST: DeclList = { ends: ["END_STRUCT", "END_UNION"], global: false, access: false }

/**
 * The first token after a COMPLETE scalar initializer, or undefined. `x : INT := 5 abc;` does not compile —
 * "';' expected instead of 'abc'" (conformance `cc_decl_init_trailing_ident`, `_int`, `decl_struct_field_stray_token`) —
 * but the initializer's tokens were collected up to the `;` and anything that did not parse became an opaque aggregate,
 * silently (gap 12). An aggregate shape (`(`, `[`, `STRUCT`) is the aggregate parser's; a malformed literal is
 * `refuseMalformedInit`'s, asked first.
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
export function endAfterType(c: Cursor, global: boolean): Token | undefined {
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

/** Returns true if the next meaningful token starts a VAR section. */
export function atVarSection(c: Cursor): boolean {
  const t = c.peek()
  return t.kind === "keyword" && t.keyword !== undefined && VAR_SECTION_KEYWORDS.includes(t.keyword)
}

/**
 * Parse a single VAR section starting at one of the section keywords. A VAR_GENERIC section is CONSTANT or nothing:
 * "Only CONSTANT generics are supported in VAR_GENERIC declaration" (`decl_var_generic_no_constant`, CODESYS 2026-10-01).
 */
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

  // Qualifiers — any combination of CONSTANT / RETAIN / PERSISTENT, in any order and repeated (`decl_retain_constant`,
  // `decl_persistent_retain`, `decl_retain_twice` build on both vendors).
  while (true) {
    const mod = c.eatAnyKeyword("CONSTANT", "RETAIN", "PERSISTENT")
    if (mod === undefined) break
    if (mod.keyword === "CONSTANT") section.constant = true
    if (mod.keyword === "RETAIN") section.retain = true
    if (mod.keyword === "PERSISTENT") section.persistent = true
  }
  if (sectionKind === "VAR_GENERIC" && section.constant !== true)
    c.pushError("Only CONSTANT generics are supported in VAR_GENERIC declaration", header.span)

  const list = VAR_LIST(sectionKind)
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
    if (!parseDeclInto(c, list, section.decls)) break
  }
  c.pushError("unterminated VAR section: expected END_VAR", header.span)
  return section
}

/**
 * One declaration of `list` into `decls`, recovering the list's way when it fails. False when the recovery ran off the
 * end of the text. A BAD NAME resyncs the VENDOR'S way: `expectName` leaves the offending name UNCONSUMED and has
 * already reported it, so the name is taken here and the rest of the declaration reported token by token
 * (`lex_limit_as_variable`, `decl_struct_field_reserved_name`). Any OTHER failure keeps the quiet recovery:
 * `x : INT := 5 abc;` is ONE message on CODESYS, not a cascade.
 */
export function parseDeclInto(c: Cursor, list: DeclList, decls: VarDecl[]): boolean {
  const decl = parseVarDecl(c, list)
  if (decl !== undefined && decl !== "bad-name") {
    decls.push(decl)
    return true
  }
  if (decl === "bad-name") {
    c.consume()
    reportBrokenDeclaration(c, list.ends)
  }
  if (!c.recoverTo({ keywords: list.ends, puncts: [";"] })) return false
  c.eatPunct(";") // consume the ';' anchor if that's what we landed on
  return true
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
 * name, `lex/vocabulary`; `var_non_retain`, `decl_non_retain_in_*`, `decl_retain_non_retain`, 2026-10-01). Only that
 * measured shape — a name — is worded so; anything else is `expectPunct(":")`'s as before. True when refused.
 */
function refuseNameAfterName(c: Cursor): boolean {
  const next = c.peek()
  if (next.kind !== "identifier") return false
  c.pushError(`',, AT or :' expected instead of '${next.text}'`, next.span)
  return true
}

/** A VAR_ACCESS declaration's path and direction (`AccessDecl`), the cursor after the path's own `:`. */
function readAccessPath(c: Cursor): AccessPath | undefined {
  const first = c.expectIdent()
  if (first === undefined) return undefined
  const parts = readQualifiedName(c, first, "report")
  return { path: parts.map(identFromToken), span: joinSpans(first.span, parts.at(-1)!.span) }
}

function parseVarDecl(c: Cursor, list: DeclList): VarDecl | DeclFailure | undefined {
  // `expectName` (not `expectIdent`): the soft keywords GET/SET/OVERRIDE are legal variable names — the Standard `RS`
  // FB literally declares `SET : BOOL`, and CODESYS accepts it (`lex_soft_keyword_name_*`), in a STRUCT too
  // (`decl_struct_field_soft_name`). An IL operator or `__` name is refused by `analysis/checks/names/refused-name.ts`
  // until conformance 2.8.3 gives the two declaration cascades one home: they differ on `s : ST_Foo;`, which no
  // recording decides.
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
    at = bodySpanFromTokens(tokens, atKw.span)
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

/**
 * A declaration's initializer, if one follows its type. Two forms:
 *   - `:= <expr>` / `REF= <target>` — a scalar, a struct `( f := v, … )`, an array literal;
 *   - `[ (…), (…) ]` with no `:=` — an ARRAY OF a function block, element by element (`decl_bracket_init_no_assign_fb`).
 * A clean scalar init becomes an `Expr`; an aggregate stays an `AggregateInit`. WHICH operator it was is kept: a
 * REFERENCE binds its target with `REF=`, and dropping the operator made that declaration indistinguishable from an
 * assignment to whatever the reference points at.
 */
function parseInitializer(c: Cursor): { init?: Initializer; initOp?: "REF=" | "FB_Init"; refusedInit?: RefusedInit } {
  if (c.peek().kind === "punct" && c.peek().text === "[") {
    const tokens = collectInitTokens(c)
    const refused = refuseBracketElement(c, tokens)
    if (refused !== undefined) return { refusedInit: refused }
    const init = initializerFromTokens(tokens)
    return init === undefined ? {} : { init, initOp: "FB_Init" }
  }
  const assign = c.eatPunct(":=") ?? c.eatPunct("REF=")
  if (assign === undefined) return {}
  const initOp = assign.text === "REF=" ? ("REF=" as const) : undefined
  const op = initOp !== undefined ? { initOp } : {}
  const tokens = collectInitTokens(c)
  // `v : INT := ;` — "Expression expected instead of ';'", and the value is the compiler's placeholder (`decl_init_empty`)
  if (tokens.length === 0) {
    const next = c.peek()
    c.pushError(vendorExpressionExpected(next), next.span)
    return { ...op, refusedInit: { span: next.span, value: { kind: "ident_expr", name: REFUSED_PLACEHOLDER, span: next.span } } }
  }
  const malformed = refuseMalformedInit(c, tokens)
  if (malformed !== undefined) return { ...op, refusedInit: malformed }
  const trailingComma = refuseOperatorTrailingComma(c, tokens)
  if (trailingComma !== undefined) return { ...op, refusedInit: trailingComma }
  const emptyRepeat = refuseEmptyRepeat(c, tokens)
  if (emptyRepeat !== undefined) return { ...op, refusedInit: emptyRepeat }
  const positional = positionalStructInit(c, tokens)
  if (positional !== undefined) return { ...op, ...positional }
  const init = initializerFromTokens(tokens)
  const stray = strayAfterScalarInit(tokens)
  if (stray !== undefined) c.pushError(`';' expected instead of '${stray.text}'`, stray.span)
  return init === undefined ? op : { ...op, init }
}

/** The top-level groups of `tokens` between `[`/`(` and its closer (the outer pair excluded), split at their commas. */
function topLevelGroups(inner: readonly Token[]): Token[][] {
  const groups: Token[][] = [[]]
  let depth = 0
  for (const t of inner) {
    if (t.text === "(" || t.text === "[") depth++
    else if (t.text === ")" || t.text === "]") depth--
    if (depth === 0 && t.text === ",") groups.push([])
    else groups.at(-1)!.push(t)
  }
  return groups
}

/**
 * A `[` straight after the type opens a list of PARENTHESIZED elements — an ARRAY OF a function block's per-element
 * initialization. Any other element is refused at its first token: "'(' expected instead of '1'" (`decl_bracket_init_
 * no_assign`, `_scalar`, `decl_struct_field_bracket_init`, both vendors 2026-10-01; what each vendor says after it is the
 * declaration recovery's, task 2.8.2), and no initializer is kept.
 */
function refuseBracketElement(c: Cursor, tokens: readonly Token[]): RefusedInit | undefined {
  const inner = tokens.at(-1)?.text === "]" ? tokens.slice(1, -1) : tokens.slice(1)
  for (const group of topLevelGroups(inner)) {
    const first = group[0]
    if (first === undefined || first.text === "(") continue
    c.pushError(`'(' expected instead of ${vendorTokenText(first)}`, first.span)
    return { span: first.span }
  }
  return undefined
}

/**
 * A REPEAT COUNT WITH NO VALUE, `[3()]` — "Expression expected instead of ')'" (`decl_repeat_count_empty`, both vendors
 * 2026-10-01), and nothing else: the initializer is gone.
 */
function refuseEmptyRepeat(c: Cursor, tokens: readonly Token[]): RefusedInit | undefined {
  if (tokens[0]?.text !== "[") return undefined
  // the count is a literal that opens an element (`[` or `,` before it) — `F()` is a call with no arguments, not this
  for (let i = 2; i + 1 < tokens.length; i++) {
    if (tokens[i].text !== "(" || tokens[i + 1].text !== ")") continue
    if (!tokens[i - 1].kind.endsWith("_lit") || !["[", ","].includes(tokens[i - 2].text)) continue
    const close = tokens[i + 1]
    c.pushError(vendorExpressionExpected(close), close.span)
    return { span: close.span }
  }
  return undefined
}

/**
 * A PARENTHESIZED LIST WITHOUT FIELD NAMES, `(1, 2)`, is no struct initializer: it is a parenthesized expression `(1`
 * that wants its `)` at the comma, and a declaration that wants its `;` there — "';' expected instead of ','" and "')'
 * expected instead of ','" — after which the compiler keeps the FIRST value as the initializer and type-checks it against
 * the declared type: "Cannot convert type 'SINT' to type 'DUT_…'" (`decl_struct_init_positional_five`, both vendors
 * 2026-10-01). Only that shape — the first element a value, a comma at the top level — is refused so.
 */
function positionalStructInit(c: Cursor, tokens: readonly Token[]): { init?: Initializer; refusedInit?: RefusedInit } | undefined {
  if (tokens[0]?.text !== "(" || tokens.at(-1)?.text !== ")") return undefined
  const groups = topLevelGroups(tokens.slice(1, -1))
  if (groups.length < 2) return undefined
  const first = groups[0]!
  if (first.length === 0 || first[1]?.text === ":=") return undefined
  const comma = tokens[first.length + 1]!
  c.pushError(`';' expected instead of ${vendorTokenText(comma)}`, comma.span)
  c.pushError(`')' expected instead of ${vendorTokenText(comma)}`, comma.span)
  const value = parseExprFromTokens(first)
  return value === undefined ? { refusedInit: { span: comma.span } } : { init: value }
}

/**
 * A VAR SECTION WHERE A STRUCT'S FIELDS BELONG (C0173) — read as the section it is, then refused whole. Two messages, one
 * recording per section keyword (`decl_var_inside_struct`, `decl_<kw>_inside_struct`, both vendors 2026-10-01):
 *
 *   - first, for every keyword but VAR and VAR_EXTERNAL, the section's own placement error — a fact
 *     (`ParseError.sectionInStruct`) the analysis words per vendor: "'VarInput' not allowed in this place", "VAR_TEMP
 *     declaration not allowed in this place", "VAR_GLOBAL declaration only allowed in global variable list" …;
 *   - then the section as the compiler reads it back: "Variable declaration expected instead of VAR\r\n\ta:INT := 5;
 *     \r\nEND_VAR\r\n" — each declaration on its own tab-indented line, the names joined by ", ", `:` tight against the
 *     type, ` := ` around the value (`_init`, `_names`), and NO keyword for VAR_INST and VAR_CONFIG ("… instead of
 *     \r\n\ta:INT;…"). TwinCAT's recording stops at the first line break — its driver's cut, not the compiler's words.
 *
 * VAR_ACCESS and VAR_GENERIC are no section here (`atSectionInStruct`): the field parser refuses them as a name.
 */
export function refuseSectionInStruct(c: Cursor): void {
  const start = c.peek()
  const section = parseVarSection(c)
  if (section === undefined) return
  const kind = section.sectionKind
  const span = joinSpans(start.span, section.span)
  if (kind !== "VAR" && kind !== "VAR_EXTERNAL") c.pushParseError({ message: `${kind} not allowed in a STRUCT`, span: start.span, sectionInStruct: kind })
  // the echo is written by the analysis, which prints types and values (`ParseError.sectionEcho`; parse imports no printer)
  const keyword = kind === "VAR_INST" || kind === "VAR_CONFIG" ? "" : start.text
  c.pushParseError({ message: `Variable declaration expected instead of ${keyword}`, span, sectionEcho: { keyword, decls: section.decls } })
}

/** The section keywords a STRUCT reads as a section to refuse (`refuseSectionInStruct`) — every one but VAR_ACCESS and
 *  VAR_GENERIC, which both vendors refuse there as a field name (`decl_var_access_inside_struct`, `_generic_`). */
export function atSectionInStruct(c: Cursor): boolean {
  return atVarSection(c) && c.peek().keyword !== "VAR_ACCESS" && c.peek().keyword !== "VAR_GENERIC"
}

/**
 * Consume as many consecutive VAR sections as appear at the cursor — a POU's: FB, PROGRAM, FUNCTION, METHOD, after the
 * header, before the body. A VAR_ACCESS section is no POU's: "Unexpected token 'VAR_ACCESS' found" on both vendors
 * (`decl_var_access_in_fb`, 2026-10-01), and the section is skipped to its END_VAR (what each vendor says about the rest
 * of it is the declaration recovery's, task 2.8.2).
 */
export function collectVarSections(c: Cursor): VarSection[] {
  const sections: VarSection[] = []
  while (atVarSection(c)) {
    const kw = c.peek()
    if (kw.keyword === "VAR_ACCESS") {
      c.pushError(`Unexpected token ${vendorTokenText(kw)} found`, kw.span, kw.text)
      c.consume()
      c.recoverTo({ keywords: ["END_VAR"] })
      c.eatKeyword("END_VAR")
      continue
    }
    const s = parseVarSection(c)
    if (s !== undefined) sections.push(s)
    else break
  }
  return sections
}

/** The sections of a file-scope list — a GVL's VAR_GLOBAL, a VAR_CONFIG, a VAR_ACCESS list — each read as it stands. */
export function collectListSections(c: Cursor): VarSection[] {
  const sections: VarSection[] = []
  while (atVarSection(c)) {
    const s = parseVarSection(c)
    if (s !== undefined) sections.push(s)
    else break
  }
  return sections
}
