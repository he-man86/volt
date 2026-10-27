/**
 * THE `%`-LINES — the Volt file format's own lines (openspec `bridge-one-to-one` §1.2, `language-line`), the LSP's one
 * home of their grammar, mirroring the push's `PropertyLines` (`volt-cli/src/Volt.Engine/Format/St/PropertyLines*.cs`):
 *
 *   - a body's `%LANGUAGE` line, the first of the keys: it ends the declaration, starts the body and states its
 *     language (`languageStatementOf`); `format/language-line.ts` splits a body on it;
 *   - an object's properties, read directly under its `%LANGUAGE` line (`property-peel.ts`) — a POU's (no `%FOLDER`: its
 *     folder is its file's) and a METHOD's or an ACTION's (`%CLASS` first, then its `%FOLDER`, then the rest) — else
 *     closing its declaration: a DUT's and a GVL's (at the end of the file), an interface's (before its first member), a
 *     property's, an interface member's (`closesDeclaration`) and a member's with no body slot
 *     (`property-peel.ts` `peelClosingProperties`);
 *   - anywhere else the push refuses the line, and the LSP reports it (`reportMisplacedProperty`).
 *
 * WHAT A PROPERTY LINE IS: `%` and one of the CLOSED keys, the key ending at a space, a tab or the line's end — exactly the
 * push's test. A space or a tab separates every word of the line alike, the key's and the value's (`PropertyLines.KeyEnd`). Every other line opening with `%` is code (`%QB1 := x;` is a direct address, which the lexer reads as one
 * token anyway; `%class` is code the IDE compiles). One canonical spelling: `%LANGUAGE` first, then `%CLASS`, then a
 * member's `%FOLDER`, then the keys in `PROPERTY_KEYS` order, each once but `%UNDEFINE` / `%NETVAR`; another order, a
 * repeat, a value on a flag or a valued key with none is reported on its line, as the push refuses it
 * (`checkPropertyLines`). The lines are not code: the analyzer never sees them, and the formatter prints them back.
 */
import type { LanguageStatement } from "../ast/nodes/index.js"
import type { Span } from "../span.js"
import type { Token } from "../lex/tokens.js"
import type { Keyword } from "../lex/vocabulary.js"
import { joinSpans } from "../span.js"
import type { ReportAt } from "./lines.js"

/** The closed key list, in canonical order (`PropertyLines.Keys`). */
const PROPERTY_KEYS = [
  "LANGUAGE",
  "CLASS",
  "FOLDER",
  "EXCLUDE_FROM_BUILD",
  "LINK_ALWAYS",
  "EXTERNAL",
  "ENABLE_SYSTEM_CALL",
  "ONLINE_CHANGE_RESERVE",
  "COMPILER_DEFINES",
  "UNDEFINE",
  "COMMENT",
  "PARAMETER_LIST",
  "NETVAR",
  "FILE_LINK",
] as const
type PropertyKey = (typeof PROPERTY_KEYS)[number]

const FLAGS: ReadonlySet<string> = new Set(["EXCLUDE_FROM_BUILD", "LINK_ALWAYS", "EXTERNAL", "ENABLE_SYSTEM_CALL", "PARAMETER_LIST"])

// ── the %LANGUAGE line ──────────────────────────────────────────────────────────────────────────

/** The key of a body's line (`PropertyLines.LanguageKey`). */
export const LANGUAGE_KEY = "LANGUAGE"

/** The word after a language that states a body Volt does not show. */
const UNSUPPORTED_WORD = "UNSUPPORTED"

/** The languages a body's line may state that a parser READS. */
type ReadLanguage = "ST" | "LD" | "FBD"

const READ: ReadonlySet<string> = new Set(["ST", "LD", "FBD"])

/** The languages Volt never shows a body in: their line always carries UNSUPPORTED. */
const NEVER_SHOWN: ReadonlySet<string> = new Set(["CFC", "SFC", "IL"])

