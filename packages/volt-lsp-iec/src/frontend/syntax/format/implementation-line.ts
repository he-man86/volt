/**
 * `IMPLEMENTATION <LANG>` — the line that ends a body's declaration and states what the body is (openspec
 * `implementation-keyword`). The LSP's ONE home of the spelling, mirroring the bridge's `ImplementationMarker`
 * (`volt-cli/src/Volt.Engine/Format/St/ImplementationMarker.cs`): the two runtimes cannot share code, so they share
 * the rule — the same two line patterns, the same languages, the same whole-line reading — and this module is the
 * only place the LSP writes any of it down. The body splitter, the network-text parser, semantic tokens, folding, the
 * diagnostics, the hover and the conformance recorder all ask here.
 *
 * What a line can state:
 *  - `IMPLEMENTATION ST`, `IMPLEMENTATION LD`, `IMPLEMENTATION FBD` — a body Volt reads: ST by the ST parser, LD/FBD by
 *    the network-text parser. The stated language is the ONE signal for which; nothing sniffs the text.
 *  - `IMPLEMENTATION <LANG> UNSUPPORTED` — a body Volt does not SHOW (owner decisions 2026-09-28, sections 2b and 3b):
 *    always for CFC, SFC and IL, which Volt does not read, for a language Volt has never seen under the vendor's own
 *    name (`IMPLEMENTATION NWL UNSUPPORTED` — D27), and for an LD/FBD body network text cannot represent yet;
 *    never for ST. The body under the line is empty and read by neither parser; the push never writes it, and the
 *    DECLARATION above the line stays editable and is analysed like any other.
 *
 * WHY a whole line, and why it matters here: `IMPLEMENTATION ST` is a line an engineer can plausibly write in a
 * comment, and a look-alike after code (`x := IMPLEMENTATION LD;`) is a use of a name. So the boundary is a line holding
 * the keyword and its statement and NOTHING else — not a comment, not a `;` — that starts outside every comment.
 * A line is the boundary only when it IS one, by that grammar alone (openspec `bridge-refusal-review` D9, the bridge's
 * `ImplementationMarker.Is`): `Implementation` alone, `Implementation OR b` in a wrapped expression, a bare
 * `IMPLEMENTATION CFC` or `IMPLEMENTATION SST` are code. Such a line is named in one place only — as the hint of the
 * finding for a body that states no language (`lookalikeLine`, the push's `StReader.Unmarked`). The
 * lexer already puts comments (nested ones included) in their own tokens, which is how "outside every comment" is
 * decided here without the bridge's line-state scan.
 *
 * WHY the line is taken OUT of the body's tokens: it is not code in any language. The vendors keep a declaration and
 * an implementation apart and the push strips the line, so what remains in `BodySpan.tokens` is exactly the text the
 * IDE holds — which every consumer (the ST parser, the network parser, the recorder's `fixture-units`) then reads with
 * no special case.
 */
import type { BodySpan, ImplementationLine, ImplementationStatement } from "../ast/nodes.js"
import { isTrivia, type Token } from "../lex/tokens.js"
import { joinSpans, type Span } from "../span.js"
import type { Dialect } from "../lex/vocabulary.js"
import { peelFolder } from "./folder.js"
import { lineAround, nextSignificant, type ReportAt } from "./lines.js"

export const IMPLEMENTATION_KEYWORD = "IMPLEMENTATION"

/** The word after a language that states a body Volt does not show. */
const UNSUPPORTED_WORD = "UNSUPPORTED"

/** The languages a body's line may state that a parser READS. */
export type ReadLanguage = "ST" | "LD" | "FBD"

// Every line a body can state, alone on its line: the keyword, a language, and UNSUPPORTED — which `statementOf`
// requires after CFC, SFC, IL and every other word and refuses after ST. The language is a WORD: one of the six Volt
// knows, or the vendor's own name for one Volt has never seen (D27, openspec bridge-refusal-review 4.27), which a driver
// pulls as a hidden body rather than losing the whole item. Spacing is layout and the words are case-insensitive, as ST
// keywords are.
const LINE = /^\s*IMPLEMENTATION[ \t]+([A-Za-z_][A-Za-z0-9_]*)(?:[ \t]+(UNSUPPORTED))?\s*$/i

// The SHAPE of the line, whatever it states: the keyword alone, or the keyword and whatever follows it when that opens
// with a word. Read for a HINT and nothing else (`lookalikeLine`): a line of this shape that is no boundary line is code
// wherever a boundary line was found, and named only where a body states no language (openspec bridge-refusal-review
// D9). It used to make every such line a boundary candidate, reported wherever it stood.
const SHAPE = /^\s*IMPLEMENTATION(?:[ \t]+([A-Za-z_].*?))?\s*$/i

/** The boundary line of a body Volt reads — what the recorder writes above a fixture's ST. */
export function implementationLine(language: ReadLanguage): string {
  return `${IMPLEMENTATION_KEYWORD} ${language}`
}

