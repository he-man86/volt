/**
 * Network text v2 lexer — a port of the bridge's `NetworkLexer` (`volt-cli/src/Volt.Engine/Format/Network/NetworkLexer.cs`),
 * so the editor reads a body token for token as the push does. It runs over the body's RAW text, not over the ST
 * lexer's tokens, because the two languages cut text differently where it matters: a dotted path is one token here
 * (`Mach1.GenFlags.Warning`) and `a .b` is not one; `S=` is a word and `=` (the parser decides from the position whether
 * that is the storage operator or a comparison with a variable `S`); `???` is one token; a `//` line is a comment whose
 * text is what follows `//` and one space; an EXECUTE body is verbatim ST up to the first line whose first word is
 * `END_EXECUTE`. Copying the bridge's rules rather than re-deriving them from ST tokens is what keeps the LSP from
 * calling valid text broken, or broken text valid (openspec network-text-literal-nwl 5.1).
 *
 * A lexical error is a token that has consumed its text, never an exception, as in the bridge.
 */

export type TokKind =
  | "word" // an identifier or dotted path
  | "number"
  | "typed" // T#1S, 16#FF
  | "address" // %IX0.0
  | "unnamed" // ???
  | "backtick" // text = the verbatim content between the backticks
  | "string" // a TITLE; text = the DECODED value
  | "comment" // a // line; text = what follows `//` and one space
  | "snippet" // an EXECUTE body; text = its lines joined by \n
  | "sym" // punctuation and operators
  | "error" // text = message, code = its NETWORK_* code
  | "eof"

export interface Tok {
  kind: TokKind
  text: string
  /** Offset into the lexed text. */
  offset: number
  length: number
  /** Whether only whitespace stands between the previous newline and this token — what makes `NETWORK` a header. */
  atLineStart: boolean
  code?: string
}

export const isWord = (t: Tok, word: string): boolean => t.kind === "word" && t.text.toUpperCase() === word.toUpperCase()
export const isSym = (t: Tok, s: string): boolean => t.kind === "sym" && t.text === s

// The token shapes are the bridge's `NetworkSpelling` patterns.
const NUMBER_AT = /[0-9][0-9_]*(\.[0-9][0-9_]*)?([eE][+-]?[0-9]+)?/y
const ADDRESS_AT = /%[IQM][XBWDL]?[0-9]+(\.[0-9]+)*/y
const END_EXECUTE = /^\s*(END_EXECUTE)\b/i

// Longest first: `:=` before `:`, `<=` / `<>` before `<`.
const SYMS = [":=", "=>", "<=", ">=", "<>", "(", ")", ",", ";", ":", ".", "=", "<", ">", "+", "-", "*", "/"]

/** The infix operators of the table (`FbdOperators.cs`): symbol → operator box type. */
export const SYMBOL_TO_TYPE: ReadonlyMap<string, string> = new Map([
  ["OR", "OR"],
  ["AND", "AND"],
  ["XOR", "XOR"],
  ["+", "ADD"],
  ["-", "SUB"],
  ["*", "MUL"],
  ["/", "DIV"],
  ["MOD", "MOD"],
  [">", "GT"],
  ["<", "LT"],
  [">=", "GE"],
  ["<=", "LE"],
  ["=", "EQ"],
  ["<>", "NE"],
])

/** The words of the text that ARE box types, so they head a call bare (`AND(EN := go, a, b)`, the NOT box) —
 *  `NetworkSpelling.OperatorHeads`, the one home of that fact for the parser and the ST reading alike. */
export const OPERATOR_HEADS: ReadonlySet<string> = new Set(["AND", "OR", "XOR", "MOD", "NOT"])

/** An infix operator of the table: a symbol, or one of the operator words (every operator head but NOT). */
export function isOperator(t: Tok): boolean {
  if (t.kind === "sym") return SYMBOL_TO_TYPE.has(t.text)
  return t.kind === "word" && t.text.toUpperCase() !== "NOT" && OPERATOR_HEADS.has(t.text.toUpperCase())
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c)
const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c)

export class NetworkLexer {
  private i: number

  constructor(
    private readonly s: string,
    start: number,
  ) {
    this.i = start
  }

  /** A lexer standing where this one stands, for a look ahead that must not move this one. */
  fork(): NetworkLexer {
    return new NetworkLexer(this.s, this.i)
  }