const LANGUAGE_WORD = /^[A-Za-z_][A-Za-z0-9_]*$/

/** The line of a body Volt reads, in its one spelling — what the recorder writes above a fixture's ST. */
export function languageLine(language: ReadLanguage): string {
  return `%${LANGUAGE_KEY} ${language}`
}

/** The line of a body Volt does not show, in its one spelling. */
function unsupportedLine(language: string): string {
  return `%${LANGUAGE_KEY} ${language} ${UNSUPPORTED_WORD}`
}

/** The line a statement is spelled as — as the refusals quote it and the formatter prints it. */
export function statementLine(s: LanguageStatement): string {
  return s.kind === "read" ? languageLine(s.language) : unsupportedLine(s.language)
}

/** Is `line` a `%LANGUAGE` line — the key, whatever it states (`PropertyLines.IsLanguageLine`)? Such a line is never code
 *  (no IEC direct address opens `%L`), so it is a body's line or it is reported, saying what it lacks. */
export function isLanguageLine(line: string): boolean {
  return propertyKeyOf(line) === LANGUAGE_KEY
}

/** The words after the key, split at spaces and tabs. */
function languageWords(line: string): string[] {
  return line.trim().slice(1 + LANGUAGE_KEY.length).split(/[ \t]+/).filter((w) => w !== "")
}

/** What a `%LANGUAGE` line states, in its one spelling, or undefined for a line that states no body
 *  (`PropertyLines.ParseLanguage`): one language word, any case, then optionally UNSUPPORTED — required after every word
 *  but ST, LD and FBD, refused after ST. */
export function languageStatementOf(line: string): LanguageStatement | undefined {
  if (!isLanguageLine(line)) return undefined
  const words = languageWords(line)
  if (words.length === 0 || words.length > 2) return undefined
  const language = words[0]!.toUpperCase()
  if (!LANGUAGE_WORD.test(language) || language === UNSUPPORTED_WORD) return undefined
  if (words.length === 2)
    return words[1]!.toUpperCase() === UNSUPPORTED_WORD && language !== "ST" ? { kind: "unsupported", language } : undefined
  return READ.has(language) ? { kind: "read", language: language as ReadLanguage } : undefined
}

/** Why a `%LANGUAGE` line states no body, as the push refuses it (`PropertyLines.LanguageLineProblem`) — or undefined
 *  for a line that states one. */
export function languageLineProblem(line: string): string | undefined {
  if (languageStatementOf(line) !== undefined) return undefined
  const words = languageWords(line)
  const readLines = `${languageLine("ST")}, ${languageLine("LD")} or ${languageLine("FBD")}`
  if (words.length === 0) return `it states no language — a body states one: ${readLines}`
  const word = words[0]!.toUpperCase()
  if (words.length === 1 && NEVER_SHOWN.has(word))
    return `Volt shows no ${word} body, so its line is '${unsupportedLine(word)}', with nothing under it. Pull the item again to get it`
  if (words.length === 2 && word === "ST" && words[1]!.toUpperCase() === UNSUPPORTED_WORD)
    return `Volt shows every ST body, so ST is never ${UNSUPPORTED_WORD}: state '${languageLine("ST")}'`
  return (
    `'${words.join(" ")}' is no language a body can state. The line states one of ST, LD or FBD, or — for a body Volt ` +
    `does not show — its language (LD, FBD, CFC, SFC, IL or the IDE's own word) and ${UNSUPPORTED_WORD}. Code goes under ` +
    "the line, and a body in another language is edited in the IDE"
  )
}

/** The line the format no longer reads — `IMPLEMENTATION`, a word, optionally UNSUPPORTED, alone on its line
 *  (`PropertyLines.RetiredLineIn`). */
const RETIRED_LINE = /^\s*IMPLEMENTATION[ \t]+[A-Za-z_][A-Za-z0-9_]*(?:[ \t]+UNSUPPORTED)?\s*$/i

