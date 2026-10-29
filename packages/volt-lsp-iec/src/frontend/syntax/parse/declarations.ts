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
import { type VarDecl, type VarSection, type VarSectionKind } from "../ast/nodes/index.js"
import { Cursor } from "./cursor.js"
import { VAR_SECTION_KEYWORDS } from "../lex/word-sets.js"
import type { Dialect } from "../lex/vocabulary.js"
import { joinSpans } from "../span.js"
import { reportBrokenDeclaration, vendorTokenText } from "./errors.js"
import { parseVarDecl, type DeclList } from "./var-decl.js"

const VAR_LIST = (sectionKind: VarSectionKind, fileScope: boolean, dialect: Dialect): DeclList => ({
  ends: ["END_VAR"],
  global: sectionKind === "VAR_GLOBAL",
  access: sectionKind === "VAR_ACCESS",
  // a configuration LIST (a file-scope `VAR_CONFIG`): one in a POU or a STRUCT is refused as misplaced, its names not asked
  config: fileScope && sectionKind === "VAR_CONFIG",
  // a global list's and a VAR_EXTERNAL's path is CODESYS's alone: TwinCAT refuses its `.` (`dp_gvl_dotted`,
  // `dp_var_external_dotted`, both vendors 2026-10-29); a configuration list takes one on both
  paths:
    sectionKind === "VAR_CONFIG" ? "words" : (sectionKind === "VAR_GLOBAL" || sectionKind === "VAR_EXTERNAL") && dialect === "codesys" ? "identifiers" : "none",
})

/** A STRUCT's or UNION's field list. */
export const FIELD_LIST: DeclList = { ends: ["END_STRUCT", "END_UNION"], global: false, access: false, config: false, paths: "none" }

/**
 * A VAR section left without its END_VAR: "'END_VAR' expected instead of ''" — the vendor reads the section on to the
 * end of the declaration part, whatever ends the list here: its `%LANGUAGE` line, a unit's own closer (which the IDE
 * never receives), the end of the text (`rec_unterminated_var`), the next VAR section (`rec_unterminated_var_before_section`,
 * where each vendor first reads that section back as a STRUCT does a section in its fields: "Variable declaration
 * expected instead of VAR_INPUT\r\n\tk:INT;\r\nEND_VAR\r\n" — `refuseSectionInStruct`'s echo, TwinCAT's recording cut at
 * the first line break; both vendors 2026-10-02). The token is left for the caller, which reads that section as its own:
 * neither vendor calls its names undefined.
 */
function unclosedSection(c: Cursor): void {
  const next = c.peek()
  if (atVarSection(c)) {
    // read on a fork: the echo needs the section's declarations, and the unit still declares them
    const section = parseVarSection(c.fork())
    if (section !== undefined) {
      const keyword = section.sectionKind === "VAR_INST" || section.sectionKind === "VAR_CONFIG" ? "" : next.text
      c.pushParseError({ message: `Variable declaration expected instead of ${keyword}`, span: next.span, sectionEcho: { keyword, decls: section.decls } })
    }
  }
  c.pushError("'END_VAR' expected instead of ''", next.span)
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
export function parseVarSection(c: Cursor, fileScope = false): VarSection | undefined {
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

  const list = VAR_LIST(sectionKind, fileScope, c.dialect)
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
    // …and so does the `%LANGUAGE` line: the declaration part ends there, as the IDE receives it
    if (c.atDeclListEnd() || c.opensLanguageLine()) break
    if (!parseDeclInto(c, list, section.decls)) break
  }
  unclosedSection(c)
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
    // the cascade stopped at a NAME: the next declaration starts there (`reportBrokenDeclaration`)
    if (reportBrokenDeclaration(c, list.ends) === "resumed") return true
  }
  if (!c.recoverTo({ keywords: list.ends, puncts: [";"] })) return false
  c.eatPunct(";") // consume the ';' anchor if that's what we landed on
  return true
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
    const s = parseVarSection(c, true)
    if (s !== undefined) sections.push(s)
    else break
  }
  return sections
}
