/**
 * A BODY'S `%LANGUAGE` LINE — where its declaration ends, where its body starts, and what language the body is in
 * (openspec `language-line`). The line's grammar is `object-properties.ts`'s (`%LANGUAGE` is the first of the `%`-line
 * keys, mirroring the bridge's `PropertyLines`); this module splits a body on it. The body splitter, the network-text
 * parser, semantic tokens, folding, the diagnostics, the hover and the conformance recorder all ask here.
 *
 * What a body states:
 *  - `%LANGUAGE ST`, `%LANGUAGE LD`, `%LANGUAGE FBD` — a body Volt reads: ST by the ST parser, LD/FBD by the network-text
 *    parser. The stated language is the ONE signal for which; nothing sniffs the text.
 *  - `%LANGUAGE <LANG> UNSUPPORTED` — a body Volt does not SHOW: always for CFC, SFC and IL, for a language Volt has never
 *    seen under the vendor's own name, and for an LD/FBD body network text cannot represent yet; never for ST. The body
 *    under the line is empty and read by neither parser; the DECLARATION above the line stays editable.
 *  - no line, and nothing after the declaration — a METHOD or a property's GET/SET whose IDE object has no body slot
 *    (`BodySpan.noSlot`). A POU's own body and an action's always state a line.
 *
 * WHERE THE LINE STANDS: wherever it is, as the push reads it — a `%` at the start of its line, the key, its value. What
 * stands above it is the DECLARATION's, whatever it is — the push writes it there as sent, and it is kept (`leading`),
 * never read as the body's. A `%`-line there is reported as misplaced, as the push refuses it; other text the declaration
 * parser did not take (a `;` after `END_VAR`, a statement) is the build's to judge, unrecorded, and draws nothing here
 * (niche: accepted loss, 0 occurrences in the corpora). A `%LANGUAGE` line is never
 * code, and the lexer puts every comment in its own token, so a `%` token is never inside one.
 *
 * WHY the line is taken OUT of the body's tokens: it is not code in any language. The vendors keep a declaration and an
 * implementation apart and the push strips the line, so what remains in `BodySpan.tokens` is exactly the text the IDE
 * holds — which every consumer (the ST parser, the network parser, the recorder's `fixture-units`) then reads with no
 * special case.
 */
import type { BodySpan, LanguageLine, TopLevel } from "../ast/nodes/index.js"
import { isTrivia, type Token } from "../lex/tokens.js"
import { joinSpans, type Span } from "../span.js"
import type { Dialect } from "../lex/vocabulary.js"
import {
  checkPropertyLines,
  isLanguageLine,
  isRetiredLine,
  LANGUAGE_KEY,
  languageLineProblem,
  languageStatementOf,
  misplacedPropertyMessage,
  propertyKeyOf,
  statementLine,
} from "./object-properties.js"
import { peelClosingProperties, peelProperties } from "./property-peel.js"
import { lineAround, type ReportAt } from "./lines.js"

/** The line in its one spelling — as the refusals quote it and the formatter prints it; one that states no body, as
 *  written. */
export function statedLine(line: LanguageLine): string {
  return line.statement === undefined ? line.text : statementLine(line.statement)
}

/** Does `tokens[at]` open a `%LANGUAGE` line — a `%` first on its line, the key, whatever it states? */
export function opensLanguageLine(tokens: readonly Token[], at: number): boolean {
  const t = tokens[at]!
  return t.kind === "punct" && t.text === "%" && isLanguageLine(lineAround(tokens, at).text)
}

/**
 * The first line of `tokens` the format no longer reads — `IMPLEMENTATION`, a word, optionally `UNSUPPORTED`, alone on
 * its line, outside every comment — or undefined: the hint of the finding for a body that states no line, as the push
 * refuses the same file (`PropertyLines.RetiredLineIn`).
 */
export function retiredLine(tokens: readonly Token[]): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.kind !== "identifier" || t.text.toUpperCase() !== "IMPLEMENTATION") continue
    const { text } = lineAround(tokens, i)
    if (isRetiredLine(text)) return text.trim()
  }
  return undefined
}

/** Whose body the splitter is given — which `%`-lines stand directly under its line (`object-properties.ts`). A `member`
 *  (a METHOD or an ACTION of a POU) carries its properties there, `%FOLDER` included; a `pou`'s own body carries its
 *  properties but no `%FOLDER` (its folder is its file's); an `accessor` carries none (its property's close the
 *  property's declaration, which the property parser reads). */
export type BodyOwner = "member" | "pou" | "accessor"