/** Is `line` the retired line? */
export function isRetiredLine(line: string): boolean {
  return RETIRED_LINE.test(line)
}

/** The refusal of the retired line, naming it (`PropertyLines.RetiredLineRefusal`). */
export function retiredLineMessage(what: string, line: string): string {
  return `${what} holds '${line}': \`IMPLEMENTATION\` is no longer read — pull again (it is now \`%${LANGUAGE_KEY} <LANG>\`).`
}
const REPEATING: ReadonlySet<string> = new Set(["UNDEFINE", "NETVAR"])
const CLASS_WORDS: ReadonlySet<string> = new Set(["CHECK", "PERSISTENT", "TEXTLIST_ENUM", "NVL"])

/** The key a whole line opens with when it is a property line as the push reads it (`PropertyLines.KeyOf`), or
 *  undefined: `%` + a closed key ending at a space or the line's end, `%FOLDER` only with a path. */
export function propertyKeyOf(line: string): PropertyKey | undefined {
  const t = line.trim()
  if (t.length < 2 || t[0] !== "%") return undefined
  const sp = t.search(/[ \t]/)
  const key = sp < 0 ? t.slice(1) : t.slice(1, sp)
  if (!(PROPERTY_KEYS as readonly string[]).includes(key)) return undefined
  if (key === "FOLDER" && (sp < 0 || t.slice(sp + 1).trim() === "")) return undefined
  return key as PropertyKey
}

/** A property line as it stands: its text (trimmed), its key when the push reads it as one, and where it is. */
export interface PropertyLine {
  text: string
  key: PropertyKey | undefined
  span: Span
}

/** What reading a property line needs of the parse cursor — the cursor itself satisfies it. */
interface PropertyCursor {
  peek(offset?: number): Token
  consume(): Token
  triviaAhead(): readonly Token[]
  consumeRestOfLine(): Token[]
  pushError(message: string, span: Span): void
}

/**
 * The `%`-line at the cursor, consumed whole, or undefined when the cursor is not at one. Consumed whatever it says —
 * any `%` followed by a word that is a closed key in any case — so a misplaced or misspelled one is reported once
 * (`reportMisplacedProperty`) instead of mis-parsing as strays. `key` is set only for a line the push reads as a property:
 * the key in its case, first on its line (`propertyKeyOf`). Whether it stands where the push reads one is the caller's.
 */
function readPropertyLine(c: PropertyCursor): PropertyLine | undefined {
  const p = c.peek()
  if (p.kind !== "punct" || p.text !== "%") return undefined
  const word = c.peek(1)
  if ((word.kind !== "identifier" && word.kind !== "keyword") || !(PROPERTY_KEYS as readonly string[]).includes(word.text.toUpperCase()))
    return undefined
  const before = c
    .triviaAhead()
    .map((t) => t.text)
    .join("")
  const nl = before.lastIndexOf("\n")
  const opensLine = nl >= 0 ? /^[ \t]*$/.test(before.slice(nl + 1)) : p.span.startCol === 0
  c.consume() // %
  const rest = c.consumeRestOfLine()
  const text = ("%" + rest.map((t) => t.text).join("")).trim()
  const last = rest.at(-1)?.span ?? p.span
  return { text, key: opensLine ? propertyKeyOf(text) : undefined, span: joinSpans(p.span, last) }
}

/** Every `%`-line from the cursor on, one after another. */
export function readPropertyRun(c: PropertyCursor): PropertyLine[] {
  const run: PropertyLine[] = []
  for (let line = readPropertyLine(c); line !== undefined; line = readPropertyLine(c)) run.push(line)
  return run
}

/**
 * Does the declaration the cursor is in close HERE — only whitespace, then one of `closers`? That is where the push
 * peels a declaration's closing `%`-lines (`StReader.PeelPropertiesClosing`: the last lines of the declaration).
 * `blankLinesOnly` is the interface method's stricter reading: a line of spaces between the lines and `END_METHOD` keeps
 * them from being the last. `closers` empty: the end of the file (a DUT's, a GVL's).
 */
