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
  /**
   * A LITERAL THE VENDOR REFUSES WHOLE — set on a literal token only, where the lexer stopped at a character the
   * literal's grammar does not take: a base other than 2/8/10/16 (`3#`), a typed prefix with no body it can read
   * (`INT#` before `+`, `BOOL#T`), a REAL point with no digit after it (`5.`), a duration component with no unit
   * (`T#1500` before `US`), a WSTRING hex escape of fewer than four digits (`"$41"`). Both vendors answer it as they
   * answer a keyword where an operand belongs — "Expression expected instead of 'X'" — and resync from it; the token's
   * text is how far the vendor lexed, so every message after it is made of the tokens that follow (frontend-conformance
   * 2.2, `lit_*`, `cc_time_*`, `esc_wstring_*`).
   */
  malformed?: true
}
