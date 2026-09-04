/**
 * network-text parser (Layer F, F.2) — a lean recursive scan of a graphical `BodySpan`'s tokens into networks and
 * statements. The body is already lexed by Layer A; we only impose the network text structure over its tokens.
 *
 * Operands (a sink's lvalue/value, a wire's producer, an EN condition) are parsed into ST `Expr` via the
 * ST expression parser — network-text operands ARE fully-parenthesised ST expressions, so the one type engine /
 * resolveMemberChain / nav / hover apply unchanged. EXECUTE boxes hold ordinary ST, parsed as such.
 */
import { parseExprFromTokens, parseStatements, type BodySpan, type Span, type Token } from "../../syntax/index.js"
import type { NetworkTextBody, NetworkLanguage, NetworkName, NetworkTextNetwork, NetworkTextStatement, NetworkTextDiagnostic } from "./ast.js"

// Uppercased header token → network text language (no cast: the map's values ARE NetworkLanguage).
const LANGUAGES: Record<string, NetworkLanguage> = { FBD: "FBD", LD: "LD", CFC: "CFC", SFC: "SFC" }

/**
 * The words this parser treats as SYNTAX rather than as names, uppercased.
 *
 * Exported so the editor can colour them: they are keywords of the network-text sublanguage but not of ST, so
 * the lexer hands them back as plain identifiers and semantic tokens would otherwise paint `NETWORK` and
 * `END_NETWORK` the same as a variable. Declared here, beside the code that acts on them, so the colouring
 * cannot list a word the parser does not honour (or miss one it does).
 *
 * `SET`/`RESET` are absent on purpose — they are ST keywords already and colour correctly without help.
 */
export const NETWORK_TEXT_KEYWORDS: ReadonlySet<string> = new Set([
  "NETWORK",
  "END_NETWORK",
  ...Object.keys(LANGUAGES),
  "DISABLED",
  "LET",
  "EXECUTE",
  "END_EXECUTE",
  "JMP",
  "RETURN",
])

/** Parse a graphical body's tokens into a network-text AST + structural diagnostics. */
export function parseNetworkText(body: BodySpan): NetworkTextBody {
  const toks = body.tokens.filter((t) => t.kind !== "whitespace" && t.kind !== "pragma")
  const networks: NetworkTextNetwork[] = []
  const diagnostics: NetworkTextDiagnostic[] = []
  let i = 0

  while (i < toks.length) {
    const t = toks[i]!
    if (isComment(t)) {
      i++
      continue
    }
    if (word(t) === "NETWORK") {
      const parsed = parseNetwork(toks, i, diagnostics)
      networks.push(parsed.network)
      i = parsed.next
      continue
    }
    // Anything outside a network that isn't a NETWORK header / comment is a structural error.
    diagnostics.push({ code: "NETWORK_PARSE", message: `Expected NETWORK, found '${t.text}'.`, span: t.span })
    i++
  }

  checkDuplicateNetworks(networks, diagnostics)
  return { kind: "network_body", networks, diagnostics, span: body.span }
}

// ─── networks ────────────────────────────────────────────────────────────────

