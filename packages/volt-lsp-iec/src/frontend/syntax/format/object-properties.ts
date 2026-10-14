/**
 * THE `%`-LINES — an object's properties as the Volt file format spells them (openspec `bridge-one-to-one` §1.2), read
 * where the push reads them (`StReader.PeelPropertiesUnder` / `PeelPropertiesClosing`, `PropertyLines`) and nowhere else:
 *
 *   - directly under an object's `IMPLEMENTATION` line — a POU's (`peelProperties`, no `%FOLDER`: its folder is its
 *     file's) and a METHOD's or an ACTION's (`%CLASS` first, then its `%FOLDER`, then the rest);
 *   - else closing its declaration — a DUT's and a GVL's (at the end of the file), an interface's (before its first
 *     member), a property's and an interface member's (`closesDeclaration`);
 *   - anywhere else the push refuses the line, and the LSP reports it (`reportMisplacedProperty`).
 *
 * WHAT A PROPERTY LINE IS: `%` and one of the CLOSED keys, the key ending at a space or the line's end — exactly the
 * push's test. Every other line opening with `%` is code (`%QB1 := x;` is a direct address, which the lexer reads as one
 * token anyway; `%class` is code the IDE compiles). One canonical spelling: `%CLASS` first, then a member's `%FOLDER`,
 * then the keys in `PROPERTY_KEYS` order, each once but `%UNDEFINE` / `%NETVAR`; another order, a repeat, a value on a
 * flag or a valued key with none is reported on its line, as the push refuses it (`checkPropertyLines`). The lines are
 * the object's PROPERTIES, not code: the analyzer never sees them, and the formatter prints them back as written.
 *
 * Generalizes the `%FOLDER` directive's former module (deleted): `%FOLDER` is one of the keys.
 */
import type { Span } from "../span.js"
import type { Token } from "../lex/tokens.js"
import type { Keyword } from "../lex/vocabulary.js"
import { joinSpans } from "../span.js"
import { lineAround, type ReportAt } from "./lines.js"

/** The closed key list, in canonical order (`PropertyLines.Keys`). */
const PROPERTY_KEYS = [
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
export type PropertyKey = (typeof PROPERTY_KEYS)[number]

const FLAGS: ReadonlySet<string> = new Set(["EXCLUDE_FROM_BUILD", "LINK_ALWAYS", "EXTERNAL", "ENABLE_SYSTEM_CALL", "PARAMETER_LIST"])
const REPEATING: ReadonlySet<string> = new Set(["UNDEFINE", "NETVAR"])
const CLASS_WORDS: ReadonlySet<string> = new Set(["CHECK", "PERSISTENT", "TEXTLIST_ENUM", "NVL"])

/** The key a whole line opens with when it is a property line as the push reads it (`PropertyLines.KeyOf`), or
 *  undefined: `%` + a closed key ending at a space or the line's end, `%FOLDER` only with a path. */
function propertyKeyOf(line: string): PropertyKey | undefined {
  const t = line.trim()
  if (t.length < 2 || t[0] !== "%") return undefined
  const sp = t.indexOf(" ")
  const key = sp < 0 ? t.slice(1) : t.slice(1, sp)
  if (!(PROPERTY_KEYS as readonly string[]).includes(key)) return undefined
  if (key === "FOLDER" && (sp < 0 || t.slice(sp + 1).trim() === "")) return undefined
  return key as PropertyKey
}

/** A property line as it stands: its text (trimmed), its key when the push reads it as one, and where it is. */
interface PropertyLine {
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
  c.pushError(
    `'${line.text}' is no property the push reads here. A %-line (%CLASS, %FOLDER, %EXCLUDE_FROM_BUILD, …) stands directly ` +
      "under an object's IMPLEMENTATION line, or closing its declaration — a DUT's, a GVL's, an interface's, a property's " +
      "or an interface member's — spelled `%KEY [value]`, alone on its line; anywhere else the push refuses it. Move it " +
      "there, or remove it.",
    line.span,
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
    if (key === "FOLDER" && !folderAllowed) {
      at("%FOLDER stands only in a member's block (directly under its IMPLEMENTATION line, or closing its declaration)")
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
      const words = value.split(" ").filter((w) => w !== "")
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
      const sp = value.indexOf(" ")
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

/**
 * The `%`-lines on the lines DIRECTLY under a body's keyword line — `code` opens with the token holding the newline that
 * ends the keyword line — as their texts and the index of the token that ends the last; or undefined. Exactly where the
 * push peels them (`StReader.PeelPropertiesUnder`) and nowhere else: not after a blank line or a comment, not in another
 * case. `%FOLDER` is peeled only in a member's block (`folderAllowed`); under a POU's own line it is code, as the push
 * reads it. Anywhere the push does not peel a line, it pushes it into the IDE as code — so the LSP leaves it in the body,
 * where the parser reports it.
 */
export function peelProperties(code: readonly Token[], folderAllowed: boolean): { lines: PropertyLine[]; end: number } | undefined {
  const lines: PropertyLine[] = []
  let at = 0
  for (;;) {
    const newline = code[at]
    // Only indentation may follow the line's newline in its token: a second newline is a blank line.
    if (newline?.kind !== "whitespace" || newline.text.slice(newline.text.indexOf("\n") + 1).includes("\n")) break
    if (at + 1 >= code.length || code[at + 1]!.kind === "eof") break
    const { text, end } = lineAround(code, at + 1)
    const key = propertyKeyOf(text)
    if (key === undefined || (key === "FOLDER" && !folderAllowed)) break
    lines.push({ text: text.trim(), key, span: joinSpans(code[at + 1]!.span, code[Math.max(at + 1, end - 1)]!.span) })
    at = end
  }
  return lines.length === 0 ? undefined : { lines, end: at }
}
