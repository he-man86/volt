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
import { isTrivia, type Keyword, type Token } from "./tokens.js"
import type { Span } from "./span.js"
import type { ParseError } from "./ast.js"

export class Cursor {
  private pos = 0
  private readonly errors: ParseError[] = []

  constructor(private readonly tokens: readonly Token[]) {}

  getErrors(): ParseError[] {
    return this.errors
  }

  pushError(message: string, span: Span): void {
    this.errors.push({ message, span })
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

  /** Advance past the next meaningful token (skipping trivia) and return it. */
  consume(): Token {
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]
      this.pos += 1
      if (!isTrivia(t.kind)) return t
    }
    return this.tokens[this.tokens.length - 1]
  }

  /** Are we at end-of-stream? */
  atEof(): boolean {
    return this.peek().kind === "eof"
  }

  /** Save the current position; useful for backtracking on speculative parses. */
  mark(): number {
    return this.pos
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

  // Wording mirrors CODESYS/TwinCAT: `'<expected>' expected instead of <found>` (the `context` arg — which
  // construct we were in — is retained for call-site readability but omitted from the message, as the IDEs do).
  expectKeyword(kw: Keyword, _context: string): Token | undefined {
    const t = this.eatKeyword(kw)
    if (t === undefined) {
      const next = this.peek()
      this.pushError(`'${kw}' expected instead of ${describeToken(next)}`, next.span)
    }
    return t
  }

  expectPunct(text: string, _context: string): Token | undefined {
    const t = this.eatPunct(text)
    if (t === undefined) {
      const next = this.peek()
      this.pushError(`'${text}' expected instead of ${describeToken(next)}`, next.span)
    }
    return t
  }

  expectIdent(_context: string): Token | undefined {
    const t = this.eatIdent()
    if (t === undefined) {
      const next = this.peek()
      this.pushError(nameExpected(next), next.span)
    }
    return t
  }

  /**
   * Like `expectIdent`, but also accepts contextual keywords as a name. `GET`/`SET` (reserved only
   * inside a PROPERTY) and the access/inheritance modifiers (`PUBLIC`/`PRIVATE`/`PROTECTED`/`INTERNAL`/
   * `FINAL`/`ABSTRACT`/`OVERRIDE`) are all legal identifiers elsewhere — real code has methods named
   * `Set`, `Override`, etc. The token's `.text` keeps its source casing, so it reads as the name.
   */
  expectName(_context: string): Token | undefined {
    const t = this.peek()
    if (t.kind === "identifier" || (t.kind === "keyword" && Cursor.SOFT_NAME_KEYWORDS.has(t.keyword ?? ""))) {
      return this.consume()
    }
    this.pushError(nameExpected(t), t.span)
    return undefined
  }

  /** True if the next token can begin a name — an identifier, or a soft-name keyword (`SET`/`GET`/`OVERRIDE`
   *  …) that is a legal variable/member name. Lets a declaration loop tell "another decl" from "a hard keyword
   *  that ends the section" without choking `expectName` on the latter. */
  atNameStart(): boolean {
    const t = this.peek()
    return t.kind === "identifier" || (t.kind === "keyword" && Cursor.SOFT_NAME_KEYWORDS.has(t.keyword ?? ""))
  }

  private static readonly SOFT_NAME_KEYWORDS: ReadonlySet<string> = new Set([
    "GET",
    "SET",
    "PUBLIC",
    "PRIVATE",
    "PROTECTED",
    "INTERNAL",
    "FINAL",
    "ABSTRACT",
    "OVERRIDE",
  ])

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
    return t.keyword.startsWith("END_") || Cursor.DECL_LIST_ENDERS.has(t.keyword)
  }

  private static readonly DECL_LIST_ENDERS: ReadonlySet<string> = new Set([
    // the VAR sections — a new one ends the previous
    "VAR",
    "VAR_INPUT",
    "VAR_OUTPUT",
    "VAR_IN_OUT",
    "VAR_TEMP",
    "VAR_STAT",
    "VAR_INST",
    "VAR_EXTERNAL",
    "VAR_GLOBAL",
    "VAR_CONFIG",
    "VAR_ACCESS",
    "VAR_GENERIC",
    // the unit starters (`parseTopLevel`'s dispatch set) — recovery must never eat past one
    "PROGRAM",
    "FUNCTION_BLOCK",
    "FUNCTION",
    "METHOD",
    "ACTION",
    "PROPERTY",
    "INTERFACE",
    "TYPE",
    "NAMESPACE",
  ])

  // ─── Body collection (raw — preserves trivia) ──────────────────

  /**
   * Walk the raw token stream — **including trivia (pragmas,
   * comments, whitespace)** — until the next *meaningful* token is
   * one of `consumeEnders` (the cursor advances past it) or
   * `peekStoppers` (the cursor leaves it for the caller). Returns
   * the collected tokens and the closer (undefined on EOF).
   *
   * Used by body collectors so the captured `BodySpan.tokens` keeps
   * pragma tokens (semantically meaningful: `{IF}`, `{warning ...}`,
   * `{attribute ...}`). Downstream consumers filter trivia via
   * `isLexerTrivia()` when they want only meaningful tokens.
   */
  consumeBodyUntilAny(opts: { consumeEnders: readonly Keyword[]; peekStoppers?: readonly Keyword[] }): {
    tokens: Token[]
    closer: Token | undefined
    stoppedAt: Token | undefined
  } {
    const tokens: Token[] = []
    const consumeSet = new Set<Keyword>(opts.consumeEnders)
    const peekSet = new Set<Keyword>(opts.peekStoppers ?? [])
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]
      if (t.kind === "eof") return { tokens, closer: undefined, stoppedAt: undefined }
      if (!isTrivia(t.kind) && t.kind === "keyword" && t.keyword !== undefined) {
        if (consumeSet.has(t.keyword)) {
          this.pos += 1
          return { tokens, closer: t, stoppedAt: undefined }
        }
        if (peekSet.has(t.keyword)) {
          return { tokens, closer: undefined, stoppedAt: t }
        }
      }
      tokens.push(t)
      this.pos += 1
    }
    return { tokens, closer: undefined, stoppedAt: undefined }
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

/**
 * The error for "a name belongs here and this isn't one".
 *
 * A reserved word in name position is CODESYS's **C0009**, not its C0189: `Limit : INT;` — `LIMIT` is a
 * standard FUNCTION, so it is reserved — reports `Unexpected token 'LIMIT' found`. Confirmed live against
 * CODESYS SP21, 2026-09-03 (in a VAR section; STRUCT/UNION assume the same parser, unverified).
 * Only the keyword case has that evidence; punct/EOF keep the "expected instead of" form.
 */
function nameExpected(t: Token): string {
  return t.kind === "keyword"
    ? `Unexpected token ${describeToken(t)} found`
    : `identifier expected instead of ${describeToken(t)}`
}

// CODESYS/TwinCAT render the offending token bare-quoted (`'x'`, `';'`, `'TO'`) and EOF as "end of POU".
function describeToken(t: Token): string {
  if (t.kind === "eof") return "end of POU"
  if (t.kind === "keyword") return `'${t.keyword ?? t.text}'`
  if (t.kind === "identifier") return `'${t.text}'`
  if (t.kind === "punct") return `'${t.text}'`
  return `'${t.text.length > 20 ? `${t.text.slice(0, 20)}…` : t.text}'`
}
