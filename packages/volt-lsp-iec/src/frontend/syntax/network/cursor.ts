/**
 * The reader's cursor — what every part of the network-text reader stands on (`parser.ts` composes them): the body's
 * text and its token lookahead, the network's wires and the names it read as variables, positions in the document, the
 * findings, and the ST fragments inside the text, read by the ST parser. The reader's concerns build on it in one line
 * — `values.ts` (an operand, a group, an edge), `calls.ts` (a call and its pins, PARALLEL, EXECUTE), `statements.ts`
 * (one statement per NWL item) and `parser.ts` (the body, a network, its header and wires).
 */
import type { Span } from "../span.js"
import type { BodySpan, Expr, StatementList } from "../ast/nodes/index.js"
import type { Dialect } from "../lex/vocabulary.js"
import { isTrivia, type Token } from "../lex/tokens.js"
import { lex } from "../lex/lexer.js"
import { parseExprFromTokens } from "../parse/expression.js"
import { bodyStatements } from "../parse/body-parse.js"
import type {
  NetworkDiagnosticCode,
  NetworkLanguage,
  NetworkName,
  NetworkTextDiagnostic,
  NetworkValue,
  NetworkWire,
} from "./ast.js"
import { NetworkLexer, type Tok, isSym, isWord } from "./lexer.js"

export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/

/** A name or a dotted path to one — what a POU or a declared instance is called. */
export const isName = (t: string): boolean => IDENTIFIER.test(t) || PATH.test(t)

/** A finding raised where the reader stands: it unwinds to the network, which reports it and recovers. */
export class ParseError {
  constructor(
    readonly code: NetworkDiagnosticCode,
    readonly message: string,
    readonly offset: number,
    readonly length: number,
  ) {}
}

/** A value as parsed, before it is known what it is for: a bare token stays unresolved, because the same token is a
 *  target when `:=` follows it and an operand otherwise. */
export interface PVal {
  node?: NetworkValue
  bare?: Tok
  start: Tok
}

/** A wire of the network in hand, and whether its definition has been read yet. */
interface Wire {
  wire: NetworkWire
  defined: boolean
}

/** The questions the bridge reader asks of the declarations mid-statement (`NetworkScope`), case-insensitively. */
export interface NetworkScopeView {
  /** A POU a call can name (the bridge's `IsPou`). */
  isPou(name: string): boolean
  /** The FB type of `head` when it is an FB instance a declaration names — a variable, or a path to one — else
   *  undefined (`NetworkScope.InstanceType`). */
  instanceType(head: string): string | undefined
}

/**
 * The operators' typing rule the reader types a wire by (`checkWireTypes`) — the type layer's (`types/arith/operators`
 * `operatorFunctionResult`, `isBitOperatorWireType`), handed in because syntax imports no type fact. Its one composer is
 * `types/network/network-parse.ts` `parseNetworkText`, the reader every caller uses.
 */
export interface NetworkWireTyping {
  /** A function-form operator box's result: a comparison BOOL, a bit operator a type of ANY_BIT, else undefined. */
  operatorResult(name: string): { exact: "BOOL" } | { group: "ANY_BIT" } | undefined
  /** Whether a bit operator box's output wire may be declared this type. */
  isBitWireType(name: string): boolean
}

export abstract class NetworkCursor {
  protected readonly text: string
  private readonly base: Span
  private readonly lineStarts: number[] = [0]
  protected lx!: NetworkLexer
  private la: Tok | undefined
  protected lastEnd = 0
  protected readonly diagnostics: NetworkTextDiagnostic[] = []
  protected wires = new Map<string, Wire>()
  /** Per network: every bare word read as a VARIABLE so far (an operand or a target), with where — so a late VAR_TEMP
   *  block cannot turn a name the network already read as a variable into a wire (`declare`). */
  protected readAsVariable = new Map<string, Tok>()
  protected language!: NetworkLanguage

  constructor(
    protected readonly body: BodySpan,
    protected readonly scope: NetworkScopeView | undefined,
    /** The document's vocabulary, for the ST fragments in the text (`stTokens`) — the parse's own. */
    protected readonly dialect: Dialect,
    protected readonly typing: NetworkWireTyping,
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
    if (toks.some((t) => t.kind === "unknown")) return undefined
    return parseExprFromTokens(toks)
  }

  /** An EXECUTE body's lines, parsed as the ST they are. */
  protected stStatements(from: number, to: number): { statements: StatementList; ok: boolean } {
    const toks = this.stTokens(from, to)
    const span = this.span(from, to)
    const parsed = bodyStatements({ kind: "body", tokens: toks, span, dialect: this.dialect })
    return { statements: parsed.statements, ok: parsed.ok }
  }

  // ── tokens ──────────────────────────────────────────────────────────────────────────────────

  protected peek(): Tok {
    if (this.la !== undefined) return this.la
    const t = this.lx.next()
    if (t.kind === "error") throw this.err(t, (t.code ?? "NETWORK_PARSE") as NetworkDiagnosticCode, t.text)
    this.la = t
    return t
  }

  /** `peek`, reporting a lexical error rather than throwing it (the lexer has already moved past it). */
  protected peekSafe(): Tok | undefined {
    try {
      return this.peek()
    } catch (e) {
      if (!(e instanceof ParseError)) throw e
      this.report(e)
      return undefined
    }
  }

  protected next(): Tok {
    const t = this.peek()
    this.la = undefined
    if (t.kind !== "eof") this.lastEnd = t.offset + t.length
    return t
  }

  protected expectSym(sym: string, form: string): void {
    const t = this.peek()
    if (!isSym(t, sym))
      throw this.err(
        t,
        "NETWORK_PARSE",
        t.kind === "eof" ? `the body ends where \`${sym}\` is expected (${form}).` : `expected \`${sym}\` and found '${t.text}' (${form}).`,
      )
    this.next()
  }

  protected expectOnLine(sym: string, line: number, form: string): void {
    const t = this.peek()
    if (this.line(t) !== line) throw this.err(t, "NETWORK_PARSE", `the NETWORK header ends at its newline; \`${form}\` is on one line.`)
    this.expectSym(sym, form)
  }

  protected expectWord(word: string, form: string): void {
    const t = this.peek()
    if (!isWord(t, word)) throw this.err(t, "NETWORK_PARSE", `expected ${word} and found '${t.text}' (${form}).`)
    this.next()
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

  /** The line the BRIDGE reader names for `t` in a message (`NetworkTextReader.Line`): 1-based over the body as pushed,
   *  whose line 1 is the IMPLEMENTATION line. This text starts at the newline that ends that line, so its line index 0 is
   *  the bridge's line 1. */
  protected bridgeLine(t: Tok): number {
    return this.line(t) + 1
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

  /** An empty slot has no text; it is reported at the token that shows it is empty, zero-width. */
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