/** The three lines a body Volt reads may state, as a refusal lists them. */
const READ_LINES = (["ST", "LD", "FBD"] as const).map(implementationLine).join(", ")

/** The languages Volt never shows a body in: their line always carries UNSUPPORTED. */
const NEVER_SHOWN = new Set(["CFC", "SFC", "IL"])

/** The six languages Volt knows. Any other word is a language only as a hidden body: `IMPLEMENTATION UML UNSUPPORTED`. */
const KNOWN = new Set(["ST", "LD", "FBD", ...NEVER_SHOWN])

/** Is this a language Volt never shows a body in (CFC, SFC, IL) — as opposed to LD/FBD, hidden only when network text
 *  cannot represent the body? */
export function isNeverShown(language: string): boolean {
  return NEVER_SHOWN.has(language)
}

/** The line of a body Volt does not show, in its one spelling. */
function unsupportedLine(language: string): string {
  return `${IMPLEMENTATION_KEYWORD} ${language} ${UNSUPPORTED_WORD}`
}

/** What a boundary line states, or undefined for a line that is none — the grammar alone (the bridge's
 *  `ImplementationMarker.Parse`): the keyword, a language and optionally UNSUPPORTED, which a language Volt reads (ST, LD,
 *  FBD) states bare and every other word states with UNSUPPORTED, and ST never does. */
function statementOf(line: string): ImplementationStatement | undefined {
  const m = LINE.exec(line)
  if (m === null) return undefined
  const language = m[1].toUpperCase()
  const unsupported = m[2] !== undefined
  if (language === UNSUPPORTED_WORD) return undefined
  if (unsupported) return language === "ST" ? undefined : { kind: "unsupported", language }
  if (!KNOWN.has(language) || NEVER_SHOWN.has(language)) return undefined
  return { kind: "read", language: language as ReadLanguage }
}

/**
 * The first line in `tokens` that LOOKS like a body's line and is none — the keyword's shape (`SHAPE`) outside every
 * comment, stating no language or one no body can state — with what it lacks, or undefined. The HINT of the finding for
 * a body that states no language, as the push's refusal of the same file names it (`StReader.Unmarked`, openspec
 * `bridge-refusal-review` D9). Read nowhere else.
 */
export function lookalikeLine(tokens: readonly Token[]): { text: string; lacks: string } | undefined {
  for (let i = 0; i < tokens.length; i++) {
    if (!isImplementationKeyword(tokens[i])) continue
    const { text } = lineAround(tokens, i)
    const shape = SHAPE.exec(text)
    if (shape === null || statementOf(text) !== undefined) continue
    return { text: text.trim(), lacks: lacksOf((shape[1] ?? "").trim()) }
  }
  return undefined
}

/** What a line of the keyword's shape that is no boundary line lacks, by what it states — the push's `StReader.Lacks`. */
function lacksOf(stated: string): string {
  if (stated === "") return `which states no language — a body states its language on that line: ${READ_LINES}.`
  // Section 2b's line for a body Volt does not show; 3b gave every such body one word, so the bare line states no body.
  const word = stated.toUpperCase()
  if (NEVER_SHOWN.has(word))
    return `but Volt shows no ${word} body, so its line is '${unsupportedLine(word)}', with nothing under it. Pull the item again to get it.`
  return (
    `and '${stated}' is no language a body can state. The line holds the keyword and one of ST, LD or FBD, or — for a ` +
    `body Volt does not show — its language (LD, FBD, CFC, SFC or IL) and ${UNSUPPORTED_WORD}, alone. Code goes under ` +
    "the line, and a body in another language is edited in the IDE."
  )
}

/** The line in its one spelling — as the refusals quote it and the formatter prints it. */
export function statedLine(line: ImplementationLine): string {
  const s = line.statement
  return s.kind === "read" ? implementationLine(s.language) : unsupportedLine(s.language)
}

/** Is `t` the word `IMPLEMENTATION` (an identifier to the lexer, in any case)? */
export const isImplementationKeyword = (t: Token): boolean => t.kind === "identifier" && t.text.toUpperCase() === IMPLEMENTATION_KEYWORD

/** Does `tokens[at]` open a boundary line — the grammar alone, outside every comment (a comment is its own token)? */
export function opensKeywordLine(tokens: readonly Token[], at: number): boolean {
  return isImplementationKeyword(tokens[at]!) && statementOf(lineAround(tokens, at).text) !== undefined
}

/** Whose body the splitter is given. A `member` — a METHOD or an ACTION of a POU — is the one body a `%FOLDER`
 *  directive stands under; a POU's own body and a property accessor carry none there (a property's closes its
 *  declaration, which the property parser reads). */
export type BodyOwner = "member" | "pou-or-accessor"

