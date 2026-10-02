/**
 * THE PARSER'S MESSAGES — every way a token is described in an error, and the errors that are more than one line of
 * text. One home (openspec frontend-conformance design.md §3.2): a parser file that words a token itself is a second
 * copy. ONE wording, the vendors' (`vendorTokenText`, frontend-conformance 2.8.1): Volt's own forms — "keyword 'X'",
 * "identifier 'x'", "end of input", "expected expression, got punct ';'", "expected type, got '5'" — are gone, each
 * replaced by the recorded one (`rec_expected_expression*`, `rec_type_expected_literal`, both vendors 2026-10-02).
 */
import type { Span } from "../span.js"
import type { Token } from "../lex/tokens.js"
import { isRefusedDeclaredName, SOFT_NAME_KEYWORDS, UNIT_STARTERS, type Dialect, type Keyword } from "../lex/vocabulary.js"

/** What an error needs of the cursor it resyncs — the cursor itself satisfies it. */
export interface ErrorCursor {
  peek(offset?: number): Token
  consume(): Token
  pushError(message: string, span: Span, unexpectedToken?: string): void
  markResumed(): void
  /** The vocabulary the tokens were lexed with. */
  readonly dialect: Dialect
  /** A word refused where a body's name or operand belongs (`Cursor.refusedWord`, rule R6). */
  refusedWord(t: Token): boolean
}

/**
 * A token as CODESYS and TwinCAT quote it in a message: bare-quoted (`'x'`, `';'`, `'TO'`), the END of the text as `''`.
 * Every recorded "X expected instead of <end>" quotes `''` — "'END_VAR' expected instead of ''", "Expression expected
 * instead of ''", "Type definition expected instead of ''", "'END_REPEAT' expected instead of ''" (`rec_missing_end_repeat`)
 * — but one: the `;`, which both vendors want "instead of end of POU" (146 recorded, `expectedInsteadOf`).
 */
