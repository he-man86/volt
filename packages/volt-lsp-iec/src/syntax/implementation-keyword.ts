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
 *    always for CFC, SFC and IL, which Volt does not read, and for an LD/FBD body network text cannot represent yet;
 *    never for ST. The body under the line is empty and read by neither parser; the push never writes it, and the
 *    DECLARATION above the line stays editable and is analysed like any other. A bare `IMPLEMENTATION CFC|SFC|IL`
 *    (section 2b's spelling) states no body and is reported naming the line to write.
 *
 * WHY a whole line, and why it matters here: `IMPLEMENTATION ST` is a line an engineer can plausibly write in a
 * comment, and a look-alike after code (`x := IMPLEMENTATION LD;`) is a use of a name. So the boundary is a line holding
 * the keyword and its statement and NOTHING else — not a comment, not a `;` — that starts outside every comment. The
 * lexer already puts comments (nested ones included) in their own tokens, which is how "outside every comment" is
 * decided here without the bridge's line-state scan.
 *
 * WHY the line is taken OUT of the body's tokens: it is not code in any language. The vendors keep a declaration and
 * an implementation apart and the push strips the line, so what remains in `BodySpan.tokens` is exactly the text the
 * IDE holds — which every consumer (the ST parser, the network parser, the recorder's `fixture-units`) then reads with
 * no special case.
 */
import type { BodySpan, ImplementationLine, ImplementationStatement } from "./ast.js"
import { isTrivia, type Token } from "./tokens.js"
import type { Span } from "./span.js"

export const IMPLEMENTATION_KEYWORD = "IMPLEMENTATION"

/** The word after a language that states a body Volt does not show. */
export const UNSUPPORTED_WORD = "UNSUPPORTED"

/** The languages a body's line may state that a parser READS. */
export type ReadLanguage = "ST" | "LD" | "FBD"

// Every line a body can state, alone on its line: the keyword, a language, and UNSUPPORTED — which `statementOf`
// requires after CFC, SFC and IL and refuses after ST. Spacing is layout and the words are case-insensitive, as ST
// keywords are.
const LINE = /^\s*IMPLEMENTATION[ \t]+(ST|LD|FBD|CFC|SFC|IL)(?:[ \t]+(UNSUPPORTED))?\s*$/i

// The SHAPE of the line, whatever it states: the keyword alone, or the keyword and whatever follows it when that opens
// with a word. A line of this shape that is no boundary line — no language, one no body can state, code or a comment
// after the language — is reported NAMING the line, as the push refuses it. Opening with a word keeps
// `IMPLEMENTATION := 1;` out: that names something, and the reserved-name rule answers it.
const SHAPE = /^\s*IMPLEMENTATION(?:[ \t]+([A-Za-z_].*?))?\s*$/i

/** The boundary line of a body Volt reads — what the recorder writes above a fixture's ST. */
export function implementationLine(language: ReadLanguage): string {
  return `${IMPLEMENTATION_KEYWORD} ${language}`
}

/** The three lines a body Volt reads may state, as a refusal lists them. */
const READ_LINES = (["ST", "LD", "FBD"] as const).map(implementationLine).join(", ")

/** The languages Volt never shows a body in: their line always carries UNSUPPORTED. */
const NEVER_SHOWN = new Set(["CFC", "SFC", "IL"])

/** Is this a language Volt never shows a body in (CFC, SFC, IL) — as opposed to LD/FBD, hidden only when network text
 *  cannot represent the body? */
export function isNeverShown(language: string): boolean {
  return NEVER_SHOWN.has(language)
}

/** The line of a body Volt does not show, in its one spelling. */
export function unsupportedLine(language: string): string {
  return `${IMPLEMENTATION_KEYWORD} ${language} ${UNSUPPORTED_WORD}`
}

/** What a line of the keyword's shape states, or undefined for a line of any other shape. */
export function statementOf(line: string): ImplementationStatement | undefined {
  const shape = SHAPE.exec(line)
  if (shape === null) return undefined
  const stated = (shape[1] ?? "").trim()
  if (stated === "") return { kind: "no-language" }
  const m = LINE.exec(line)
  const language = m?.[1]?.toUpperCase()
  const unsupported = m?.[2] !== undefined
  if (language === undefined || (unsupported && language === "ST")) return { kind: "not-a-language", stated }
  if (unsupported) return { kind: "unsupported", language }
  if (NEVER_SHOWN.has(language)) return { kind: "bare-hidden", language }
  return { kind: "read", language: language as ReadLanguage }
}

/** The line in its one spelling when it states something, else as written — as the refusals quote it and the formatter
 *  prints it. */
export function statedLine(line: ImplementationLine): string {
  const s = line.statement
  if (s.kind === "read") return implementationLine(s.language)
  if (s.kind === "unsupported") return unsupportedLine(s.language)
  return line.text
}

// ── the line in a token stream ───────────────────────────────────────────────────────────────────

/** One source line around `tokens[at]`: its text, and the index of the token holding the newline that ends it
 *  (`tokens.length` when the stream ends first). `code` blanks comments and pragmas, as the bridge's `StTrivia.Code`
 *  does, for the network-header test; the keyword's own test reads the raw line, so a comment on it disqualifies it. */
function lineAround(tokens: readonly Token[], at: number, code = false): { text: string; end: number } {
  const piece = (t: Token): string =>
    code && (t.kind === "line_comment" || t.kind === "block_comment" || t.kind === "pragma")
      ? t.text.replace(/[^\n]/g, " ")
      : t.text
  let before = ""
  let k = at - 1
  for (; k >= 0; k--) {
    const text = piece(tokens[k]!)
    const nl = text.lastIndexOf("\n")
    if (nl >= 0) {
      before = text.slice(nl + 1) + before
      break
    }
    before = text + before
  }
  // The stream began mid-line (a body right after `END_VAR` on the same line): the line holds text this stream does
  // not, so it is no whole line. A NUL stands for that text, which no pattern here accepts.
  if (k < 0 && (tokens[0]?.span.startCol ?? 0) > 0) before = "\u0000" + before
  let after = ""
  let end = at
  for (; end < tokens.length; end++) {
    const text = piece(tokens[end]!)
    const nl = text.indexOf("\n")
    if (nl >= 0) {
      after += text.slice(0, nl)
      break
    }
    after += text
  }
  return { text: before + after, end }
}

const isKeywordToken = (t: Token): boolean => t.kind === "identifier" && t.text.toUpperCase() === IMPLEMENTATION_KEYWORD

/** Does `tokens[at]` open a line of the keyword's shape (outside every comment — a comment is its own token)? */
export function opensKeywordLine(tokens: readonly Token[], at: number): boolean {
  return isKeywordToken(tokens[at]!) && SHAPE.test(lineAround(tokens, at).text)
}

const nextSignificant = (tokens: readonly Token[], from: number): number => {
  let i = from
  while (i < tokens.length && isTrivia(tokens[i]!.kind)) i++
  return i
}

/** Where a problem with a body's keyword line is reported, and what it says. */
export type ReportAt = (message: string, span: Span) => void

/** Whose body the splitter is given. A `member` — a METHOD or an ACTION of a POU — is the one body a `%FOLDER`
 *  directive stands under; a POU's own body and a property accessor carry none there (a property's closes its
 *  declaration, which the property parser reads). */
export type BodyOwner = "member" | "pou-or-accessor"

/**
 * A body's tokens, as the unit parsers collect them, split into the line that states it and the code under it.
 *
 * The line is the body's FIRST significant token, when that is the keyword opening a line of its shape: everything
 * before it is trivia, which belongs to the declaration. A member's `%FOLDER` directive stands directly under the
 * line (the bridge writes it there, `StWriter`) and is taken out with it, its path kept on the line — it is folder
 * metadata, not code (`peelFolder` says exactly where). A body that opens with anything else has no line and is returned whole: the
 * parser also reads text that is no workspace file — conformance fixture ST and the library repo, which are the IDE's
 * own body text and carry no line. In a WORKSPACE file such a body states no language: the server reports it naming
 * `volt pull`, as the push refuses it, and reports nothing else in it (`server/diagnostics.ts`), so no language is
 * guessed for it there.
 *
 * Reported, each on its own line, as the push refuses the same file: a line stating no language, or none a body can
 * state; code under an UNSUPPORTED line; a bare CFC, SFC or IL line; network text under `IMPLEMENTATION ST` (never re-read as a network); and a
 * second line of the keyword's shape anywhere in the body.
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
      words: statement.kind === "read" || statement.kind === "unsupported" ? words : [keyword],
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

// The directive as the push reads it (`StReader.FolderOn`): the trimmed line opens with `%FOLDER ` — that case, one
// space — and a path follows.
const FOLDER_LINE = /^\s*%FOLDER (.*\S)\s*$/

/** The folder a whole line states as the push reads it (`StReader.FolderOn`), or undefined — the one spelling of the
 *  directive, for a member's body (`peelFolder`) and a declaration's closing line (`util.readFolderLine`) alike. */
export function folderOn(line: string): string | undefined {
  return FOLDER_LINE.exec(line)?.[1]?.trim()
}

/**
 * The `%FOLDER <path>` directive on the line DIRECTLY under a member's keyword line — `code` opens with the token
 * holding the newline that ends the keyword line — as its path and the index of the token that ends its line; or
 * undefined. Exactly where the push peels it (`StReader.PeelFolderUnder`) and nowhere else: not after a blank line
 * or a comment, not in another case, not without a path. Anywhere the push does not peel it, it pushes the line into
 * the IDE as code — so the LSP must leave it in the body, where the parser reports it, not read a folder the push
 * will not.
 */
function peelFolder(code: readonly Token[]): { path: string; end: number } | undefined {
  const newline = code[0]
  // Only indentation may follow the keyword line's newline in its token: a second newline is a blank line.
  if (newline?.kind !== "whitespace" || newline.text.slice(newline.text.indexOf("\n") + 1).includes("\n")) return undefined
  if (code.length < 2 || code[1]!.kind === "eof") return undefined
  const { text, end } = lineAround(code, 1)
  const path = folderOn(text)
  return path === undefined ? undefined : { path, end }
}

// ── a Volt comment from before the line ──────────────────────────────────────────────────────────

// `(*`, then `@volt-`: the prefix every retired Volt comment carried (`ImplementationMarker.RetiredTag`).
const RETIRED_OPENING = /\(\*\s*@volt-/i

/**
 * Every `(* @volt-… *)` comment, reported naming `volt pull` — as the push refuses a file holding one
 * (`StReader`, `ImplementationMarker.FindRetiredComment`). No Volt writes one any more: the boundary comment
 * `(* @volt-implementation … *)` and the marker `(* @volt-graphical: … *)` both became an `IMPLEMENTATION` line, so
 * a comment of that spelling says the file was pulled by an older Volt. This is no reading of the old form — its
 * body is still read as a body that states no language — only the one sentence that names the repair, where a
 * workspace with no library manifest has no other place to say it.
 *
 * A comment only: the lexer puts a comment in its own token with every comment nested in it, so an opening anywhere in
 * a block comment's text is a comment's; the same characters after `//` or in a string are text.
 */
export function reportRetiredComments(tokens: readonly Token[], report: ReportAt): void {
  for (const t of tokens) {
    if (t.kind !== "block_comment") continue
    const m = RETIRED_OPENING.exec(t.text)
    if (m === null) continue
    const close = t.text.indexOf("*)", m.index + 2)
    const text = (close < 0 ? t.text.slice(m.index) : t.text.slice(m.index, close + 2)).trim()
    report(
      `'${text}' is a comment of a Volt from before bodies were stated by an ${IMPLEMENTATION_KEYWORD} line. Run ` +
        "`volt pull` once to rewrite the workspace in the current format.",
      t.span,
    )
  }
}

/** Is this token a `(* @volt-… *)` comment (`reportRetiredComments`)? */
export function isRetiredComment(t: Token): boolean {
  return t.kind === "block_comment" && RETIRED_OPENING.test(t.text)
}

function checkLine(line: ImplementationLine, code: readonly Token[], report: ReportAt): void {
  const s = line.statement
  // Anything but whitespace is text under the line — a comment and a pragma included. Not `isTrivia`: the push tests
  // the raw text (`StReader.Body`), and since no driver writes a hidden body, a comment there would be silently lost.
  const hasCode = code.some((t) => t.kind !== "whitespace" && t.kind !== "eof")
  if (s.kind === "no-language")
    report(
      `'${line.text}' states no language — a body states its language on that line: ${READ_LINES}. ` +
        `(${IMPLEMENTATION_KEYWORD} is reserved, so if the line names something, rename it.)`,
      line.span,
    )
  else if (s.kind === "not-a-language")
    report(
      `'${line.text}' states '${s.stated}', which is no language a body can state. The line holds the keyword and one ` +
        `of ST, LD or FBD, or — for a body Volt does not show — its language (LD, FBD, CFC, SFC or IL) and ` +
        `${UNSUPPORTED_WORD}, alone. Code goes under the line, and a body in another language is edited in the IDE.`,
      line.span,
    )
  // Section 2b's line for a body Volt does not show; 3b gave every such body one word, so the bare line states no body.
  // Named with the line to write — never read as the hidden body it once meant, as the push refuses it (`StReader`).
  else if (s.kind === "bare-hidden")
    report(
      `'${line.text}' states no body: Volt shows no ${s.language} body, so its line is '${unsupportedLine(s.language)}', ` +
        "with nothing under it. Pull the item again to get it.",
      line.span,
    )
  else if (s.kind === "unsupported" && hasCode)
    report(
      `the body holds code under '${statedLine(line)}'. Volt shows no implementation for that body and never writes it` +
        (NEVER_SHOWN.has(s.language)
          ? ` (Volt does not read the ${s.language} language)`
          : ` (it is ${s.language}, a language network text reads, but this body holds a shape the text cannot represent yet)`) +
        ", so the code has nowhere to go and would be dropped. Remove it, and edit the body in the IDE — the declaration " +
        "above the line is yours to edit here.",
      line.span,
    )
  else if (s.kind === "read" && s.language === "ST" && opensNetwork(code))
    report(
      `the body states '${statedLine(line)}', and its body is network text. State the language it is written in ` +
        `(${implementationLine("LD")} or ${implementationLine("FBD")}), or write the body as ST.`,
      line.span,
    )
}

// `NETWORK` opening a line with a header FIELD after it — the way a network-text body opens and no ST statement can —
// or `NETWORK` alone on its line with an `END_NETWORK` line later, which no ST statement wrapped after a name `network`
// has. The bridge's `NetworkText.OpensNetwork`, the one test a body is held against its stated language by.
const FIELDED_HEADER = /^\s*NETWORK\s+(LABEL\s*:|TITLE\s*:|DISABLED\b|\d)/i
const BARE_HEADER = /^\s*NETWORK\s*$/i
const NETWORK_END = /^\s*END_NETWORK\b/i

function opensNetwork(code: readonly Token[]): boolean {
  const at = nextSignificant(code, 0)
  if (at >= code.length || code[at]!.kind === "eof") return false
  const line = lineAround(code, at, true).text
  if (FIELDED_HEADER.test(line)) return true
  if (!BARE_HEADER.test(line)) return false
  for (let i = at + 1; i < code.length; i++)
    if (code[i]!.kind === "identifier" && code[i]!.text.toUpperCase() === "END_NETWORK" && NETWORK_END.test(lineAround(code, i, true).text))
      return true
  return false
}

// ── what a body is ───────────────────────────────────────────────────────────────────────────────

/**
 * Is LD and FBD network text read at all in this process? ON only when its environment holds `VOLT_GRAPHICAL=1` — the
 * LSP's one switch (openspec `implementation-keyword` 3c), the twin of the bridge's `NetworkTextSwitch`, and the only
 * place in the LSP that reads the variable (a repo gate holds that).
 *
 * WHY: network text is not ready to ship. A production bridge pulls every LD and FBD body as its UNSUPPORTED line; a
 * production editor reads nothing under an `IMPLEMENTATION LD|FBD` line either (one pulled from a development bridge,
 * or written by hand) — no network finding and no refusal, because whether a push accepts it is the BRIDGE's answer,
 * from its own environment, which this process cannot see. Read ONCE: one answer for the server's life. Development
 * turns it on in the editor's environment, and the test suite in `bunfig.toml`.
 */
export const NETWORK_TEXT_ENABLED: boolean = process.env.VOLT_GRAPHICAL === "1"

/** Which parser reads a body: `st`, `network`, or — for a hidden (UNSUPPORTED) body, a line that states no language a
 *  body can have, or an LD/FBD body while network text is off (`NETWORK_TEXT_ENABLED`) — neither. A body with no line is
 *  ST to the PARSER, which also reads fixture ST and the library repo (IDE text, no line); in a workspace file the server
 *  reports it as stating no language and shows none of its findings (see `splitImplementation`). */
export function bodyReader(body: BodySpan): "st" | "network" | undefined {
  const s = body.implementation?.statement
  if (s === undefined) return "st"
  if (s.kind !== "read") return undefined
  if (s.language === "ST") return "st"
  return NETWORK_TEXT_ENABLED ? "network" : undefined
}

/** The words of a body's keyword line an editor colours as keywords (`IMPLEMENTATION`, the language, `UNSUPPORTED`). */
export function implementationWords(body: BodySpan): readonly Token[] {
  return body.implementation?.words ?? []
}

/**
 * `IMPLEMENTATION` is RESERVED: nothing in a file may be named it, in any case — a variable at any scope, a member, the
 * POU, an enum value, a struct member. A name spelled like the line could stand at the start of one and read as it,
 * which is why the push refuses every such name (`StReader.RefuseReservedNames`); this reports the same tokens.
 *
 * Every identifier token spelled like the keyword is a name, EXCEPT one that opens a line of the keyword's shape inside
 * a body (`claimed`): that one is the boundary, or the second line `splitImplementation` already reported by name.
 */
export function reportReservedNames(tokens: readonly Token[], claimed: (t: Token) => boolean, report: ReportAt): void {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (!isKeywordToken(t) || claimed(t)) continue
    report(
      `'${t.text}' is reserved: ${IMPLEMENTATION_KEYWORD} is the line that states where a body starts and what ` +
        "language it is in, so nothing may be named it. Rename it.",
      t.span,
    )
  }
}
