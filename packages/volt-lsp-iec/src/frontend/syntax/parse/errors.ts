/**
 * THE PARSER'S MESSAGES — every way a token is described in an error, and the errors that are more than one line of
 * text. One home (openspec frontend-conformance design.md §3.2): a parser file that words a token itself is a second
 * copy. Two wordings live here side by side, named apart — the vendors' (`vendorTokenText`) and Volt's own
 * (`plainTokenText`, `typeTokenText`); which one the parser keeps is conformance 2.8.1's to decide.
 */
import type { Span } from "../span.js"
import type { Token } from "../lex/tokens.js"
import type { Keyword } from "../lex/vocabulary.js"

/** What an error needs of the cursor it resyncs — the cursor itself satisfies it. */
export interface ErrorCursor {
  peek(): Token
  consume(): Token
  pushError(message: string, span: Span, unexpectedToken?: string): void
}

/** A token as CODESYS and TwinCAT quote it in a message: bare-quoted (`'x'`, `';'`, `'TO'`), EOF as "end of POU". */
export function vendorTokenText(t: Token): string {
  if (t.kind === "eof") return "end of POU"
  // AS WRITTEN. CODESYS echoes the token exactly as it is typed, asked directly with the same word in four
  // spellings (`echo_*_case_*`, recorded 2026-09-18): `Limit` -> `'Limit'`, `limit` -> `'limit'`, `Lt` -> `'Lt'`,
  // `LT` -> `'LT'`. Printing the canonical keyword made every mention that was not already upper-case disagree on
  // wording alone.
  if (t.kind === "keyword") return `'${t.text}'`
  if (t.kind === "identifier") return `'${t.text}'`
  if (t.kind === "punct") return `'${t.text}'`
  return `'${t.text.length > 20 ? `${t.text.slice(0, 20)}…` : t.text}'`
}

/** A token as the Volt-worded messages describe it ("keyword 'X'", "identifier 'x'", "end of input") — the form no
 *  vendor message uses; conformance 2.8.1 chooses one wording. */
export function plainTokenText(t: Token): string {
  if (t.kind === "eof") return "end of input"
  if (t.kind === "keyword") return `keyword '${t.keyword ?? t.text}'`
  if (t.kind === "identifier") return `identifier '${t.text}'`
  if (t.kind === "punct") return `'${t.text}'`
  return `${t.kind} '${t.text}'`
}

/** A token as the type parser's message names it — a keyword by its canonical spelling. */
function typeTokenText(t: Token): string {
  if (t.kind === "eof") return "end of input"
  if (t.kind === "keyword") return `keyword '${t.keyword ?? t.text}'`
  return `'${t.text}'`
}

/** "expected type, got …" — a type position holding something else. */
export function typeExpected(t: Token): string {
  return `expected type, got ${typeTokenText(t)}`
}

/** "expected expression, got …" — an expression position holding something else. */
export function expressionExpected(t: Token): string {
  return `expected expression, got ${t.kind} '${t.text}'`
}

/**
 * The error for "a name belongs here and this isn't one".
 *
 * A reserved word in name position is CODESYS's **C0009**, not its C0189: `Limit : INT;` — `LIMIT` is a
 * standard FUNCTION, so it is reserved — reports `Unexpected token 'Limit' found`.
 *
 * THE SPELLING IS THE SOURCE'S, not the keyword's. A 2026-09-03 note here recorded this as `'LIMIT'`, and that was
 * wrong: `echo_mixed_case_function_name` and its three siblings asked CODESYS on 2026-09-18 with the same word in
 * four spellings, and it echoed each one back unchanged. Only the keyword case has that evidence; punct/EOF keep the
 * "expected instead of" form.
 */
export function nameExpected(t: Token): string {
  return t.kind === "keyword"
    ? `Unexpected token ${vendorTokenText(t)} found`
    : `identifier expected instead of ${vendorTokenText(t)}`
}

/** The token, when `nameExpected` words it as the "Unexpected token" shape — see `ParseError.unexpectedToken`. */
export function unexpectedTokenOf(t: Token): string | undefined {
  return t.kind === "keyword" ? t.text : undefined
}

/**
 * RESYNC A BROKEN DECLARATION THE WAY THE VENDOR DOES — complaining about every token in the way rather than
 * skipping in silence. For `VAR Limit : INT;`, where `Limit` is a reserved standard-function name, CODESYS says
 *
 *   Unexpected token 'Limit' found         the name — `nameExpected`, already ours
 *   ';' expected instead of ':'            a PAIR for the `:`
 *   Unexpected token ':' found
 *   ';' expected instead of 'INT'          and a pair for the `INT`
 *   Unexpected token 'INT' found
 *
 * which is the same shape the STATEMENT parser already produces for the body half of such a fixture. The
 * declaration half reported the name and recovered quietly — four messages short every time (`cc_il_name_cal`
 * records all ten for a declaration AND a use).
 *
 * Only for a BAD NAME. `x : INT := 5 abc;` is ONE message on CODESYS (`cc_decl_init_trailing_ident`) and keeps the
 * quiet recovery; see the caller.
 */
export function reportBrokenDeclaration(c: ErrorCursor, stop: readonly Keyword[]): void {
  for (;;) {
    const t = c.peek()
    if (t.kind === "eof") return
    if (t.kind === "punct" && t.text === ";") return
    if (t.kind === "keyword" && t.keyword !== undefined && stop.includes(t.keyword)) return
    c.pushError(`';' expected instead of ${vendorTokenText(t)}`, t.span)
    c.pushError(`Unexpected token ${vendorTokenText(t)} found`, t.span, t.text)
    c.consume()
  }
}
