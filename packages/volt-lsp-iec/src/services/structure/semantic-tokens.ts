/**
 * semantic-tokens (Layer E · E.3). Classifies every token for editor coloring. Trivia comments/pragmas
 * and literals classify by lexer kind; identifiers refine by resolving to a symbol (variable vs type vs
 * function vs …). Emitted in the LSP delta-encoded form `[Δline, Δchar, len, typeIdx, modifiers]`.
 *
 * ponytail: identifier classification is by scope NAME lookup (not full chain resolution) — fast and
 * good enough for coloring; a mis-colored deep member is cosmetic, never wrong data.
 */
import type { SemanticTokens, SemanticTokensEdit } from "vscode-languageserver-protocol"
import { lex, type Token, type TokenKind } from "../../syntax/index.js"
import { lookup, resolveBareEnumMember, type Scope, type SymbolKind } from "../../symbols/index.js"
import { isKnownPrimitive } from "../../types/index.js"
import { scopeAtOffset, type Document } from "../shared/index.js"

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
] as const

const TYPE_INDEX = new Map<string, number>(SEMANTIC_TOKEN_TYPES.map((t, i) => [t, i]))

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
  for (const tok of lex(doc.source)) {
    const type = classify(tok, doc, project)
    if (type === undefined) continue
    // Multi-line tokens (block comments) are emitted on their first line only — clients tolerate this.
    out.push({
      line: tok.span.startLine - 1,
      char: tok.span.startCol,
      length: tok.span.end - tok.span.start,
      typeIdx: TYPE_INDEX.get(type) ?? 1,
      start: tok.span.start,
    })
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

function classify(tok: Token, doc: Document, project: Scope): string | undefined {
  const byKind = KIND_TYPE[tok.kind]
  if (byKind !== undefined) return byKind
  if (tok.kind === "keyword") return "keyword"
  if (tok.kind !== "identifier") return undefined
  // Identifier — refine by the symbol it names in scope, else an elementary type name, else a plain variable.
  const scope = scopeAtOffset(doc, project, tok.span.start)
  const sym = lookup(scope, tok.text)?.symbol ?? resolveBareEnumMember(project, tok.text)
  if (sym !== undefined) return SYMBOL_TYPE[sym.kind]
  if (isKnownPrimitive(tok.text)) return "type" // INT/BOOL/… are type names, not variables
  return "variable"
}

const KIND_TYPE: Partial<Record<TokenKind, string>> = {
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

const SYMBOL_TYPE: Record<SymbolKind, string> = {
  function_block: "class",
  program: "class",
  function: "function",
  method: "method",
  action: "method",
  property: "property",
  interface: "interface",
  interface_method: "method",
  interface_property: "property",
  type: "type",
  var: "variable",
  method_param: "parameter",
  struct_field: "property",
  enum_value: "enumMember",
  gvl_var: "variable",
  gvl_block: "namespace",
  namespace: "namespace",
}