  next(): Tok {
    const s = this.s
    while (this.i < s.length && isSpace(s[this.i])) this.i++
    if (this.i >= s.length) return { kind: "eof", text: "", offset: s.length, length: 0, atLineStart: true }

    const start = this.i
    const atLineStart = this.atLineStart(start)
    const c = s[this.i]!

    if (c === "/" && s[this.i + 1] === "/") {
      this.i += 2
      const end = this.lineEnd(this.i)
      let text = withoutLayoutCr(s.slice(this.i, end))
      this.i = end
      if (text.includes("\r")) return this.loneCr(start)
      // `//` and ONE space are syntax; the rest — indentation, a leading `//` — is the comment's text.
      if (text.startsWith(" ")) text = text.slice(1)
      return { kind: "comment", text, offset: start, length: end - start, atLineStart }
    }

    if (c === "`") {
      const close = s.indexOf("`", this.i + 1)
      if (close < 0) {
        this.i = s.length
        return this.error(start, "an unclosed backtick: backticked text runs to the next backtick.", "NETWORK_PARSE")
      }
      const inner = s.slice(this.i + 1, close)
      this.i = close + 1
      // A backtick cannot be spelled INSIDE backticked text, so `a`b`c` is text that holds a backtick.
      if (this.i < s.length && (s[this.i] === "`" || isWordChar(s[this.i]))) {
        let stop = this.i
        while (stop < s.length && !isSpace(s[stop]) && s[stop] !== ";" && s[stop] !== "," && s[stop] !== ")") stop++
        this.i = stop
        return this.error(
          start,
          "backticked text containing a backtick: a backtick cannot be spelled inside backticks.",
          "NETWORK_UNSUPPORTED",
        )
      }
      return { kind: "backtick", text: inner, offset: start, length: this.i - start, atLineStart }
    }

    if (c === '"') return this.title(start, atLineStart)

    if (c === "?" && s[this.i + 1] === "?" && s[this.i + 2] === "?") {
      this.i += 3
      return { kind: "unnamed", text: "???", offset: start, length: 3, atLineStart }
    }

    if (c === "%") {
      ADDRESS_AT.lastIndex = this.i
      const m = ADDRESS_AT.exec(s)
      if (m !== null) {
        this.i += m[0].length
        return { kind: "address", text: m[0], offset: start, length: m[0].length, atLineStart }
      }
    }

    if (isWordChar(c)) {
      while (this.i < s.length && isWordChar(s[this.i])) this.i++
      // A typed literal: the word before `#` is its type or base (T#1S, 16#FF, DT#2020-01-01-12:00:00).
      if (s[this.i] === "#") {
        let j = this.i + 1
        while (j < s.length && (isWordChar(s[j]) || ".:+-".includes(s[j]!))) j++
        if (j > this.i + 1) {
          this.i = j
          return { kind: "typed", text: s.slice(start, j), offset: start, length: j - start, atLineStart }
        }
      }
      if (c >= "0" && c <= "9") {
        NUMBER_AT.lastIndex = start
        const m = NUMBER_AT.exec(s)!
        this.i = start + m[0].length
        return { kind: "number", text: m[0], offset: start, length: m[0].length, atLineStart }
      }
      // A dotted path is one operand token: `Mach1.GenFlags.Warning`, `T.Start`.
      while (this.i + 1 < s.length && s[this.i] === "." && isWordChar(s[this.i + 1])) {
        this.i++
        while (this.i < s.length && isWordChar(s[this.i])) this.i++
      }
      const word = s.slice(start, this.i)
      return { kind: "word", text: word, offset: start, length: word.length, atLineStart }
    }

    for (const sym of SYMS) {
      if (s.startsWith(sym, this.i)) {
        this.i += sym.length
        return { kind: "sym", text: sym, offset: start, length: sym.length, atLineStart }
      }
    }
    this.i++
    return { kind: "sym", text: c, offset: start, length: 1, atLineStart }
  }

  /** The next non-whitespace character, across lines, or undefined at the end. */
  peekChar(): string | undefined {
    let j = this.i
    while (j < this.s.length && isSpace(this.s[j])) j++
    return this.s[j]
  }

