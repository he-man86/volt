/**
 * semantic-tokens (Layer E · E.3). Classifies every token for editor coloring. Trivia comments/pragmas
 * and literals classify by lexer kind; identifiers refine by resolving to a symbol (variable vs type vs
 * function vs …). Emitted in the LSP delta-encoded form `[Δline, Δchar, len, typeIdx, modifiers]`.
 *
 * ponytail: identifier classification is by scope NAME lookup (not full chain resolution) — fast and
 * good enough for coloring; a mis-colored deep member is cosmetic, never wrong data.
 */
import type { SemanticTokens } from "vscode-languageserver-protocol"
import { lex, type Token, type TokenKind } from "../../syntax/index.js"
import { lookup, resolveBareEnumMember, type Scope, type SymbolKind } from "../../symbols/index.js"
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

export function semanticTokens(doc: Document, project: Scope): SemanticTokens {
  const data: number[] = []
  let prevLine = 0
  let prevChar = 0

  for (const tok of lex(doc.source)) {
    const type = classify(tok, doc, project)
    if (type === undefined) continue
    // Multi-line tokens (block comments) are emitted on their first line only — clients tolerate this.
    const line = tok.span.startLine - 1
    const char = tok.span.startCol
    const length = tok.span.end - tok.span.start
    const deltaLine = line - prevLine
    const deltaChar = deltaLine === 0 ? char - prevChar : char
    data.push(deltaLine, deltaChar, length, TYPE_INDEX.get(type) ?? 1, 0)
    prevLine = line
    prevChar = char
  }
  return { data }
}

function classify(tok: Token, doc: Document, project: Scope): string | undefined {
  const byKind = KIND_TYPE[tok.kind]
  if (byKind !== undefined) return byKind
  if (tok.kind === "keyword") return "keyword"
  if (tok.kind !== "identifier") return undefined
  // Identifier — refine by the symbol it names in scope (else a plain variable).
  const scope = scopeAtOffset(doc, project, tok.span.start)
  const sym = lookup(scope, tok.text)?.symbol ?? resolveBareEnumMember(project, tok.text)
  return sym !== undefined ? SYMBOL_TYPE[sym.kind] : "variable"
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