function closesDeclaration(c: PropertyCursor, closers: readonly Keyword[], blankLinesOnly: boolean): boolean {
  const trivia = c.triviaAhead()
  if (trivia.some((t) => t.kind !== "whitespace")) return false
  const next = c.peek()
  if (closers.length === 0) return next.kind === "eof"
  if (next.kind !== "keyword" || next.keyword === undefined || !closers.includes(next.keyword)) return false
  if (!blankLinesOnly) return true
  const between = trivia.map((t) => t.text).join("")
  return /^[\r\n]*$/.test(between.slice(0, between.lastIndexOf("\n") + 1))
}

/** The `%`-lines a declaration closes with, as the object's properties: the run read at the cursor, accepted when every
 *  line is a property line and the declaration closes right after it (`closesDeclaration`), checked against the grammar
 *  (`checkPropertyLines`); else every line reported as misplaced. */
export function acceptClosingRun(
  c: PropertyCursor,
  run: readonly PropertyLine[],
  closers: readonly Keyword[],
  blankLinesOnly: boolean,
  folderAllowed: boolean,
): ObjectPropertyLines | undefined {
  if (run.length === 0) return undefined
  if (run.every((l) => l.key !== undefined) && closesDeclaration(c, closers, blankLinesOnly))
    return checkPropertyLines(run, folderAllowed, (message, span) => c.pushError(message, span))
  for (const line of run) reportMisplacedProperty(c, line)
  return undefined
}

/** A `%`-line where the push reads no property: it would reach the IDE as code, so the push refuses it
 *  (`StReader.RefusePropertyLinesIn`) — and the LSP reports it, on the line. */
export function reportMisplacedProperty(c: PropertyCursor, line: PropertyLine): void {
  c.pushError(misplacedPropertyMessage(line), line.span)
}

/** The finding for a `%`-line where the push reads no property (`reportMisplacedProperty`): its text and its key. */
export function misplacedPropertyMessage(line: { text: string; key: string | undefined }): string {
  if (line.key === LANGUAGE_KEY)
    return (
      `'${line.text}' opens a body and states its language, so it stands only where a body starts, and here there is none: ` +
      "the push would write it into the IDE as code. Remove it."
    )
  return (
    `'${line.text}' is no property the push reads here. A %-line (%CLASS, %FOLDER, %EXCLUDE_FROM_BUILD, …) stands directly ` +
    "under an object's %LANGUAGE line, or closing its declaration — a DUT's, a GVL's, an interface's, a property's, an " +
    "interface member's or a member's with no body slot — spelled `%KEY [value]`, alone on its line; anywhere else the " +
    "push refuses it. Move it there, or remove it."
  )
}

/** An object's property lines as read: the member's folder, and the other lines as written, in order. */
interface ObjectPropertyLines {
  folder?: string
  properties: string[]
}

/**
 * The grammar of a run of property lines (`PropertyLines.Read`), each problem reported on its line: the canonical order,
 * one of each key but `%UNDEFINE` / `%NETVAR`, a flag with no value, a valued key with one, and each value's own form
 * (`%CLASS` names a class word — `CHECK` with its check —, a positive reserve, an ST string, `<member>: <value>`,
 * `<type> '<path>'`). `%FOLDER` only where `folderAllowed` (a member's block).
 */
