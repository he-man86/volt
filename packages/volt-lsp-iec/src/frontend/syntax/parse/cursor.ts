/**
 * Token cursor for the parser.
 *
 * - Skips trivia (whitespace, comments, pragmas) automatically before
 *   every meaningful consumption. Trivia stays in the underlying
 *   token array so source-fidelity tools can still find it.
 * - Errors are collected, not thrown. A parser that doesn't find what
 *   it expects records an error and attempts to recover.
 * - Provides convenience eaters for keyword, punct, identifier — the
 *   three things parsers check most.
 */
import { isTrivia, type Token } from "../lex/tokens.js"
import type { Span } from "../span.js"
import type { ParseError } from "../ast/nodes.js"
import { opensKeywordLine } from "../format/implementation-line.js"
import { DECL_LIST_ENDERS, isRefusedDeclaredName, isRefusedWord, SOFT_NAME_KEYWORDS, UNIT_NAME_KEYWORDS, type Dialect, type Keyword } from "../lex/vocabulary.js"
import { expectedInsteadOf, nameExpected, unexpectedTokenOf, vendorTokenText } from "./errors.js"

export class Cursor {
  private pos = 0
  private readonly errors: ParseError[] = []

  /**
   * `dialect` — the vocabulary the tokens were lexed with, where a grammar rule differs by vendor (a type's `FB<…>` is
   * CODESYS's alone). A contained sub-cursor over an expression or a statement list asks no such rule and is given none;
   * one that does is refused by name (`dialect`), never read as CODESYS by default.
   */
  constructor(
    private readonly tokens: readonly Token[],
    private readonly vocabulary?: Dialect,
    /** Whether the tokens are a BODY's statements — where a refused word is refused as a name and an operand
     *  (`refusedWord`). A declaration's initializer and a contained expression are no body. */
    private readonly body = false,
  ) {}

  /** Is `t` a word refused where a name or an operand of a body belongs — an IL operator, an elementary type's name
   *  (`syntax/lex/vocabulary.ts` `isRefusedWord`, rule R6)? Only in a body; the other places a refused word is refused
   *  ask the vocabulary themselves — a declared name, a STRUCT/UNION field's included (`expectName`,
   *  `rec_refused_word_struct_field*`), and an initializer's operand (`initializer` `refuseMalformedInit`,
   *  `rec_refused_word_initializer*`), both vendors 2026-10-02. */
  refusedWord(t: Token): boolean {
    return this.body && t.kind === "identifier" && isRefusedWord(t.text, this.dialect)
  }

  /** The dialect the tokens were lexed with — thrown for, by name, on a cursor that was given none. */
  get dialect(): Dialect {
    if (this.vocabulary === undefined)
      throw new Error("Cursor.dialect: this cursor was made without the dialect its tokens were lexed with — pass it to `new Cursor`")
    return this.vocabulary
  }

  private readonly failedDeclarations: string[] = []

  getErrors(): ParseError[] {
    return this.errors
  }

  /** The names a declaration could not declare — see `ParseResult.failedDeclarations` for why they are kept. */
  getFailedDeclarations(): string[] {
    return this.failedDeclarations
  }

  /** Record that a declaration failed on this token, so the semantic pass stays quiet about the name. */
  declarationFailed(t: Token): void {
    this.failedDeclarations.push(t.text.toLowerCase())
  }

  /** Where a keyword was refused as an operand (`refuseOperand`), if the parse has not moved since. */
  private refusedOperandAt: number | undefined

  /**
   * The next token is a keyword refused where an operand belongs (`NOT_AN_OPERAND`). It is left UNCONSUMED: the vendor's
   * answer goes on as a STATEMENT's resync from that word, which only the statement list can run (`takeRefusedOperand`).
   */
  refuseOperand(): void {
    this.refusedOperandAt = this.pos
  }

  /** Did the statement that just failed stop on a refused operand? True only if nothing has moved since; clears it. */
  takeRefusedOperand(): boolean {
    const here = this.refusedOperandAt === this.pos
    this.refusedOperandAt = undefined
    return here
  }

  /** Where a refused statement's resync stopped at a name and the vendor starts a statement (`reportStatementCascade`). */
  private resumedAt: number | undefined

  /** The next token starts the statement the vendor RESUMES at after a refused token (`ExprStatement.resumed`). */
  markResumed(): void {
    this.resumedAt = this.pos
  }

  /** Does the statement about to be parsed start where a resync resumed? True only if nothing has moved since; clears it. */
  takeResumed(): boolean {
    const here = this.resumedAt === this.pos
    this.resumedAt = undefined
    return here
  }

  pushError(message: string, span: Span, unexpectedToken?: string): void {
    this.errors.push(unexpectedToken === undefined ? { message, span } : { message, span, unexpectedToken })
  }

  /** Record an error that carries its own vendor facts (`ParseError`), worded where the vendor is known. */
  pushParseError(error: ParseError): void {
    this.errors.push(error)
  }

