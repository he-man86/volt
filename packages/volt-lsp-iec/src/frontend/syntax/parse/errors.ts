/**
 * THE PARSER'S MESSAGES — every way a token is described in an error, and the errors that are more than one line of
 * text. One home (openspec frontend-conformance design.md §3.2): a parser file that words a token itself is a second
 * copy. Two wordings live here side by side, named apart — the vendors' (`vendorTokenText`) and Volt's own
 * (`plainTokenText`, `typeTokenText`); which one the parser keeps is conformance 2.8.1's to decide.
 */
import type { Span } from "../span.js"
import type { Token } from "../lex/tokens.js"
import { SOFT_NAME_KEYWORDS, type Keyword } from "../lex/vocabulary.js"

/** What an error needs of the cursor it resyncs — the cursor itself satisfies it. */
export interface ErrorCursor {
  peek(): Token
  consume(): Token
  pushError(message: string, span: Span, unexpectedToken?: string): void
  markResumed(): void
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
  // a refused PREFIX — a word and its `#`, no operand — is echoed whole like the word it is: 'DUT_LANG_enum_simple#',
  // 21 characters (`lit_enum_typed_*`, TwinCAT 2026-10-01); a literal longer than 20 is cut
  if (t.kind === "typed_lit" && t.text.endsWith("#")) return `'${t.text}'`
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

/** A token that is not a keyword as the type parser's Volt-worded message names it (a keyword gets the vendors' form). */
function typeTokenText(t: Token): string {
  if (t.kind === "eof") return "end of input"
  return `'${t.text}'`
}

/**
 * A type position holding something else. For a KEYWORD it is the vendors' "Type definition expected instead of 'X'",
 * echoed as written — both vendors for `v : Public;` (`lex_soft_keyword_as_type_*`), and TwinCAT for `END_VAR` where the
 * type was missing (`var_non_retain`). Any other token keeps Volt's "expected type, got …" until a
 * recording words it (conformance 2.8.1).
 */
export function typeExpected(t: Token): string {
  if (t.kind === "keyword") return `Type definition expected instead of ${vendorTokenText(t)}`
  return `expected type, got ${typeTokenText(t)}`
}

/**
 * An expression position holding something else. For a KEYWORD it is the vendors' "Expression expected instead of 'X'",
 * echoed as written — `n := cal;`, `n := and;` (`lex_keyword_operand_*`, 2026-09-30, every keyword asked). Any other
 * token keeps Volt's "expected expression, got …" until a recording words it in that position (conformance 2.8.1);
 * `vendorExpressionExpected` is the vendors' form where one has.
 */
export function expressionExpected(t: Token): string {
  if (t.kind === "keyword") return vendorExpressionExpected(t)
  return `expected expression, got ${t.kind} '${t.text}'`
}

/** "Expression expected instead of 'X'" — the vendors' words for any token, used where a recording has them. */
export function vendorExpressionExpected(t: Token): string {
  return `Expression expected instead of ${vendorTokenText(t)}`
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

/**
 * RESYNC A REFUSED STATEMENT THE WAY THE VENDOR DOES — after the word it refused, CODESYS demands a `;` and names every
 * token in its way: `';' expected instead of 'T'`, and `Unexpected token 'T' found` for a token no statement can start
 * with. A token that CAN start one (a name: an identifier, or GET/SET/OVERRIDE) gets the first line only, and the statement
 * parser resumes there (`lex_cascade_meets_soft_name_*`: `limit := set + 1;` says "';' expected instead of 'set'" and
 * nothing more about `set` — its last message, "'(set + 1);' is no valid statement", is the resumed statement's). For
 * `limit := 1;` that is the name, a pair for `:=` and a pair for `1` (`lex_limit_as_variable`); for `CAL t();` it is the
 * word and `';' expected instead of 't'`, after which `t();` is an ordinary call (`lex_cal_keyword`). A keyword refused
 * as an OPERAND resyncs the same way from that word (`n := cal;`, `t(Public := TRUE);` — `lex_keyword_operand_*`,
 * `lex_soft_keyword_named_argument_*`).
 *
 * `stop` names the tokens it ends at in silence — the block keywords a statement list recovers to, where no vendor
 * answer has been recorded. The `;` that ends the refused statement is consumed.
 */
export function reportStatementCascade(c: ErrorCursor, stop: (t: Token) => boolean): void {
  for (;;) {
    const t = c.peek()
    if (t.kind === "eof" || stop(t)) return
    if (t.kind === "punct" && t.text === ";") {
      c.consume()
      return
    }
    c.pushError(`';' expected instead of ${vendorTokenText(t)}`, t.span)
    // the vendor starts a statement at the name — one it warns about as a bare statement whether or not anything
    // declares the name (`cc_time_nanosecond_literal`: "The code 'NS;' has no effect"), so the statement is marked
    if (t.kind === "identifier" || (t.kind === "keyword" && SOFT_NAME_KEYWORDS.has(t.keyword ?? ""))) {
      c.markResumed()
      return
    }
    c.pushError(`Unexpected token ${vendorTokenText(t)} found`, t.span, t.text)
    c.consume()
  }
}