  /** Whether `=` — and not `=>` — is next, across layout. Asked after an `S` or `R` that follows a target. */
  equalsFollows(): boolean {
    let j = this.i
    while (j < this.s.length && isSpace(this.s[j])) j++
    return this.s[j] === "=" && this.s[j + 1] !== ">"
  }

  /** Whether `:=` or `=>` is next, across layout: the word before it is a PIN NAME. */
  pinOperatorFollows(): boolean {
    let j = this.i
    while (j < this.s.length && isSpace(this.s[j])) j++
    return (this.s[j] === ":" && this.s[j + 1] === "=") || (this.s[j] === "=" && this.s[j + 1] === ">")
  }

  /** The next non-blank character on the current line, or undefined at its end. */
  peekOnLine(): string | undefined {
    let j = this.i
    while (j < this.s.length && (this.s[j] === " " || this.s[j] === "\t" || this.s[j] === "\r")) j++
    return j < this.s.length && this.s[j] !== "\n" ? this.s[j] : undefined
  }

  /**
   * Whether the pair of parentheses that comes next holds an infix operator at its OWN depth — asked right after an
   * operator word, NOT or an edge word. Parentheses are structural: after `AND` a pair holding an operator is a group
   * (the word was the operator after an empty slot), any other pair is the word's argument list. Spacing plays no part.
   * Scanned on a fork through `Walk`, so backticks, titles and EXECUTE bodies inside the pair are skipped as the units
   * they are: an `AND` in a snippet's ST is not the pair's operator. Scanning raw tokens instead read that `AND` as one,
   * called the head an operator after an empty slot, and refused text the bridge's own writer emits.
   */
  pairAheadHoldsOperator(): boolean {
    const f = this.fork()
    const w = new Walk(f)
    if (!isSym(w.next(), "(")) return false
    for (;;) {
      const t = w.next()
      if (t.kind === "eof") return false
      if (isSym(t, ")") && w.depth === 0) return false
      // An operator word is an infix operator here unless it is a pin's name or a CALL HEAD — a word whose own pair
      // holds no operator (the same rule, one level down).
      if (
        w.depth === 1 &&
        isOperator(t) &&
        !(t.kind === "word" && (f.pinOperatorFollows() || (f.peekChar() === "(" && !f.pairAheadHoldsOperator())))
      )
        return true
    }
  }

  /**
   * An EXECUTE body: the rest of the current line must be blank; the body is every line after it up to the first line
   * whose first word is `END_EXECUTE`, verbatim. Returns the snippet and the `END_EXECUTE` word, or an error token.
   */
  executeBody(): { snippet: Tok; end: Tok } {
    const s = this.s
    const eol = this.lineEnd(this.i)
    if (s.slice(this.i, eol).trim().length !== 0) {
      const at = this.i
      this.i = eol
      const e = this.error(at, "an EXECUTE body starts on the line after EXECUTE; nothing may follow it on its own line.", "NETWORK_PARSE")
      return { snippet: e, end: e }
    }
    const bodyStart = Math.min(eol + 1, s.length)
    const lines: string[] = []
    let loneCr: number | undefined
    let k = bodyStart
    while (k < s.length) {
      const end = this.lineEnd(k)
      const line = withoutLayoutCr(s.slice(k, end))
      const m = END_EXECUTE.exec(line)
      if (m !== null) {
        const wordAt = k + line.indexOf(m[1]!)
        this.i = wordAt + "END_EXECUTE".length
        if (loneCr !== undefined) {
          const e = this.loneCr(loneCr)
          return { snippet: e, end: e }
        }
        return {
          snippet: { kind: "snippet", text: lines.join("\n"), offset: bodyStart, length: wordAt - bodyStart, atLineStart: true },
          end: { kind: "word", text: s.slice(wordAt, wordAt + 11), offset: wordAt, length: 11, atLineStart: true },
        }
      }
      const at = line.indexOf("\r")
      if (at >= 0 && loneCr === undefined) loneCr = k + at
      lines.push(line)
      k = end + 1
    }
    const err = this.error(
      eol,
      "an EXECUTE body with no END_EXECUTE: the body ends at the first line whose first word is END_EXECUTE.",
      "NETWORK_PARSE",
    )
    this.i = s.length
    return { snippet: err, end: err }
  }

