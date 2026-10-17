/**
 * The reader's cursor — what the network-text reader (`parser.ts`) stands on: the body's text and its tokens, the one
 * indentation check that ends an item (a continuation line of an item is indented deeper than the item's first line),
 * positions in the document, the findings, the declarations the reader asks (`NetworkScopeView`), and the ST fragments
 * inside the text, read by the ST parser.
 */
import type { Span } from "../span.js"
import type { BodySpan, Expr, StatementList } from "../ast/nodes/index.js"
import type { Dialect } from "../lex/vocabulary.js"
import { isTrivia, type Token } from "../lex/tokens.js"
import { lex } from "../lex/lexer.js"
import { parseExprFromTokens } from "../parse/expression.js"
import { bodyStatements } from "../parse/body-parse.js"
import type { NetworkDiagnosticCode, NetworkName, NetworkTextDiagnostic } from "./ast.js"
import { NetworkLexer, type Tok, isWord } from "./lexer.js"

/** A finding raised where the reader stands: it unwinds to the network, which reports it and recovers. */
export class ParseError {
  constructor(
    readonly code: NetworkDiagnosticCode,
    readonly message: string,
    readonly offset: number,
    readonly length: number,
  ) {}
}

/** The questions the bridge reader asks of the declarations mid-item (`NetworkScope`), case-insensitively. */
export interface NetworkScopeView {
  /** A POU a call can name (the bridge's `IsPou`). */
  isPou(name: string): boolean
  /** The FB type of `head` when it is an FB instance a declaration names — a variable, or a path to one — else
   *  undefined (`NetworkScope.InstanceType`). */
  instanceType(head: string): string | undefined
  /** Whether a declaration in scope makes the name (`NetworkScope.Contains`). */
  declares(name: string): boolean
}

/** A scope that knows nothing: what the structure-only readers ask (`STRUCTURE_ONLY`). */
export const EMPTY_SCOPE: NetworkScopeView = { isPou: () => false, instanceType: () => undefined, declares: () => false }

/** The text the synthetic end token carries where a line no deeper than its item's first ends the item. */
const MISSING_SEMICOLON = "\u0000missing-semicolon"

export abstract class NetworkCursor {
  protected readonly text: string
  private readonly base: Span
  private readonly lineStarts: number[] = [0]
  protected lx!: NetworkLexer
  protected toks: Tok[] = []
  protected p = 0
  /** The item being read: its first token's index and column — a later token starting a line at or left of that column
   *  ends the item. -1 outside an item. */
  protected itemStart = -1
  protected itemColumn = 0
  protected readonly diagnostics: NetworkTextDiagnostic[] = []

  constructor(
    protected readonly body: BodySpan,
    protected readonly scope: NetworkScopeView,
    /** The document's vocabulary, for the ST fragments in the text (`stTokens`) — the parse's own. */
    protected readonly dialect: Dialect,
  ) {
    // The body's text is its tokens' text: the ST lexer emits every character, whitespace included.
    this.text = body.tokens.map((t) => t.text).join("")
    this.base = body.tokens[0]?.span ?? body.span
    for (let k = 0; k < this.text.length; k++) if (this.text[k] === "\n") this.lineStarts.push(k + 1)
  }

  // ── ST inside the text ──────────────────────────────────────────────────────────────────────

  /** The ST tokens of `[from, to)` of the body text, positioned in the document. */
  protected stTokens(from: number, to: number): Token[] {
    const at = this.position(from)
    return lex(this.text.slice(from, to), this.dialect)
      .filter((t) => t.kind !== "eof" && !isTrivia(t.kind))
      .map((t) => ({ ...t, span: shift(t.span, at) }))
  }

  /** `[from, to)` parsed as one ST expression, or undefined when it is none. */
  protected stExpr(from: number, to: number): Expr | undefined {
    const toks = this.stTokens(from, to)
    if (toks.length === 0 || toks.some((t) => t.kind === "unknown")) return undefined
    return parseExprFromTokens(toks)
  }

  /** A token's text as an ST expression: a backticked one's inner text, any other token whole. A backticked text that
   *  holds an escape or a doubled backtick is no slice of the document, and has none. */
  protected tokExpr(t: Tok): Expr | undefined {
    if (t.kind === "unnamed") return undefined
    if (t.kind === "backtick") {
      if (this.text.slice(t.offset + 1, t.offset + t.length - 1) !== t.text) return undefined
      return this.stExpr(t.offset + 1, t.offset + t.length - 1)
    }
    return this.stExpr(t.offset, t.offset + t.length)
  }

  /** An EXECUTE body's lines, parsed as the ST they are. */
  protected stStatements(from: number, to: number): { statements: StatementList; ok: boolean } {
    const toks = this.stTokens(from, to)
    const span = this.span(from, to)
    const parsed = bodyStatements({ kind: "body", tokens: toks, span, dialect: this.dialect })
    return { statements: parsed.statements, ok: parsed.ok }
  }