/**
 * A body's tokens, as the unit parsers collect them, split at its `%LANGUAGE` line into what stands above it (the
 * declaration's, `LanguageLine.leading`), the line, the object's `%`-lines under it (peeled where the push peels them,
 * their grammar reported as the push refuses it: `peelProperties`, `checkPropertyLines`), and the code under them.
 *
 * Reported, each on its own line, as the push refuses the same file: a line that states no body, code under an
 * UNSUPPORTED line, and a second `%LANGUAGE` line anywhere in the body.
 *
 * With NO line, the body is returned whole: the parser also reads text that is no workspace file — conformance fixture ST
 * and the library repo, which are the IDE's own body text and carry no line. In a WORKSPACE file such a body is a member
 * with no body slot when it may be one (`markSlotless`), and otherwise states no language: the server reports it
 * (`analysis/checks/syntax/missing-language.ts`), and reports nothing else in it.
 */
function splitLanguage(tokens: Token[], owner: BodyOwner, report: ReportAt): { tokens: Token[]; languageLine?: LanguageLine } {
  const at = tokens.findIndex((_, i) => opensLanguageLine(tokens, i))
  if (at < 0) return { tokens }

  const { text, end } = lineAround(tokens, at)
  const words = tokens.slice(at, end).filter((t) => !isTrivia(t.kind))
  const last = words[words.length - 1]!
  const lineSpan = { ...tokens[at]!.span, end: last.span.end, endLine: last.span.endLine, endCol: last.span.endCol }
  const statement = languageStatementOf(text)
  // A %LANGUAGE line that states no body is still the body's line (it is never code): reported by name, saying what it
  // lacks, and the body under it is read by neither parser.
  if (statement === undefined) report(`the body states '${text.trim()}': ${languageLineProblem(text)}.`, lineSpan)
  const languageLine: LanguageLine = { text: text.trim(), span: lineSpan, words }
  if (statement !== undefined) languageLine.statement = statement
  // What stands above the line is the declaration's (comments, pragmas, text the declaration parser did not take) —
  // kept, or the formatter deletes it.
  const leading = tokens
    .slice(0, at)
    .map((t) => t.text)
    .join("")
    .trim()
  if (leading !== "") languageLine.leading = leading
  // A %-line there is the push's refusal of a property line in a declaration (`StReader.RefusePropertyLinesIn`): reported
  // as every misplaced one is, on its line. Any OTHER text there (`END_VAR;`'s `;`, a statement) the push accepts and
  // writes into the IDE's declaration as sent, so what is said about it is the build's — and what the build says is not
  // recorded: the LSP reports nothing on it rather than an answer no recording backs (niche: accepted loss, 0
  // occurrences in the corpora).
  for (let i = 0; i < at; i++) {
    const t = tokens[i]!
    if (t.kind !== "punct" || t.text !== "%") continue
    const { text: lineText, end: lineEnd } = lineAround(tokens, i)
    const key = propertyKeyOf(lineText)
    if (key === undefined) continue
    const words = tokens.slice(i, Math.min(lineEnd, at)).filter((w) => !isTrivia(w.kind) && w.kind !== "eof")
    report(misplacedPropertyMessage({ text: lineText.trim(), key }), joinSpans(words[0]!.span, words[words.length - 1]!.span))
    i = lineEnd
  }
  let code = tokens.slice(end)
  if (owner !== "accessor") {
    const peeled = peelProperties(code, owner === "member")
    if (peeled !== undefined) {
      const { folder, properties } = checkPropertyLines(peeled.lines, owner === "member", report)
      if (folder !== undefined) languageLine.folder = folder
      if (properties.length > 0) languageLine.objectProperties = properties
      code = code.slice(peeled.end)
    }
  }
  checkLine(languageLine, code, report)
  for (let i = 0; i < code.length; i++)
    if (opensLanguageLine(code, i))
      report(
        `a second %${LANGUAGE_KEY} line inside a body: '${lineAround(code, i).text.trim()}'. A body states its language once, ` +
          "on the line that opens it.",
        code[i]!.span,
      )
  return { tokens: code, languageLine }
}

/**
 * THE MEMBERS WITH NO BODY SLOT of a WORKSPACE file's units (openspec `language-line`, DIALECT C2n): a METHOD's or a
 * property accessor's body with no `%LANGUAGE` line that holds nothing but trivia — under, for a METHOD, the `%`-lines
 * closing its declaration (`peelClosingProperties`, their grammar reported as the push refuses it) — is marked `noSlot`,
 * and those lines taken out of its tokens. Asked of a workspace file only: in the IDE's own text (a fixture, the library
 * repo) no body states a line, and an empty one is an empty ST body.
 *
 * ONLY WHERE THE PUSH CAN TAKE ONE (`BodyFormatGuard`): a member with no slot is a CODESYS ABSTRACT METHOD, or an accessor
 * of a CODESYS ABSTRACT PROPERTY (DIALECT C2n). TwinCAT has no slotless member — its abstract members have a slot — and a
 * no-line member that is not ABSTRACT is refused by the push whether it creates it ("only an abstract method is created
 * without one") or updates it (the IDE's member has a slot: "the line was lost"). Such a body states no language, and is
 * reported as one.
 */