  private title(start: number, atLineStart: boolean): Tok {
    const s = this.s
    let out = ""
    this.i++
    for (;;) {
      if (this.i >= s.length || s[this.i] === "\n" || s[this.i] === "\r")
        return this.error(
          start,
          "an unclosed TITLE string: a title ends at its closing quote, on the header's line (a newline inside it is $N).",
          "NETWORK_PARSE",
        )
      const c = s[this.i]!
      if (c === '"') {
        this.i++
        break
      }
      if (c === "$") {
        // ST's string escapes, the ones the writer writes: $N, $R, $", $$.
        const e = s[this.i + 1]
        const v = e === "N" || e === "n" ? "\n" : e === "R" || e === "r" ? "\r" : e === '"' ? '"' : e === "$" ? "$" : undefined
        this.i += 2
        if (v === undefined)
          return this.error(start, `the escape '$${e ?? ""}' in a TITLE: a title spells $N, $R, $" and $$ only.`, "NETWORK_PARSE")
        out += v
        continue
      }
      out += c
      this.i++
    }
    return { kind: "string", text: out, offset: start, length: this.i - start, atLineStart }
  }

  private loneCr(at: number): Tok {
    return {
      kind: "error",
      text: "a lone carriage return (CR without LF) in a comment or EXECUTE line: a line ends at LF, and a CR is layout only right before one.",
      offset: at,
      length: 1,
      atLineStart: this.atLineStart(at),
      code: "NETWORK_PARSE",
    }
  }

  private error(start: number, message: string, code: string): Tok {
    return { kind: "error", text: message, offset: start, length: Math.max(1, this.i - start), atLineStart: this.atLineStart(start), code }
  }

  private atLineStart(offset: number): boolean {
    for (let k = offset - 1; k >= 0; k--) {
      if (this.s[k] === "\n") return true
      if (!isSpace(this.s[k])) return false
    }
    return true
  }

  private lineEnd(from: number): number {
    const e = this.s.indexOf("\n", from)
    return e < 0 ? this.s.length : e
  }
}

/**
 * The tokens of a text as the reader consumes them, without reading it — the bridge's `NetworkLexer.Walk`. Every
 * EXECUTE body is entered where the reader enters one: at an `EXECUTE` that is no pin's name, no `JMP` label and no
 * header `LABEL:`, right after it or after the pin list `(EN := …)` that follows it (however deep that list nests
 * another EXECUTE), and comes out as its snippet and its `END_EXECUTE`. So an ST line inside a snippet is never lexed
 * as network tokens by a look-ahead.
 */
export class Walk {
  /** Open parentheses after the last token returned. */
  depth = 0
  /** The depth an `EXECUTE(EN := …)` head's pair closes back to. */
  private readonly executeAt: number[] = []
  private readonly body: Tok[] = []
  // The two tokens returned before the one in hand: a LABEL's name follows `LABEL :`, a jump's follows `JMP`.
  private before: Tok | undefined
  private last: Tok | undefined

  constructor(private readonly lx: NetworkLexer) {}

  next(): Tok {
    const t = this.body.length > 0 ? this.body.shift()! : this.lexed()
    this.before = this.last
    this.last = t
    return t
  }

  private lexed(): Tok {
    const t = this.lx.next()
    if (isSym(t, "(")) this.depth++
    else if (isSym(t, ")")) {
      this.depth--
      if (this.executeAt.length > 0 && this.executeAt[this.executeAt.length - 1] === this.depth) {
        this.executeAt.pop()
        this.enterBody()
      }
    }
    // In VALUE position only, as the reader opens one: a pin's name (`execute :=`) and a label (`LABEL: Execute`,
    // `JMP Execute`) open no body.
    else if (
      isWord(t, "EXECUTE") &&
      !this.lx.pinOperatorFollows() &&
      !(this.last !== undefined && isWord(this.last, "JMP")) &&
      !(this.last !== undefined && isSym(this.last, ":") && this.before !== undefined && isWord(this.before, "LABEL"))
    ) {
      if (this.lx.peekOnLine() === "(") this.executeAt.push(this.depth)
      else this.enterBody()
    }
    return t
  }

  private enterBody(): void {
    const { snippet, end } = this.lx.executeBody()
    this.body.push(snippet)
    // An error has consumed its text and the lexer goes on from it, as the reader's recovery does.
    if (snippet.kind !== "error") this.body.push(end)
  }
}

/** A line's text without the CR of a CR LF, which is the file's layout — ONE CR. */
function withoutLayoutCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line
}