  /** Current meaningful token (skipping trivia). Never returns undefined; EOF is the sentinel. */
  peek(offset = 0): Token {
    let i = this.pos
    let seen = 0
    while (i < this.tokens.length) {
      const t = this.tokens[i]
      if (!isTrivia(t.kind)) {
        if (seen === offset) return t
        seen += 1
      }
      i += 1
      if (t.kind === "eof") return t
    }
    // Should be unreachable — lex() always appends an eof token.
    return this.tokens[this.tokens.length - 1]
  }

  /** Does the `offset`-th meaningful token open an `IMPLEMENTATION <LANG>` line? That line is where a declaration
   *  ENDS, so a header lookahead that asks "does a name follow?" must not take it for one (`parseMethod`). */
  opensImplementationLine(offset = 0): boolean {
    let i = this.pos
    let seen = 0
    for (; i < this.tokens.length; i++) {
      if (isTrivia(this.tokens[i]!.kind)) continue
      if (seen === offset) break
      seen += 1
    }
    return i < this.tokens.length && opensKeywordLine(this.tokens, i)
  }

  /** The PRAGMA tokens in the trivia before the next meaningful token, in order — where a statement may start, the
   *  ones the statement parser acts on (`parse/statements` `applyPragmas`). */
  pragmasAhead(): Token[] {
    const out: Token[] = []
    for (let i = this.pos; i < this.tokens.length; i++) {
      const t = this.tokens[i]!
      if (!isTrivia(t.kind)) break
      if (t.kind === "pragma") out.push(t)
    }
    return out
  }

  /** Run `parse` with its errors dropped: a branch not taken is parsed in silence (`parse/statements`). */
  silently<T>(parse: () => T): T {
    const errors = this.errors.length
    try {
      return parse()
    } finally {
      this.errors.length = errors
    }
  }

