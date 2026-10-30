/**
 * THE LEXER'S CURSOR — the state every token-class scanner (`trivia.ts`, `strings.ts`, `numbers.ts`, `words.ts`,
 * `addresses.ts`, `punctuation.ts`) reads and advances: the source, the position, and the tokens emitted so far.
 *
 * Position tracking: line/col are advanced incrementally as `pos` moves so we don't rescan the source for every token
 * span. Lines are 1-based, columns 0-based (matches the LSP convention).
 */
import type { Span } from "../span.js"
import type { Token, TokenKind } from "./tokens.js"

/** What `emit` adds to a literal the vendor refuses whole (`Token.malformed`). */
export const MALFORMED = { malformed: true } as const

/** The bases a `<base>#` literal may name — asked of both vendors (`lit_invalid_base_*`, 2026-10-01). */
export const RADIXES: ReadonlySet<number> = new Set([2, 8, 10, 16])

export class Scanner {
  readonly tokens: Token[] = []
  readonly len: number
  pos = 0
  line = 1 // 1-based
  col = 0 // 0-based, matches LSP
  /** Where the token being scanned starts (`mark`). */
  start = 0
  startLine = 1
  startCol = 0

  /** `tc`: the source is TwinCAT's — the one vocabulary fact a scanner asks (`lex`'s `dialect`); `unicode`: a name may
   *  hold letters and digits past ASCII (`lex`'s `unicodeIdentifiers`). */
  constructor(
    readonly src: string,
    readonly tc: boolean,
    readonly unicode: boolean,
  ) {
    this.len = src.length
  }

  get more(): boolean {
    return this.pos < this.len
  }

  peek(offset = 0): string {
    return this.pos + offset < this.len ? this.src[this.pos + offset]! : ""
  }

  advance(n: number): void {
    for (let i = 0; i < n && this.pos < this.len; i++) {
      if (this.src[this.pos] === "\n") {
        this.line += 1
        this.col = 0
      } else {
        this.col += 1
      }
      this.pos += 1
    }
  }

  /** The next token starts here. */
  mark(): void {
    this.start = this.pos
    this.startLine = this.line
    this.startCol = this.col
  }

  /** Back to the token's start (`mark`). */
  rewind(): void {
    this.pos = this.start
    this.line = this.startLine
    this.col = this.startCol
  }

  /** The token's text so far. */
  text(): string {
    return this.src.slice(this.start, this.pos)
  }

  /** The token from its start (`mark`) to the cursor. */
  emit(kind: TokenKind, extra?: Partial<Token>): void {
    const span: Span = {
      start: this.start,
      end: this.pos,
      startLine: this.startLine,
      startCol: this.startCol,
      endLine: this.line,
      endCol: this.col,
    }
    this.tokens.push({ kind, text: this.src.slice(this.start, this.pos), span, ...extra })
  }
}
