/**
 * semantic-tokens (Layer E · E.3). Classifies every token for editor coloring. Trivia comments/pragmas
 * and literals classify by lexer kind; identifiers refine by resolving to a symbol (variable vs type vs
 * function vs …). Emitted in the LSP delta-encoded form `[Δline, Δchar, len, typeIdx, modifiers]`.
 *
 * ponytail: identifier classification is by scope NAME lookup (not full chain resolution) — fast and
 * good enough for coloring; a mis-colored deep member is cosmetic, never wrong data.
 */
import type { SemanticTokens, SemanticTokensEdit } from "vscode-languageserver-protocol"
import {
  allUnits,
  isPlainStNetworkBody,
  languageLineWords,
  plainStText,
  type Token,
  type TokenKind,
  type TopLevel,
  unitBodies,
} from "../../frontend/syntax/index.js"
import { bareEnumMember, dialectOf, lookup, type Scope } from "../../frontend/symbols/index.js"
import { isKnownPrimitive } from "../../frontend/types/index.js"
import { scopeAtOffset, SYMBOL_KINDS } from "../shared/index.js"
import type { Document } from "../shared/index.js"

/** The token-type legend (index = the `typeIdx` emitted). Advertised to the client in server capabilities. */
export const SEMANTIC_TOKEN_TYPES = [
  "keyword",
  "variable",
  "parameter",
  "property",
  "function",
  "method",
  "class",
  "interface",
  "struct",
  "enum",
  "enumMember",
  "type",
  "number",
  "string",
  "comment",
  "macro",
  "namespace",
  // A network-text wire — a name a network's `VAR_TEMP` line declares. Its own class so an editor can tell it from a variable the POU
  // declares; volt-vscode declares it with `variable` as its super type, so a theme that knows nothing of it still
  // paints it as a variable. LAST, so every other type keeps its index.
  "wire",
] as const

type TokenType = (typeof SEMANTIC_TOKEN_TYPES)[number]
const TYPE_INDEX = new Map<TokenType, number>(SEMANTIC_TOKEN_TYPES.map((t, i) => [t, i]))

/** One classified token in absolute coordinates — the shared substrate for full / range / delta. */
interface TokenRecord {
  line: number
  char: number
  length: number
  typeIdx: number
  start: number // byte offset of the token (for range filtering)
}

/** Every classified token of a document, in order, absolute-positioned. */
function tokenRecords(doc: Document, project: Scope): TokenRecord[] {
  const out: TokenRecord[] = []
  const stated = languageLineWordStarts(doc.parseResult.units)
  for (const tok of doc.parseResult.tokens) {
    const type = stated.has(tok.span.start) ? "keyword" : classify(tok, doc, project)
    if (type === undefined) continue
    // One record per LINE of the token: LSP allows a multi-line token only to a client stating `multilineTokenSupport`,
    // which this server does not ask (a block comment was coloured on its first line alone).
    let start = tok.span.start
    let char = tok.span.startCol
    for (const [i, part] of doc.source.slice(tok.span.start, tok.span.end).split("\n").entries()) {
      const length = part.endsWith("\r") ? part.length - 1 : part.length
      if (length > 0) out.push({ line: tok.span.startLine - 1 + i, char, length, typeIdx: TYPE_INDEX.get(type)!, start })
      start += part.length + 1
      char = 0
    }
  }
  return out
}

/** LSP delta-encode a token-record list into the flat `[Δline, Δchar, len, typeIdx, mods]×n` stream. */
function encode(records: readonly TokenRecord[]): number[] {
  const data: number[] = []
  let prevLine = 0
  let prevChar = 0
  for (const r of records) {
    const deltaLine = r.line - prevLine
    const deltaChar = deltaLine === 0 ? r.char - prevChar : r.char
    data.push(deltaLine, deltaChar, r.length, r.typeIdx, 0)
    prevLine = r.line
    prevChar = r.char
  }
  return data
}

/** The full delta-encoded token stream (no `resultId` — the server assigns one for delta tracking). */
export function semanticTokensData(doc: Document, project: Scope): number[] {
  return encode(tokenRecords(doc, project))
}

/** Full semantic tokens for a document. */
export function semanticTokens(doc: Document, project: Scope): SemanticTokens {
  return { data: semanticTokensData(doc, project) }
}

/** Tokens whose start falls within `[startOffset, endOffset)` — the viewport a `range` request asks for. */
export function semanticTokensRange(
  doc: Document,
  project: Scope,
  startOffset: number,
  endOffset: number,
): SemanticTokens {
  const records = tokenRecords(doc, project).filter((r) => r.start >= startOffset && r.start < endOffset)
  return { data: encode(records) }
}

/** The single edit that turns `prev` into `next` (common-prefix/suffix diff) — the body of a delta response. */
export function diffSemanticTokens(prev: readonly number[], next: readonly number[]): SemanticTokensEdit[] {
  const min = Math.min(prev.length, next.length)
  let p = 0
  while (p < min && prev[p] === next[p]) p++
  let s = 0
  while (s < min - p && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++
  if (p === prev.length && p === next.length) return [] // identical
  return [{ start: p, deleteCount: prev.length - p - s, data: next.slice(p, next.length - s) }]
}

function classify(tok: Token, doc: Document, project: Scope): TokenType | undefined {
  const byKind = KIND_TYPE[tok.kind]
  if (byKind !== undefined) return byKind
  if (tok.kind === "keyword") return "keyword"
  if (tok.kind !== "identifier") return undefined
  // Identifier — refine by the symbol it names in scope, else an elementary type name, else a plain variable.
  const scope = scopeAtOffset(doc, project, tok.span.start)
  const sym = lookup(scope, tok.text)?.symbol ?? bareEnumMember(scope, tok.text)
  if (sym !== undefined) return sym.wire !== undefined ? "wire" : SYMBOL_KINDS[sym.kind].token
  if (isKnownPrimitive(tok.text, dialectOf(project))) return "type" // INT/BOOL/… are type names where the dialect has them
  return "variable"
}

/**
 * Where the words of every body's `%LANGUAGE <LANG>` line start — `%`, `LANGUAGE`, the language, `UNSUPPORTED` — and
 * the `%` and key of each `%` line of a network body (`%NETWORK`, `%DISABLED`, …). They are syntax of a Volt file, not ST:
 * the lexer hands them back as identifiers, and a lookup would paint them as variables. Read off the parse, so only a
 * line the reader took is coloured — never a look-alike in a comment, or a variable someone named `ST`.
 */
function languageLineWordStarts(units: readonly TopLevel[]): Set<number> {
  const at = new Set<number>()
  for (const unit of allUnits(units))
    for (const body of unitBodies(unit)) {
      for (const w of languageLineWords(body)) at.add(w.span.start)
      if (isPlainStNetworkBody(body))
        for (const n of plainStText(body).networks) for (const l of n.lines) at.add(l.span.start).add(l.span.start + 1)
    }
  return at
}

const KIND_TYPE: Partial<Record<TokenKind, TokenType>> = {
  int_lit: "number",
  real_lit: "number",
  time_lit: "number",
  date_lit: "number",
  tod_lit: "number",
  datetime_lit: "number",
  typed_lit: "number",
  address_lit: "number",
  string_lit: "string",
  wstring_lit: "string",
  line_comment: "comment",
  block_comment: "comment",
  pragma: "macro",
}