export function vendorTokenText(t: Token): string {
  if (t.kind === "eof") return "''"
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

/**
 * THE END OF THE OBJECT as the IDE holds its text, which both vendors quote as `''`: the end of the text, the next unit's
 * start (a workspace file holds one object; a fixture packs several — a VAR section keyword is no such start, it is the
 * object's own text), or a POU's or an interface's END_* line, which the push strips (`rec_unterminated_var`,
 * `rec_interface_stray`, both vendors 2026-10-02). A DUT's END_TYPE is no such line: its text is written as sent.
 */
export function atObjectEnd(t: Token): boolean {
  return t.kind === "eof" || (t.kind === "keyword" && OBJECT_ENDS.has(t.keyword ?? ""))
}
const OBJECT_ENDS: ReadonlySet<string> = new Set([
  ...UNIT_STARTERS.filter((k) => k !== "VAR_GLOBAL" && k !== "VAR_CONFIG" && k !== "VAR_ACCESS"),
  "END_FUNCTION_BLOCK", "END_PROGRAM", "END_FUNCTION", "END_METHOD", "END_ACTION", "END_PROPERTY", "END_INTERFACE",
])

/** "<expected> expected instead of <t>" — `expected` as the message quotes it (`"';'"`, `"'END_IF'"`, `"',' or ')'"`). The
 *  END of the text is `''` but after the `;`, which both vendors want "instead of end of POU" (`vendorTokenText`). */
export function expectedInsteadOf(expected: string, t: Token): string {
  return `${expected} expected instead of ${expected === "';'" && t.kind === "eof" ? "end of POU" : vendorTokenText(t)}`
}

/**
 * A type position holding something else: "Type definition expected instead of 'X'", echoed as written, for every kind of
 * token — a keyword (`v : Public;`, `lex_soft_keyword_as_type_*`; `v : END_IF;`, `decl_type_keyword`), a punctuation mark
 * (`v : ;`, `decl_type_missing`), a literal (`v : 5;`, `rec_type_expected_literal`, both vendors 2026-10-02), the end of
 * the text (`''`, `pwh_gvl_then_prose` on TwinCAT).
 */
export function typeExpected(t: Token): string {
  return `Type definition expected instead of ${vendorTokenText(t)}`
}

/**
 * An expression position holding something else: "Expression expected instead of 'X'", echoed as written, for every kind
 * of token — a keyword (`n := cal;`, `lex_keyword_operand_*`, every keyword asked; `IF THEN`,
 * `rec_expected_expression_condition`), a punctuation mark (`;` `)` `]` `,` `*` — `rec_expected_expression*`, both vendors
 * 2026-10-02). The END of the text is `expressionAtEnd`'s.
 */
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
 * "expected instead of" form, capitalised as both vendors write it: "Identifier expected instead of ':'"
 * (`decl_names_trailing_comma`, both vendors 2026-10-01; every recorded instance has the capital).
 */
export function nameExpected(t: Token): string {
  return t.kind === "keyword"
    ? `Unexpected token ${vendorTokenText(t)} found`
    : `Identifier expected instead of ${vendorTokenText(t)}`
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
 * A NAME in the way is where the vendor RESUMES a declaration, as the statement cascade resumes a statement: `ld : TON;`
 * is "';' expected instead of 'TON'" and nothing more about it — `TON` is read as the next declaration's name, and that
 * declaration then wants its `,`, AT or `:` (`rec_refused_name_declared_fb_type`, CODESYS 2026-10-02). A refused name
 * (`isRefusedDeclaredName`: `INT`, `bit`) is a token like any other there. "resumed" says the cursor stands at that name.
 *
 * Only for a BAD NAME. `x : INT := 5 abc;` is ONE message on CODESYS (`cc_decl_init_trailing_ident`) and keeps the
 * quiet recovery; see the caller.
 */
export function reportBrokenDeclaration(c: ErrorCursor, stop: readonly Keyword[]): "resumed" | "ended" {
  for (;;) {
    const t = c.peek()
    if (t.kind === "eof") return "ended"
    if (t.kind === "punct" && t.text === ";") return "ended"
    if (t.kind === "keyword" && t.keyword !== undefined && stop.includes(t.keyword)) return "ended"
    c.pushError(`';' expected instead of ${vendorTokenText(t)}`, t.span)
    if (t.kind === "identifier" && !isRefusedDeclaredName(t.text, c.dialect)) return "resumed"
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
 * `lex_soft_keyword_named_argument_*`), and so does a statement that lacks its `;` from the token where it should be
 * (`out := a ** b;`, `n := 1 ! 2;` — `parse/statements` `resyncAfterMissingSemicolon`, frontend-conformance 2.5).
 *
 * `stop` names the tokens it ends at in silence — the block keywords a statement list recovers to, where no vendor
 * answer has been recorded. The `;` that ends the refused statement is consumed.
 */
export function reportStatementCascade(c: ErrorCursor, stop: (t: Token) => boolean): void {
  for (;;) {
    const t = c.peek()
    // the end of the text where the `;` is wanted is that line too: "';' expected instead of end of POU" after a refused
    // closer the body ends with (`rec_end_while_closes_if`, `rec_missing_until`, both vendors 2026-10-02)
    if (t.kind === "eof") {
      c.pushError(expectedInsteadOf("';'", t), t.span)
      return
    }
    if (stop(t)) return
    if (t.kind === "punct" && t.text === ";") {
      c.consume()
      return
    }
    c.pushError(`';' expected instead of ${vendorTokenText(t)}`, t.span)
    // the vendor starts a statement at the name — one it warns about as a bare statement whether or not anything
    // declares the name (`cc_time_nanosecond_literal`: "The code 'NS;' has no effect"), so the statement is marked.
    // A REFUSED WORD is no name there (`rec_refused_name_cascade_il_word`: `st` is paired, rule R6); the GLOBAL-NAMESPACE
    // `.` before a name starts one (`op_sys_varinfo`: `__VARINFO(v).size` ends at the `.`, "The code '.size;' has no
    // effect", both vendors).
    const name = (t.kind === "identifier" && !c.refusedWord(t)) || (t.kind === "keyword" && SOFT_NAME_KEYWORDS.has(t.keyword ?? ""))
    const globalName = t.kind === "punct" && t.text === "." && c.peek(1).kind === "identifier"
    if (name || globalName) {
      c.markResumed()
      return
    }
    c.pushError(`Unexpected token ${vendorTokenText(t)} found`, t.span, t.text)
    c.consume()
  }
}
