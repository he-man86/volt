/**
 * The reader's cursor — what every part of the network-text reader stands on (`parser.ts` composes them): the body's text
 * and its tokens, cut into LINES (P2) the way the bridge's reader cuts them, positions in the document, the findings, the
 * declarations the reader asks (`NetworkScopeView`), and the ST fragments inside the text, read by the ST parser. The
 * reader's concerns build on it in one line — `values.ts` (a bracket level, an operand, the parallel, a box's role),
 * `calls.ts` (a call and its pins), `statements.ts` (one statement per line) and `parser.ts` (the body, a network, its
 * header and its open lines).
 */
import type { Span } from "../span.js"
import type { BodySpan, Expr, StatementList } from "../ast/nodes/index.js"
import type { Dialect } from "../lex/vocabulary.js"
import { isTrivia, type Token } from "../lex/tokens.js"
import { lex } from "../lex/lexer.js"
import { parseExprFromTokens } from "../parse/expression.js"
import { bodyStatements } from "../parse/body-parse.js"
import type { NetworkDiagnosticCode, NetworkName, NetworkTextDiagnostic } from "./ast.js"
import { NetworkLexer, type Tok, isSym, isWord } from "./lexer.js"
import { OPERATOR_WORDS } from "./words.js"

/** A finding raised where the reader stands: it unwinds to the network, which reports it and recovers. */
export class ParseError {
  constructor(
    readonly code: NetworkDiagnosticCode,
    readonly message: string,
    readonly offset: number,
    readonly length: number,
  ) {}
}

/** The questions the bridge reader asks of the declarations mid-statement (`NetworkScope`), case-insensitively. */
export interface NetworkScopeView {
  /** A POU a call can name (the bridge's `IsPou`). */
  isPou(name: string): boolean
  /** The FB type of `head` when it is an FB instance a declaration names — a variable, or a path to one — else
   *  undefined (`NetworkScope.InstanceType`). */
  instanceType(head: string): string | undefined
  /** Whether a declaration in scope makes the name (`NetworkScope.Contains`) — what a split may not be named like. */
  declares(name: string): boolean
}

/** A scope that knows nothing: what the structure-only readers ask (`STRUCTURE_ONLY`). */
export const EMPTY_SCOPE: NetworkScopeView = { isPou: () => false, instanceType: () => undefined, declares: () => false }

export abstract class NetworkCursor {
  protected readonly text: string
  private readonly base: Span
  private readonly lineStarts: number[] = [0]
  protected lx!: NetworkLexer
  protected toks: Tok[] = []
  protected p = 0
  /** The current line's end (exclusive), or the token count outside a line. */
  protected end = 0
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

  /** A token's text as an ST expression: a backticked one's inner text, any other token whole. */
  protected tokExpr(t: Tok): Expr | undefined {
    if (t.kind === "unnamed") return undefined
    return t.kind === "backtick" ? this.stExpr(t.offset + 1, t.offset + t.length - 1) : this.stExpr(t.offset, t.offset + t.length)
  }

  /** An EXECUTE body's lines, parsed as the ST they are. */
  protected stStatements(from: number, to: number): { statements: StatementList; ok: boolean } {
    const toks = this.stTokens(from, to)
    const span = this.span(from, to)
    const parsed = bodyStatements({ kind: "body", tokens: toks, span, dialect: this.dialect })
    return { statements: parsed.statements, ok: parsed.ok }
  }

  // ── tokens: the current line ────────────────────────────────────────────────────────────────

  /** The token at `i`, whatever line it is on. */
  protected raw(i: number): Tok {
    return i < this.toks.length ? this.toks[i]! : this.toks[this.toks.length - 1]!
  }

  protected atEnd(): boolean {
    return this.p >= this.end
  }

  /** The next token of the CURRENT LINE: past its end, a synthetic end token at the line's end. */
  protected peek(): Tok {
    return this.peekAt(0)
  }

  protected peekAt(k: number): Tok {
    const i = this.p + k
    if (i >= this.end) {
      const prev = this.end > 0 ? this.raw(this.end - 1) : this.raw(0)
      return { kind: "eof", text: "", offset: prev.offset + prev.length, length: 0, atLineStart: false }
    }
    return this.raw(i)
  }

  protected next(): Tok {
    const t = this.peek()
    if (t.kind === "error") throw this.err(t, (t.code ?? "NETWORK_PARSE") as NetworkDiagnosticCode, t.text)
    if (this.p < this.end) this.p++
    return t
  }

  /** The end of the last token consumed. */
  protected lastEnd(): number {
    const last = this.p > 0 ? this.raw(Math.min(this.p, this.toks.length) - 1) : this.raw(0)
    return last.offset + last.length
  }

  protected expectSym(sym: string, form: string): void {
    const t = this.peek()
    if (!isSym(t, sym))
      throw this.err(
        t,
        "NETWORK_PARSE",
        t.kind === "eof" ? `the line ends where \`${sym}\` is expected (${form}).` : `expected \`${sym}\` and found '${t.text}' (${form}).`,
      )
    this.next()
  }

  protected expectOnLine(sym: string, line: number, form: string): void {
    const t = this.raw(this.p)
    if (this.line(t) !== line) throw this.err(t, "NETWORK_PARSE", `the NETWORK header ends at its newline; \`${form}\` is on one line.`)
    this.expectSym(sym, form)
  }

  /** Whether a storage operator stands at `i`: `:=`, or ExST's `S=` / `R=` — a word `S` or `R` and `=`. Only after a
   *  target, so the position decides, never the spacing. */
  protected storageAt(i: number): boolean {
    if (i >= this.end) return false
    const t = this.raw(i)
    return isSym(t, ":=") || ((isWord(t, "S") || isWord(t, "R")) && i + 1 < this.end && isSym(this.raw(i + 1), "="))
  }

  /** The storage operator at the cursor, as one token (`S=`, `R=`, `:=`). */
  protected takeStorage(): Tok {
    const t = this.next()
    if (isSym(t, ":=")) return t
    const eq = this.next()
    return { kind: "sym", text: t.text.toUpperCase() + "=", offset: t.offset, length: eq.offset + eq.length - t.offset, atLineStart: t.atLineStart }
  }

  /** P2: whether a line ending in `prev` (after `before`) goes on to the next line — it ends with a word that cannot end
   *  it: an infix box word, BRANCH, `=>`, `:=`, `S=`, `R=` (`NetworkSpelling.ContinuesLine`). */
  protected continuesLine(prev: Tok, before: Tok | undefined): boolean {
    return (
      (prev.kind === "word" && (OPERATOR_WORDS.has(prev.text.toUpperCase()) || isWord(prev, "BRANCH"))) ||
      isSym(prev, "=>") ||
      isSym(prev, ":=") ||
      isSym(prev, ",") ||
      isSym(prev, "(") ||
      (isSym(prev, "=") && before !== undefined && (isWord(before, "S") || isWord(before, "R")))
    )
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

  protected line(t: Tok): number {
    return this.lineIndex(t.offset)
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