export function markSlotless(unit: TopLevel, dialect: Dialect, report: ReportAt): void {
  if (dialect !== "codesys") return
  if (unit.kind === "method" && unit.modifiers.includes("ABSTRACT")) slotless(unit.body, true, report)
  if (unit.kind === "property" && unit.modifiers.includes("ABSTRACT"))
    for (const a of [unit.getter, unit.setter]) if (a !== undefined) slotless(a.body, false, report)
}

function slotless(body: BodySpan, closing: boolean, report: ReportAt): void {
  if (body.languageLine !== undefined) return
  const peeled = closing ? peelClosingProperties(body.tokens, true) : undefined
  const rest = peeled === undefined ? body.tokens : body.tokens.slice(0, peeled.start)
  if (rest.some((t) => !isTrivia(t.kind) && t.kind !== "eof")) return
  const noSlot: NonNullable<BodySpan["noSlot"]> = {}
  if (peeled !== undefined) {
    const { folder, properties } = checkPropertyLines(peeled.lines, true, report)
    if (folder !== undefined) noSlot.folder = folder
    if (properties.length > 0) noSlot.objectProperties = properties
  }
  body.tokens = rest
  body.noSlot = noSlot
}

function checkLine(line: LanguageLine, code: readonly Token[], report: ReportAt): void {
  const s = line.statement
  if (s === undefined) return
  // Anything but whitespace is text under the line — a comment and a pragma included. Not `isTrivia`: the push tests
  // the raw text (`StReader.Body`), and since no driver writes a hidden body, a comment there would be silently lost.
  const hasCode = code.some((t) => t.kind !== "whitespace" && t.kind !== "eof")
  if (s.kind === "unsupported" && hasCode)
    report(
      `the body holds code under '${statedLine(line)}'. Volt shows no implementation for that body and never writes it` +
        (["CFC", "SFC", "IL"].includes(s.language)
          ? ` (Volt does not read the ${s.language} language)`
          : ` (it is ${s.language}, a language network text reads, but this body holds a shape the text cannot represent yet)`) +
        ", so the code has nowhere to go and would be dropped. Remove it, and edit the body in the IDE — the declaration " +
        "above the line is yours to edit here.",
      line.span,
    )
}

// ── what a body is ───────────────────────────────────────────────────────────────────────────────

/**
 * The bodies a parse read with network text OFF (`ParseOptions.networkText`), by identity: the parse's decision, not the
 * text's, so it is no field of the tree. A body is marked where the parse finishes (`parser.ts`).
 */
const NO_NETWORK_TEXT = new WeakSet<BodySpan>()

/** Mark a body as parsed with network text off: an LD/FBD body under it is read by neither parser. */
export function readNoNetworkText(body: BodySpan): void {
  NO_NETWORK_TEXT.add(body)
}

/** Which parser reads a body: `st`, or — for a hidden (UNSUPPORTED) body, or an LD/FBD body parsed with network text
 *  off (`ParseOptions.networkText`) — none. A body with no line is ST to the PARSER, which also reads fixture ST and the
 *  library repo (IDE text, no line); a member with no slot holds nothing to read, and in a workspace file any other body
 *  with no line is reported as stating no language, with none of its findings shown. An LD/FBD body is network text,
 *  which is ST with `%` lines (`network/plain-st.ts`): the ST parser reads it. */
export function bodyReader(body: BodySpan): "st" | undefined {
  if (body.languageLine === undefined) return "st"
  const s = body.languageLine.statement
  if (s === undefined) return undefined
  if (s.kind !== "read") return undefined
  if (s.language !== "ST" && NO_NETWORK_TEXT.has(body)) return undefined
  return "st"
}

/** The words of a body's `%LANGUAGE` line an editor colours as keywords (`%`, `LANGUAGE`, the language, `UNSUPPORTED`). */
export function languageLineWords(body: BodySpan): readonly Token[] {
  return body.languageLine?.words ?? []
}

// ── the body a unit parser collected ─────────────────────────────────────────────────────────────

/**
 * Build a BodySpan from a list of tokens. Falls back to `fallback`
 * span if the list is empty.
 */
export function bodySpanFromTokens(tokens: Token[], fallback: Span, dialect: Dialect): BodySpan {
  if (tokens.length === 0) {
    return { kind: "body", tokens, span: fallback, dialect }
  }
  const first = tokens[0]
  const last = tokens[tokens.length - 1]
  return { kind: "body", tokens, span: joinSpans(first.span, last.span), dialect }
}

/**
 * A POU body from the tokens a unit parser collected: its `%LANGUAGE` line taken out and recorded, the code left as the
 * body (`splitLanguage`), and every problem with the line reported through `report` (the parse cursor's errors) — the one
 * place a POU body is built, so no unit kind can skip the line.
 */
export function codeBody(report: ReportAt, tokens: Token[], fallback: Span, owner: BodyOwner, dialect: Dialect): BodySpan {
  const { tokens: code, languageLine } = splitLanguage(tokens, owner, report)
  const body = bodySpanFromTokens(code, fallback, dialect)
  return languageLine === undefined ? body : { ...body, languageLine }
}