  // ── tokens ──────────────────────────────────────────────────────────────────────────────────

  /** The token at `i`, whatever line it is on. */
  protected raw(i: number): Tok {
    return i < this.toks.length ? this.toks[i]! : this.toks[this.toks.length - 1]!
  }

  protected peek(): Tok {
    return this.peekAt(0)
  }

  /** The token `k` ahead, inside the item: a token starting a line no deeper than the item's first line ends the item
   *  (the one indentation check) and reads as its end. An EXECUTE body and its `END_EXECUTE` are verbatim and exempt. */
  protected peekAt(k: number): Tok {
    for (let j = 0; j <= k; j++) {
      const i = this.p + j
      const t = this.raw(i)
      if (this.itemStart >= 0 && i > this.itemStart && t.atLineStart && t.kind !== "snippet" && t.kind !== "eof" &&
          !(isWord(t, "END_EXECUTE") && this.raw(i - 1).kind === "snippet") && this.column(t) <= this.itemColumn)
        return { kind: "eof", text: MISSING_SEMICOLON, offset: t.offset, length: t.length, atLineStart: true }
      if (j === k || t.kind === "eof") return t
    }
    return this.raw(this.p + k)
  }

  /** Whether `t` is the end an item meets at a line no deeper than its first. */
  protected isMissingSemicolon(t: Tok): boolean {
    return t.kind === "eof" && t.text === MISSING_SEMICOLON
  }

  protected next(): Tok {
    const t = this.peek()
    if (t.kind === "error") throw this.err(t, (t.code ?? "NETWORK_PARSE") as NetworkDiagnosticCode, t.text)
    if (this.isMissingSemicolon(t)) throw this.missingSemicolon(t)
    if (t.kind !== "eof") this.p++
    return t
  }

  protected missingSemicolon(t: Tok): ParseError {
    return this.err(
      t,
      "NETWORK_PARSE",
      "missing `;`? A line indented no deeper than its item's first line starts a new item, so the item before it ends with `;`.",
    )
  }

  /** The end of the last token consumed. */
  protected lastEnd(): number {
    const last = this.p > 0 ? this.raw(Math.min(this.p, this.toks.length) - 1) : this.raw(0)
    return last.offset + last.length
  }

  protected line(t: Tok): number {
    return this.lineIndex(t.offset)
  }

  protected column(t: Tok): number {
    return t.offset - this.lineStarts[this.lineIndex(t.offset)]!
  }

  // ── positions ───────────────────────────────────────────────────────────────────────────────

  private lineIndex(offset: number): number {
    let lo = 0
    let hi = this.lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.lineStarts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  private position(offset: number): { offset: number; line: number; col: number } {
    const li = this.lineIndex(offset)
    const col = li === 0 ? this.base.startCol + offset : offset - this.lineStarts[li]!
    return { offset: this.base.start + offset, line: this.base.startLine + li, col }
  }

  protected span(from: number, to: number): Span {
    const a = this.position(from)
    const b = this.position(Math.max(from, to))
    return { start: a.offset, end: b.offset, startLine: a.line, startCol: a.col, endLine: b.line, endCol: b.col }
  }

  protected tokSpan(t: Tok): Span {
    return this.span(t.offset, t.offset + t.length)
  }

  /** A span from the token `from` to the last token consumed. */
  protected spanFrom(from: Tok): Span {
    return this.span(from.offset, Math.max(from.offset + from.length, this.lastEnd()))
  }

  /** An empty slot has no text; it stands at the token that shows it is empty, zero-width. */
  protected emptySpan(t: Tok): Span {
    return this.span(t.offset, t.offset)
  }

  protected name(t: Tok): NetworkName {
    return { text: t.text, span: this.tokSpan(t) }
  }

  // ── findings ────────────────────────────────────────────────────────────────────────────────

  protected err(t: Tok, code: NetworkDiagnosticCode, message: string): ParseError {
    return new ParseError(code, message, t.offset, Math.max(1, t.length))
  }

  protected report(e: ParseError): void {
    this.diag(e.code, e.message, this.span(e.offset, e.offset + e.length))
  }

  protected diag(code: NetworkDiagnosticCode, message: string, span: Span): void {
    this.diagnostics.push({ code, message, span })
  }
}

/** A span the ST lexer gave relative to a slice, moved to where the slice stands in the document. */
function shift(s: Span, at: { offset: number; line: number; col: number }): Span {
  return {
    start: at.offset + s.start,
    end: at.offset + s.end,
    startLine: at.line + s.startLine - 1,
    startCol: s.startLine === 1 ? at.col + s.startCol : s.startCol,
    endLine: at.line + s.endLine - 1,
    endCol: s.endLine === 1 ? at.col + s.endCol : s.endCol,
  }
}
