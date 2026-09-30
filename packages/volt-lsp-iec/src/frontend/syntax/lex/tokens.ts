/**
 * IEC 61131-3 Structured Text token model (the vocabulary — which words and symbols exist — is `vocabulary.ts`).
 *
 * Two-level encoding:
 * - `TokenKind` is the broad category the parser switches on
 *   (keyword vs identifier vs operator vs literal vs trivia).
 * - For `Keyword` tokens, `Token.keyword` carries the specific keyword
 *   that was matched. This split keeps the parser's switch tables
 *   manageable — most productions only care about a handful of
 *   keywords — while still letting us distinguish all ~80 ST keywords
 *   without a per-keyword TokenKind variant.
 *
 * Keywords are matched case-insensitively. The lexer preserves the
 * original casing in `Token.text` so error messages can echo what the
 * user wrote.
 */
import type { Span } from "../span.js"
import type { Keyword } from "./vocabulary.js"

/**
 * Broad token categories. The parser dispatches primarily on these.
 */
export type TokenKind =
  | "keyword"
  | "identifier"
  | "int_lit"
  | "real_lit"
  | "string_lit"
  | "wstring_lit"
  | "time_lit"
  | "date_lit"
  | "tod_lit"
  | "datetime_lit"
  | "typed_lit"
  | "address_lit"
  | "punct"
  | "line_comment"
  | "block_comment"
  | "pragma"
  | "whitespace"
  | "eof"
  | "unknown"

/**
 * Which token kinds are trivia (skipped between meaningful tokens).
 * The lexer still emits them so tools that need source fidelity
 * (formatters, refactoring) can see comments and whitespace.
 * The parser filters them out by default.
 */
export function isTrivia(kind: TokenKind): boolean {
  return kind === "line_comment" || kind === "block_comment" || kind === "pragma" || kind === "whitespace"
}

export interface Token {
  kind: TokenKind
  /**
   * For `keyword` tokens, the resolved canonical keyword. Undefined
   * for non-keyword tokens. Use `token.keyword === "FUNCTION_BLOCK"`
   * in the parser — comparing `token.text` would be wrong because
   * the user may have written `function_block` and the lexer
   * preserves the original casing in `text`.
   */
  keyword?: Keyword
  /** Source text, exactly as it appeared in the input. */
  text: string
  /** Source span (start/end byte offsets + line/column for tooling). */
  span: Span
}