export function checkPropertyLines(run: readonly PropertyLine[], folderAllowed: boolean, report: ReportAt): ObjectPropertyLines {
  const out: ObjectPropertyLines = { properties: [] }
  let last = -1
  let lastKey: string | undefined
  for (const line of run) {
    const key = line.key
    if (key === undefined) continue
    const value = line.text.length > key.length + 1 ? line.text.slice(key.length + 2) : undefined
    const at = (why: string): void => report(`'${line.text}' — ${why}.`, line.span)
    if (key === LANGUAGE_KEY) {
      at("%LANGUAGE opens a body, so it stands only where one starts — never among the lines that close a declaration")
      continue
    }
    if (key === "FOLDER" && !folderAllowed) {
      at("%FOLDER stands only in a member's block (directly under its %LANGUAGE line, or closing its declaration)")
      continue
    }
    const rank = PROPERTY_KEYS.indexOf(key)
    if (rank < last || (rank === last && !REPEATING.has(key))) {
      at(
        rank === last
          ? `%${key} is written twice — each property line stands once (only %UNDEFINE and %NETVAR repeat)`
          : `%${key} stands after '%${lastKey}'. The property lines stand in one order: ${PROPERTY_KEYS.map((k) => "%" + k).join(", ")}`,
      )
      continue
    }
    last = rank
    lastKey = key
    if (FLAGS.has(key)) {
      if (value !== undefined) at(`%${key} is a flag and takes no value — the line alone means true, its absence false`)
    } else if (value === undefined || value.trim() === "") at(`%${key} takes a value`)
    else {
      const problem = valueProblem(key, value)
      if (problem !== undefined) at(problem)
    }
    if (key === "FOLDER") out.folder = value!.trim()
    else out.properties.push(line.text)
  }
  return out
}

/** What is wrong with a property's value, or undefined. */
function valueProblem(key: PropertyKey, value: string): string | undefined {
  switch (key) {
    case "CLASS": {
      const words = value.split(/[ \t]+/).filter((w) => w !== "")
      if (words.length === 0 || !CLASS_WORDS.has(words[0]!)) return `%CLASS names one of ${[...CLASS_WORDS].sort().join(", ")}`
      if (words[0] === "CHECK") return words.length === 2 ? undefined : "%CLASS CHECK names the check it is (`%CLASS CHECK CheckBounds`)"
      return words.length === 1 ? undefined : `%CLASS ${words[0]} takes no argument`
    }
    case "ONLINE_CHANGE_RESERVE":
      return /^[0-9]+$/.test(value) && Number(value) > 0 ? undefined : "%ONLINE_CHANGE_RESERVE takes a positive whole number of bytes (its absence is 0)"
    case "COMPILER_DEFINES":
    case "COMMENT":
      return stStringProblem(value, `%${key}`, true)
    case "UNDEFINE":
      return stStringProblem(value, "%UNDEFINE", false)
    case "NETVAR": {
      const sep = value.indexOf(": ")
      return sep > 0 && /^[A-Za-z0-9_.]+$/.test(value.slice(0, sep)) ? undefined : "%NETVAR reads `%NETVAR <member>: <value>`"
    }
    case "FILE_LINK": {
      const sp = value.search(/[ \t]/)
      return sp > 0 ? stStringProblem(value.slice(sp + 1), "%FILE_LINK", true) : "%FILE_LINK reads `%FILE_LINK <link type> '<path>'`"
    }
    default:
      return undefined
  }
}

/** An ST STRING literal, alone: `'…'` with its `$`-escapes; empty only where `nonEmpty` is false. */
function stStringProblem(value: string, named: string, nonEmpty: boolean): string | undefined {
  const v = value.trim()
  if (v.length < 2 || !v.startsWith("'") || !v.endsWith("'")) return `${named} takes an ST string, '…' ($' for a quote, $$ for a dollar)`
  const inner = v.slice(1, -1)
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!
    if (ch === "'") return `${named}: a quote inside the string is written $'`
    if (ch !== "$") continue
    const e = inner[i + 1]
    if (e === undefined) return `${named}: a $ at the end of the string escapes nothing`
    if ("'$NnLlRrTtPp".includes(e)) {
      i++
      continue
    }
    if (/^[0-9A-Fa-f]{2}$/.test(inner.slice(i + 1, i + 3))) {
      i += 2
      continue
    }
    return `${named}: '$${e}' is no ST string escape`
  }
  return nonEmpty && inner.length === 0 ? `${named} with an empty string is its absence — remove the line` : undefined
}