/**
 * A body's tokens, as the unit parsers collect them, split into the line that states it and the code under it.
 *
 * The line is the body's FIRST significant token, when that is the keyword opening a boundary line: everything
 * before it is trivia, which belongs to the declaration. A member's `%FOLDER` directive stands directly under the
 * line (the bridge writes it there, `StWriter`) and is taken out with it, its path kept on the line — it is folder
 * metadata, not code (`peelFolder` says exactly where). A body that opens with anything else has no line and is returned whole: the
 * parser also reads text that is no workspace file — conformance fixture ST and the library repo, which are the IDE's
 * own body text and carry no line. In a WORKSPACE file such a body states no language: the server reports it naming
 * `volt pull`, as the push refuses it, and reports nothing else in it (`server/diagnostics.ts`), so no language is
 * guessed for it there.
 *
 * Reported, each on its own line, as the push refuses the same file: code under an UNSUPPORTED line, and a second
 * boundary line anywhere in the body. A line that only looks like one is code (D9). Network text under
 * `IMPLEMENTATION ST` is NOT reported here: the push writes it as sent (openspec bridge-refusal-review 1.1), and the
 * build reads it as the ST it is stated to be — the ST parser answers it, as the build does (`rcc_st_body_network`).
 */
export function splitImplementation(
  tokens: Token[],
  owner: BodyOwner,
  report: ReportAt,
): { tokens: Token[]; implementation?: ImplementationLine } {
  const first = nextSignificant(tokens, 0)
  const opens = first < tokens.length && opensKeywordLine(tokens, first)
  let code = tokens
  let implementation: ImplementationLine | undefined
  if (opens) {
    const keyword = tokens[first]!
    const { text, end } = lineAround(tokens, first)
    const words = tokens.slice(first, end).filter((t) => !isTrivia(t.kind))
    const last = words[words.length - 1]!
    const statement = statementOf(text)!
    implementation = {
      text: text.trim(),
      statement,
      span: { ...keyword.span, end: last.span.end, endLine: last.span.endLine, endCol: last.span.endCol },
      words,
    }
    // What stands above the line is the declaration's (comments, pragmas) — kept, or the formatter deletes it.
    const leading = tokens
      .slice(0, first)
      .map((t) => t.text)
      .join("")
      .trim()
    if (leading !== "") implementation.leading = leading
    code = tokens.slice(end)
    if (owner === "member") {
      const folder = peelFolder(code)
      if (folder !== undefined) {
        implementation.folder = folder.path
        code = code.slice(folder.end)
      }
    }
    checkLine(implementation, code, report)
  }
  for (let i = 0; i < code.length; i++)
    if (opensKeywordLine(code, i))
      report(
        `${implementation === undefined ? "an" : "a second"} ${IMPLEMENTATION_KEYWORD} line inside a body: ` +
          `'${lineAround(code, i).text.trim()}'. A body states its language once, on the line that opens it.`,
        code[i]!.span,
      )
  return implementation === undefined ? { tokens: code } : { tokens: code, implementation }
}

function checkLine(line: ImplementationLine, code: readonly Token[], report: ReportAt): void {
  const s = line.statement
  // Anything but whitespace is text under the line — a comment and a pragma included. Not `isTrivia`: the push tests
  // the raw text (`StReader.Body`), and since no driver writes a hidden body, a comment there would be silently lost.
  const hasCode = code.some((t) => t.kind !== "whitespace" && t.kind !== "eof")
  if (s.kind === "unsupported" && hasCode)
    report(
      `the body holds code under '${statedLine(line)}'. Volt shows no implementation for that body and never writes it` +
        (NEVER_SHOWN.has(s.language)
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

/** Which parser reads a body: `st`, `network`, or — for a hidden (UNSUPPORTED) body, or an LD/FBD body parsed with
 *  network text off (`ParseOptions.networkText`) — neither. A body with no
 *  line is ST to the PARSER, which also reads fixture ST and the library repo (IDE text, no line); in a workspace file
 *  the server reports it as stating no language and shows none of its findings (see `splitImplementation`). */
export function bodyReader(body: BodySpan): "st" | "network" | undefined {
  const s = body.implementation?.statement
  if (s === undefined) return "st"
  if (s.kind !== "read") return undefined
  if (s.language === "ST") return "st"
  return NO_NETWORK_TEXT.has(body) ? undefined : "network"
}

/** The words of a body's keyword line an editor colours as keywords (`IMPLEMENTATION`, the language, `UNSUPPORTED`). */
export function implementationWords(body: BodySpan): readonly Token[] {
  return body.implementation?.words ?? []
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
 * A POU body from the tokens a unit parser collected: its `IMPLEMENTATION <LANG>` line taken out and recorded, the
 * code left as the body (`splitImplementation`), and every problem with the line reported through `report` (the parse cursor's errors) — the
 * one place a POU body is built, so no unit kind can skip the line.
 */
export function codeBody(report: ReportAt, tokens: Token[], fallback: Span, owner: BodyOwner, dialect: Dialect): BodySpan {
  const { tokens: code, implementation } = splitImplementation(tokens, owner, report)
  const body = bodySpanFromTokens(code, fallback, dialect)
  return implementation === undefined ? body : { ...body, implementation }
}