function parseNetwork(
  toks: Token[],
  start: number,
  diagnostics: NetworkTextDiagnostic[],
): { network: NetworkTextNetwork; next: number } {
  // header: NETWORK <int> <LANG> [string] [DISABLED]
  let i = start + 1
  const headerStart = toks[start]!.span.start
  let index: number | undefined
  if (toks[i]?.kind === "int_lit") {
    index = Number(toks[i]!.text)
    i++
  }
  let language: NetworkLanguage = "UNKNOWN"
  const langTok = toks[i]
  const mapped = langTok?.kind === "identifier" ? LANGUAGES[langTok.text.toUpperCase()] : undefined
  if (mapped !== undefined) {
    language = mapped
    i++
  }
  let title: string | undefined
  // The header string is the TITLE (the LABEL is a `name:` statement). The bridge writes it DOUBLE-quoted —
  // `NETWORK 1 LD "STATE: Prehoming"` — which IEC lexes as a WSTRING literal, not a STRING one. Accepting only
  // `string_lit` meant a titled network never consumed its title: the token fell through into the statement
  // stream and swallowed the first statement with it, so every `LET` that opened a titled network silently
  // stopped defining its wire and every use of that wire read as undeclared. Both spellings are taken because
  // a hand-written body may use either, and the delimiter is not what the title means.
  const isQuoted = (t: Token | undefined): boolean => t?.kind === "wstring_lit" || t?.kind === "string_lit"
  if (isQuoted(toks[i])) {
    // A quote inside the title is DOUBLED by the writer (`NetworkTextWriter`) — the format's only escape, and
    // not one IEC's lexer knows, so it ends the literal at each quote instead. `"a ""b"""` therefore arrives as
    // three ADJACENT wstring tokens. Contiguity is exactly what doubling produces, so re-joining the adjacent
    // run reconstructs the raw title and reproduces the C# reader's rule — "runs to the first UNDOUBLED quote".
    const first = toks[i]!
    let raw = ""
    while (isQuoted(toks[i]) && (raw === "" || toks[i]!.span.start === toks[i - 1]!.span.end)) {
      raw += toks[i]!.text
      i++
    }
    const quote = first.text[0]!
    title = stripQuotes(raw).split(quote + quote).join(quote)
  }
  let disabled = false
  if (toks[i]?.kind === "identifier" && toks[i]!.text.toUpperCase() === "DISABLED") {
    disabled = true
    i++
  }
  const headerEnd = (toks[i - 1] ?? toks[start])!.span.end
  const headerSpan = spanFromSpans(toks[start]!.span, toks[i - 1]!.span, headerStart, headerEnd)

  // body: statements until END_NETWORK / EOF
  const names = new Set<string>()
  const seq = parseStatementSeq(toks, i, "END_NETWORK", diagnostics, names)
  const statements = seq.statements
  i = seq.next

  let endSpan: Span
  if (i < toks.length && word(toks[i]!) === "END_NETWORK") {
    endSpan = toks[i]!.span
    i++
  } else {
    endSpan = toks[Math.min(i, toks.length) - 1]?.span ?? headerSpan
    diagnostics.push({
      code: "NETWORK_NOT_CLOSED",
      message: `Network ${index ?? ""} is missing END_NETWORK.`.replace("  ", " "),
      span: headerSpan,
    })
  }
  const span = spanFromSpans(toks[start]!.span, endSpan, headerStart, endSpan.end)
  return { network: { index, language, title, disabled, statements, span, headerSpan }, next: i }
}

// ─── statements ────────────────────────────────────────────────────────────────

/** Parse a run of statements until `stopWord` (END_NETWORK / END_IF) or EOF; returns the next index. */
function parseStatementSeq(
  toks: Token[],
  start: number,
  stopWord: string,
  diagnostics: NetworkTextDiagnostic[],
  names: Set<string>,
): { statements: NetworkTextStatement[]; next: number } {
  const statements: NetworkTextStatement[] = []
  let i = start
  while (i < toks.length && word(toks[i]!) !== stopWord) {
    const stmt = parseStatement(toks, i, diagnostics, names)
    if (stmt.statement !== undefined) statements.push(stmt.statement)
    i = stmt.next > i ? stmt.next : i + 1 // guard against non-progress
  }
  return { statements, next: i }
}