  /** Advance past the next meaningful token (skipping trivia) and return it. */
  consume(): Token {
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]
      this.pos += 1
      if (!isTrivia(t.kind)) return t
    }
    return this.tokens[this.tokens.length - 1]
  }

  /** The last meaningful token consumed (the first token when nothing was) — where a unit that ends without its closer
   *  ends (`parse/units/type-decl`). */
  previous(): Token {
    for (let i = this.pos - 1; i >= 0; i--) if (!isTrivia(this.tokens[i]!.kind)) return this.tokens[i]!
    return this.tokens[0]!
  }

  /** Are we at end-of-stream? */
  atEof(): boolean {
    return this.peek().kind === "eof"
  }

  /** Save the current position; useful for backtracking on speculative parses. */
  mark(): number {
    return this.pos
  }

  /** The source of `span` AS WRITTEN — every token inside it, trivia included, joined — for a message that quotes it
   *  (`parse/expression`: "'END_IF' is no component of 'bx'"). */
  textOf(span: Span): string {
    return this.tokens
      .filter((t) => t.kind !== "eof" && t.span.start >= span.start && t.span.end <= span.end)
      .map((t) => t.text)
      .join("")
  }

  /** A cursor at this position over the same tokens, with errors of its own: a speculative parse that leaves this
   *  cursor untouched (`statements.ts` `isArmStart`). */
  fork(): Cursor {
    const ahead = new Cursor(this.tokens, this.vocabulary, this.body)
    ahead.pos = this.pos
    return ahead
  }

  // ─── Typed eaters ──────────────────────────────────────────────

  /** Consume if the next meaningful token is the given keyword. Returns the token, else undefined. */
  eatKeyword(kw: Keyword): Token | undefined {
    const t = this.peek()
    if (t.kind === "keyword" && t.keyword === kw) {
      return this.consume()
    }
    return undefined
  }

  /** Consume if the next meaningful token is ANY of the given keywords. */
  eatAnyKeyword(...kws: Keyword[]): Token | undefined {
    const t = this.peek()
    if (t.kind === "keyword" && t.keyword !== undefined && kws.includes(t.keyword)) {
      return this.consume()
    }
    return undefined
  }

  /** Consume if the next meaningful token is the given punctuation literal (e.g. ":=", ";"). */
  eatPunct(text: string): Token | undefined {
    const t = this.peek()
    if (t.kind === "punct" && t.text === text) {
      return this.consume()
    }
    return undefined
  }

  /** Consume if the next meaningful token is an identifier. */
  eatIdent(): Token | undefined {
    const t = this.peek()
    if (t.kind === "identifier") {
      return this.consume()
    }
    return undefined
  }

  // ─── Expect variants — record an error if mismatched, don't consume ──

  // Wording mirrors CODESYS/TwinCAT: `'<expected>' expected instead of <found>` — no word about the construct we were
  // in, as the IDEs say none.
  expectKeyword(kw: Keyword): Token | undefined {
    const t = this.eatKeyword(kw)
    if (t === undefined) {
      const next = this.peek()
      this.pushError(expectedInsteadOf(`'${kw}'`, next), next.span)
    }
    return t
  }

  expectPunct(text: string): Token | undefined {
    const t = this.eatPunct(text)
    if (t === undefined) {
      const next = this.peek()
      this.pushError(expectedInsteadOf(`'${text}'`, next), next.span)
    }
    return t
  }

  expectIdent(): Token | undefined {
    const t = this.eatIdent()
    if (t === undefined) {
      const next = this.peek()
      this.pushError(nameExpected(next), next.span, unexpectedTokenOf(next))
    }
    return t
  }

  /**
   * Like `expectIdent`, but also accepts the keywords that are legal VARIABLE names — `GET`, `SET`, `OVERRIDE`
   * (`SOFT_NAME_KEYWORDS`). The token's `.text` keeps its source casing, so it reads as the name.
   */
  expectName(): Token | undefined {
    // a name a declaration refuses (`isRefusedDeclaredName`: `ld`, `byte`, `foo__bar`) is the word a reserved one is,
    // left unconsumed for the declaration's cascade (rule R6, `cc_il_name_*`, `identifier_double_underscore`)
    const t = this.peek()
    if (t.kind === "identifier" && isRefusedDeclaredName(t.text, this.dialect)) {
      this.pushError(`Unexpected token ${vendorTokenText(t)} found`, t.span, t.text)
      return undefined
    }
    return this.expectNameOf(SOFT_NAME_KEYWORDS)
  }

  /** A unit header's name — `expectName`, and the six access/inheritance modifiers too (`UNIT_NAME_KEYWORDS`). */
  expectUnitName(): Token | undefined {
    return this.expectNameOf(UNIT_NAME_KEYWORDS)
  }

  private expectNameOf(keywords: ReadonlySet<string>): Token | undefined {
    const t = this.peek()
    if (t.kind === "identifier" || (t.kind === "keyword" && keywords.has(t.keyword ?? ""))) {
      return this.consume()
    }
    this.pushError(nameExpected(t), t.span, unexpectedTokenOf(t))
    return undefined
  }

  /** True if the next token can begin a name — an identifier, or a soft-name keyword (`SET`/`GET`/`OVERRIDE`)
   *  that is a legal variable name. Lets a declaration loop tell "another decl" from "a hard keyword
   *  that ends the section" without choking `expectName` on the latter. */
  atNameStart(): boolean {
    const t = this.peek()
    return t.kind === "identifier" || (t.kind === "keyword" && SOFT_NAME_KEYWORDS.has(t.keyword ?? ""))
  }

  /**
   * True when the next token genuinely CLOSES a declaration list — an `END_*`, another VAR section, the start
   * of the next unit, or EOF. The complement of `atNameStart()` is NOT that: most reserved words (`LIMIT`,
   * `MIN`, `TO` …) are neither a legal name nor a section end, they are a *bad declaration* — CODESYS reports
   * `Unexpected token 'LIMIT' found` on the name, and so must we. Splitting the two keeps the error on the
   * offending token instead of blaming the section header for an `END_VAR` that is right there.
   */
  atDeclListEnd(): boolean {
    const t = this.peek()
    if (t.kind === "eof") return true
    if (t.kind !== "keyword" || t.keyword === undefined) return false
    return t.keyword.startsWith("END_") || DECL_LIST_ENDERS.has(t.keyword)
  }

  // ─── Raw lines — for the few rules that are about LINES, not tokens ──

  /** The raw trivia (whitespace, comments, pragmas) between the cursor and the next meaningful token. */
  triviaAhead(): readonly Token[] {
    const out: Token[] = []
    for (let i = this.pos; i < this.tokens.length && isTrivia(this.tokens[i].kind); i++) out.push(this.tokens[i])
    return out
  }

  /** Consume the rest of the current line — every raw token up to the whitespace that ends it, which is left — and
   *  return the consumed tokens. */
  consumeRestOfLine(): Token[] {
    const out: Token[] = []
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]
      if (t.kind === "eof" || (t.kind === "whitespace" && t.text.includes("\n"))) break
      out.push(t)
      this.pos += 1
    }
    return out
  }

  // ─── The raw stream — for the body collectors, which keep trivia (`body.ts`) ──

  /** The raw token at the cursor, trivia included, or undefined past the end. */
  rawAt(): Token | undefined {
    return this.tokens[this.pos]
  }

  /** Step past the raw token at the cursor, trivia included. */
  advanceRaw(): void {
    this.pos += 1
  }

  // ─── Recovery ──────────────────────────────────────────────────

  /**
   * Skip tokens (meaningful + trivia) until the next meaningful
   * token is one of `anchors` (keyword) or `anchorPuncts` (punct
   * text), or we hit EOF. Used to resume parsing after a syntax
   * error so one bad line doesn't kill the rest of the file.
   *
   * Returns true if an anchor was found; false at EOF.
   */
  recoverTo(opts: { keywords?: readonly Keyword[]; puncts?: readonly string[] }): boolean {
    const kws = new Set<Keyword>(opts.keywords ?? [])
    const punct = new Set<string>(opts.puncts ?? [])
    while (!this.atEof()) {
      const t = this.peek()
      if (t.kind === "keyword" && t.keyword !== undefined && kws.has(t.keyword)) return true
      if (t.kind === "punct" && punct.has(t.text)) return true
      this.consume()
    }
    return false
  }
}
