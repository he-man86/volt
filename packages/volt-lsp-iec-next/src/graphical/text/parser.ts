/**
 * VG parser (Layer F, F.2) — a lean recursive scan of a graphical `BodySpan`'s tokens into networks and
 * statements. The body is already lexed by Layer A; we only impose the VG structure over its tokens.
 *
 * Operands (a sink's lvalue/value, a wire's producer, an EN condition) are parsed into ST `Expr` via the
 * ST expression parser — VG operands ARE fully-parenthesised ST expressions, so the one type engine /
 * resolveMemberChain / nav / hover apply unchanged. EXECUTE boxes hold ordinary ST, parsed as such.
 */
import { parseExprFromTokens, parseStatements, type BodySpan, type Span, type Token } from "../../syntax/index.js"
import type { VgBody, VgLanguage, VgName, VgNetwork, VgStatement, VgDiagnostic } from "./ast.js"

// Uppercased header token → VG language (no cast: the map's values ARE VgLanguage).
const LANGUAGES: Record<string, VgLanguage> = { FBD: "FBD", LD: "LD", CFC: "CFC", SFC: "SFC" }

/** Parse a graphical body's tokens into a VG AST + structural diagnostics. */
export function parseVgBody(body: BodySpan): VgBody {
  const toks = body.tokens.filter((t) => t.kind !== "whitespace" && t.kind !== "pragma")
  const networks: VgNetwork[] = []
  const diagnostics: VgDiagnostic[] = []
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
    diagnostics.push({ code: "VG_PARSE", message: `Expected NETWORK, found '${t.text}'.`, span: t.span })
    i++
  }

  checkDuplicateNetworks(networks, diagnostics)
  return { kind: "vg_body", networks, diagnostics, span: body.span }
}

// ─── networks ────────────────────────────────────────────────────────────────

function parseNetwork(
  toks: Token[],
  start: number,
  diagnostics: VgDiagnostic[],
): { network: VgNetwork; next: number } {
  // header: NETWORK <int> <LANG> [string] [DISABLED]
  let i = start + 1
  const headerStart = toks[start]!.span.start
  let index: number | undefined
  if (toks[i]?.kind === "int_lit") {
    index = Number(toks[i]!.text)
    i++
  }
  let language: VgLanguage = "UNKNOWN"
  const langTok = toks[i]
  const mapped = langTok?.kind === "identifier" ? LANGUAGES[langTok.text.toUpperCase()] : undefined
  if (mapped !== undefined) {
    language = mapped
    i++
  }
  let label: string | undefined
  if (toks[i]?.kind === "string_lit") {
    label = stripQuotes(toks[i]!.text)
    i++
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
      code: "VG_NETWORK_NOT_CLOSED",
      message: `Network ${index ?? ""} is missing END_NETWORK.`.replace("  ", " "),
      span: headerSpan,
    })
  }
  const span = spanFromSpans(toks[start]!.span, endSpan, headerStart, endSpan.end)
  return { network: { index, language, label, disabled, statements, span, headerSpan }, next: i }
}

// ─── statements ────────────────────────────────────────────────────────────────

/** Parse a run of statements until `stopWord` (END_NETWORK / END_IF) or EOF; returns the next index. */
function parseStatementSeq(
  toks: Token[],
  start: number,
  stopWord: string,
  diagnostics: VgDiagnostic[],
  names: Set<string>,
): { statements: VgStatement[]; next: number } {
  const statements: VgStatement[] = []
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
  diagnostics: VgDiagnostic[],
  names: Set<string>,
): { statement: VgStatement | undefined; next: number } {
  const t = toks[start]!
  if (isComment(t)) {
    return { statement: { kind: "comment", text: t.text, span: t.span }, next: start + 1 }
  }
  if (word(t) === "IF") return parseEnEnoIf(toks, start, diagnostics, names)
  if (word(t) === "EXECUTE") return parseExecute(toks, start)
  if (word(t) === "RETURN") {
    return { statement: { kind: "return", span: t.span }, next: skipSemi(toks, start + 1) }
  }
  if (word(t) === "JMP") {
    const target = toks[start + 1]
    const name: VgName =
      target !== undefined ? { text: target.text, span: target.span } : { text: "", span: t.span }
    const span = target ? spanOf([t, target]) : t.span
    return { statement: { kind: "jump", target: name, span }, next: skipSemi(toks, start + (target ? 2 : 1)) }
  }
  // `name:` label — a lone `:` token (not `:=`), no `;` terminator; must be caught before the run scan.
  if (t.kind === "identifier" && toks[start + 1]?.text === ":") {
    const name: VgName = { text: t.text, span: t.span }
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
    const name: VgName = { text: nameTok?.text ?? "", span: nameSpan }
    dedupeName(name, names, diagnostics)
    // ponytail: en-binding by name convention (`en`, `en2`, …) — the VG writer names EN echoes this way.
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
function parseExecute(toks: Token[], start: number): { statement: VgStatement; next: number } {
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

/** `IF <en> THEN <statements> END_IF` — an EN/ENO box; the body is faithful VG (recursively parsed). */
function parseEnEnoIf(
  toks: Token[],
  start: number,
  diagnostics: VgDiagnostic[],
  names: Set<string>,
): { statement: VgStatement; next: number } {
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

function checkDuplicateNetworks(networks: VgNetwork[], diagnostics: VgDiagnostic[]): void {
  const seen = new Set<number>()
  for (const n of networks) {
    if (n.index === undefined) continue
    if (seen.has(n.index)) {
      diagnostics.push({
        code: "VG_DUPLICATE_NETWORK",
        message: `Network index ${n.index} appears more than once.`,
        span: n.headerSpan,
      })
    }
    seen.add(n.index)
  }
}

function dedupeName(name: VgName, names: Set<string>, diagnostics: VgDiagnostic[]): void {
  if (name.text === "") return
  if (names.has(name.text)) {
    diagnostics.push({
      code: "VG_DUPLICATE_NAME",
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
// VG structural words (NETWORK/END_NETWORK/LET/DISABLED) lex as identifiers, IF/RETURN/JMP as keywords —
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