function parseStatement(
  toks: Token[],
  start: number,
  diagnostics: NetworkTextDiagnostic[],
  names: Set<string>,
): { statement: NetworkTextStatement | undefined; next: number } {
  const t = toks[start]!
  if (isComment(t)) {
    return { statement: { kind: "comment", text: t.text, span: t.span }, next: start + 1 }
  }
  if (word(t) === "IF") return parseEnEnoIf(toks, start, diagnostics, names)
  // `EXECUTE` opens an inline-ST box — UNLESS it is followed by `(`, which makes it an ordinary call to a POU
  // that happens to be named EXECUTE. Real projects have both: bakon-nano and lenze-mid each materialize
  // `EXECUTE(TRUE);` as a plain box call, and treating that as a block opener made the parser run past
  // `END_NETWORK` hunting for `END_EXECUTE` — reported as NETWORK_NOT_CLOSED on a network that closes fine.
  if (word(t) === "EXECUTE" && toks[start + 1]?.text !== "(") return parseExecute(toks, start)
  if (word(t) === "RETURN") {
    return { statement: { kind: "return", span: t.span }, next: skipSemi(toks, start + 1) }
  }
  if (word(t) === "JMP") {
    const target = toks[start + 1]
    const name: NetworkName =
      target !== undefined ? { text: target.text, span: target.span } : { text: "", span: t.span }
    const span = target ? spanOf([t, target]) : t.span
    return { statement: { kind: "jump", target: name, span }, next: skipSemi(toks, start + (target ? 2 : 1)) }
  }
  // `name:` label — a lone `:` token (not `:=`), no `;` terminator; must be caught before the run scan.
  if (t.kind === "identifier" && toks[start + 1]?.text === ":") {
    const name: NetworkName = { text: t.text, span: t.span }
    dedupeName(name, names, diagnostics)
    return { statement: { kind: "label", name, span: spanOf([t, toks[start + 1]!]) }, next: start + 2 }
  }

  // Collect the run up to the next top-level `;` (or IF / END_NETWORK / EOF).
  const end = runEnd(toks, start)
  const run = toks.slice(start, end).filter((x) => !isComment(x))
  const next = skipSemi(toks, end)
  if (run.length === 0) return { statement: undefined, next }

  const first = run[0]!
  const assignAt = topLevelAssign(run) // depth-0 `:=` only — not a call arg's `IN := on`

  if (word(first) === "LET") {
    const nameTok = run[1]
    const nameSpan = nameTok?.span ?? first.span
    const name: NetworkName = { text: nameTok?.text ?? "", span: nameSpan }
    dedupeName(name, names, diagnostics)
    // ponytail: en-binding by name convention (`en`, `en2`, …) — the network text writer names EN echoes this way.
    const isEnBinding = /^en\d*$/i.test(name.text)
    const producer = assignAt >= 0 ? parseExprFromTokens(run.slice(assignAt + 1)) : undefined
    return { statement: { kind: "wire_def", name, isEnBinding, producer, span: spanOf(run) }, next }
  }
  if (assignAt >= 0) {
    const target = parseExprFromTokens(run.slice(0, assignAt))
    const value = parseExprFromTokens(run.slice(assignAt + 1))
    return { statement: { kind: "sink", target, value, span: spanOf(run) }, next }
  }
  // No `:=` but a call shape `inst(…)` — an FB/function box with no result binding.
  const call = parseExprFromTokens(run)
  if (call?.kind === "call") return { statement: { kind: "fb_call", call, span: spanOf(run) }, next }
  return { statement: { kind: "unknown_stmt", tokens: run, span: spanOf(run) }, next }
}

/** `EXECUTE <inline ST> END_EXECUTE` — the box holds ordinary ST, parsed with the ST statement parser. */
function parseExecute(toks: Token[], start: number): { statement: NetworkTextStatement; next: number } {
  let j = start + 1
  const bodyStart = j
  let depth = 1
  for (; j < toks.length; j++) {
    const w = word(toks[j]!)
    if (w === "EXECUTE") depth++
    else if (w === "END_EXECUTE" && --depth === 0) break
  }
  const inner = toks.slice(bodyStart, j)
  const body: BodySpan = { kind: "body", tokens: inner, span: spanOf(inner.length > 0 ? inner : [toks[start]!]) }
  const parsed = parseStatements(body)
  const endTok = toks[j] // END_EXECUTE (or undefined at EOF)
  if (endTok !== undefined) j++
  const span = spanFromSpans(toks[start]!.span, (endTok ?? toks[start]!).span, toks[start]!.span.start, (endTok ?? toks[start]!).span.end)
  return {
    statement: { kind: "execute", statements: parsed.statements, ok: parsed.ok, span },
    next: skipSemi(toks, j),
  }
}

/** `IF <en> THEN <statements> END_IF` — an EN/ENO box; the body is faithful network text (recursively parsed). */
function parseEnEnoIf(
  toks: Token[],
  start: number,
  diagnostics: NetworkTextDiagnostic[],
  names: Set<string>,
): { statement: NetworkTextStatement; next: number } {
  // condition = tokens between IF and the top-level THEN.
  let i = start + 1
  const condStart = i
  while (i < toks.length && word(toks[i]!) !== "THEN" && word(toks[i]!) !== "END_IF") i++
  const en = parseExprFromTokens(toks.slice(condStart, i))
  if (word(toks[i]!) === "THEN") i++
  const seq = parseStatementSeq(toks, i, "END_IF", diagnostics, names)
  i = seq.next
  let endSpan = toks[start]!.span
  if (word(toks[i] ?? toks[start]!) === "END_IF") {
    endSpan = toks[i]!.span
    i++
  }
  i = skipSemi(toks, i)
  const span = spanFromSpans(toks[start]!.span, endSpan, toks[start]!.span.start, endSpan.end)
  return { statement: { kind: "en_eno_if", en, body: seq.statements, span }, next: i }
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** End index (exclusive) of a statement run: the next top-level `;`, or an IF/END_NETWORK/EOF boundary. */
function runEnd(toks: Token[], start: number): number {
  let depth = 0
  for (let i = start; i < toks.length; i++) {
    const t = toks[i]!
    if (t.text === "(" || t.text === "[") depth++
    else if (t.text === ")" || t.text === "]") depth = Math.max(0, depth - 1)
    else if (depth === 0) {
      if (t.text === ";") return i
      if (i > start && (word(t) === "END_NETWORK" || word(t) === "IF")) return i
    }
  }
  return toks.length
}

function checkDuplicateNetworks(networks: NetworkTextNetwork[], diagnostics: NetworkTextDiagnostic[]): void {
  const seen = new Set<number>()
  for (const n of networks) {
    if (n.index === undefined) continue
    if (seen.has(n.index)) {
      diagnostics.push({
        code: "NETWORK_DUPLICATE_NETWORK",
        message: `Network index ${n.index} appears more than once.`,
        span: n.headerSpan,
      })
    }
    seen.add(n.index)
  }
}

function dedupeName(name: NetworkName, names: Set<string>, diagnostics: NetworkTextDiagnostic[]): void {
  if (name.text === "") return
  if (names.has(name.text)) {
    diagnostics.push({
      code: "NETWORK_DUPLICATE_NAME",
      message: `'${name.text}' is defined more than once in this network.`,
      span: name.span,
    })
  }
  names.add(name.text)
}

/** Index of the first `:=` at paren/bracket depth 0 in a run, else -1. */
function topLevelAssign(run: Token[]): number {
  let depth = 0
  for (let k = 0; k < run.length; k++) {
    const x = run[k]!
    if (x.text === "(" || x.text === "[") depth++
    else if (x.text === ")" || x.text === "]") depth = Math.max(0, depth - 1)
    else if (depth === 0 && x.text === ":=") return k
  }
  return -1
}

const isComment = (t: Token): boolean => t.kind === "line_comment" || t.kind === "block_comment"
// network text structural words (NETWORK/END_NETWORK/LET/DISABLED) lex as identifiers, IF/RETURN/JMP as keywords —
// match all by uppercased text so both are covered uniformly.
const word = (t: Token): string => t.text.toUpperCase()

function skipSemi(toks: Token[], i: number): number {
  return toks[i]?.text === ";" ? i + 1 : i
}

function stripQuotes(s: string): string {
  return s.length >= 2 && (s[0] === "'" || s[0] === '"') ? s.slice(1, -1) : s
}

/** Span covering a non-empty token run. */
function spanOf(run: Token[]): Span {
  const a = run[0]!.span
  const b = run[run.length - 1]!.span
  return { ...a, end: b.end, endLine: b.endLine, endCol: b.endCol }
}

function spanFromSpans(a: Span, b: Span, start: number, end: number): Span {
  return { start, end, startLine: a.startLine, startCol: a.startCol, endLine: b.endLine, endCol: b.endCol }
}
