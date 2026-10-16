/**
 * The network-text lexer — a port of the bridge's `NetworkLexer` (`volt-cli/src/Volt.Engine/Format/Network/NetworkLexer.cs`,
 * openspec ld-fbd-coverage 2R.3, `readability.md`), so the editor reads a body token for token as the push does. It runs
 * over the body's RAW text, not over the ST lexer's tokens, because the two languages cut text differently where it
 * matters: a dotted path is one token here (`Mach1.GenFlags.Warning`), `???` is one token, a `//` line is a comment whose
 * text is what follows `//` and one space, a negative literal is the minus TOUCHING its digit (`-1`), and an EXECUTE body
 * is verbatim ST from the line after `EXECUTE [EN [c]]` to the first line whose first word is `END_EXECUTE` (P8).
 *
 * A lexical error is a token that has consumed its text, never an exception, as in the bridge.
 */

export interface Tok {
  kind:
    | "word" // an identifier or dotted path
    | "number" // 5, 1.5, -1
    | "typed" // T#1S, 16#FF
    | "address" // %IX0.0
    | "unnamed" // ???
    | "backtick" // text = the verbatim content between the backticks
    | "dstring" // a double-quoted string as written (quotes included): a TITLE, or a WSTRING literal
    | "sstring" // a single-quoted ST string as written (quotes included)
    | "comment" // a // line; text = what follows `//` and one space
    | "snippet" // an EXECUTE body; text = its lines joined by \n
    | "sym" // punctuation and operators
    | "error" // text = message, code = its NETWORK_* code
    | "eof"
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

// Longest first: `:=` before `:`, `<=` / `<>` before `<`. The ST operator symbols are lexed so the parser can refuse them
// BY NAME (P12: "write ADD / GT / …"), never as a stray character.
const SYMS = [":=", "=>", "<=", ">=", "<>", "(", ")", ",", ";", ":", ".", "=", "<", ">", "+", "-", "*", "/", "{", "}"]

// ASCII only, as the bridge's patterns are: a letter or digit outside ASCII is no character of a bare token.
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c)
const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c)

export class NetworkLexer {
  private i: number
  private readonly lineStarts: number[] = [0]

  constructor(
    private readonly s: string,
    start: number,
  ) {
    this.i = start
    for (let k = 0; k < s.length; k++) if (s[k] === "\n") this.lineStarts.push(k + 1)
  }

  /** The 0-based line `offset` stands on. */
  lineOf(offset: number): number {
    let lo = 0
    let hi = this.lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.lineStarts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** Every token from the lexer's position to the end, EXECUTE bodies taken by the walk's rule (`walk`). */
  tokenize(): Tok[] {
    const all: Tok[] = []
    const w = new Walk(this)
    for (;;) {
      const t = w.next()
      all.push(t)
      if (t.kind === "eof") return all
    }
  }

  next(): Tok {
    const s = this.s
    while (this.i < s.length && isSpace(s[this.i])) this.i++
    if (this.i >= s.length) return { kind: "eof", text: "", offset: s.length, length: 0, atLineStart: true }

    const start = this.i
    const atLineStart = this.atLineStart(start)
    const c = s[this.i]!
    if (c === "/" && s[this.i + 1] === "/") return this.comment(start, atLineStart)
    if (c === "`") return this.backticked(start, atLineStart)
    if (c === '"' || c === "'") return this.quoted(start, atLineStart, c)
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
    // P12: a negative literal is the minus TOUCHING the digit, `-1`; `- 1`, `-x` and `+1` stay symbols the parser refuses.
    if (c === "-" && s[this.i + 1] !== undefined && /[0-9]/.test(s[this.i + 1]!)) {
      NUMBER_AT.lastIndex = this.i + 1
      const m = NUMBER_AT.exec(s)!
      this.i += 1 + m[0].length
      if (s[this.i] === "#") return this.typedRest(start, atLineStart)
      return { kind: "number", text: s.slice(start, this.i), offset: start, length: this.i - start, atLineStart }
    }
    if (isWordChar(c)) return this.wordLike(start, atLineStart)
    for (const sym of SYMS)
      if (s.startsWith(sym, this.i)) {
        this.i += sym.length
        return { kind: "sym", text: sym, offset: start, length: sym.length, atLineStart }
      }
    this.i++
    return { kind: "sym", text: c, offset: start, length: 1, atLineStart }
  }

  /** A `//` line: `//` and ONE space are syntax; the rest — indentation, trailing spaces — is the comment's text (P10). */
  private comment(start: number, atLineStart: boolean): Tok {
    this.i += 2
    const end = this.lineEnd(this.i)
    let text = withoutLayoutCr(this.s.slice(this.i, end))
    this.i = end
    if (text.includes("\r")) return this.loneCr(start)
    if (text.startsWith(" ")) text = text.slice(1)
    return { kind: "comment", text, offset: start, length: end - start, atLineStart }
  }

  /** Backticked text, verbatim up to the next backtick on its line. */
  private backticked(start: number, atLineStart: boolean): Tok {
    const s = this.s
    const close = s.indexOf("`", this.i + 1)
    const eol = this.lineEnd(this.i)
    if (close < 0 || close > eol) {
      this.i = eol
      return this.error(start, "an unclosed backtick: backticked text runs to the next backtick, on its line.", "NETWORK_PARSE")
    }
    const inner = s.slice(this.i + 1, close)
    this.i = close + 1
    // A backtick cannot be spelled INSIDE backticked text, so `a`b`c` is text that holds a backtick.
    if (this.i < s.length && (s[this.i] === "`" || isWordChar(s[this.i]))) {
      let stop = this.i
      while (stop < s.length && !isSpace(s[stop]) && s[stop] !== ";" && s[stop] !== "," && s[stop] !== ")") stop++
      this.i = stop
      return this.error(start, "backticked text containing a backtick: a backtick cannot be spelled inside backticks.", "NETWORK_UNSUPPORTED")
    }
    return { kind: "backtick", text: inner, offset: start, length: this.i - start, atLineStart }
  }

  /** A quoted string, kept AS WRITTEN (quotes and `$` escapes included); it ends at its closing quote on its line. */
  private quoted(start: number, atLineStart: boolean, quote: string): Tok {
    const s = this.s
    this.i++
    for (;;) {
      if (this.i >= s.length || s[this.i] === "\n" || s[this.i] === "\r")
        return this.error(
          start,
          quote === '"'
            ? "an unclosed double-quoted string: it ends at its closing quote, on its line (a newline inside a TITLE is $N)."
            : "an unclosed string literal: it ends at its closing quote, on its line.",
          "NETWORK_PARSE",
        )
      const c = s[this.i]
      if (c === quote) {
        this.i++
        break
      }
      if (c === "$") {
        this.i += this.i + 1 < s.length && s[this.i + 1] !== "\n" ? 2 : 1
        continue
      }
      this.i++
    }
    return { kind: quote === '"' ? "dstring" : "sstring", text: s.slice(start, this.i), offset: start, length: this.i - start, atLineStart }
  }

  private typedRest(start: number, atLineStart: boolean): Tok {
    const s = this.s
    let j = this.i + 1
    while (j < s.length && (isWordChar(s[j]) || ".:+-".includes(s[j]!))) j++
    if (j === this.i + 1) {
      this.i = j
      return this.error(start, "a typed literal with nothing after its `#`.", "NETWORK_PARSE")
    }
    this.i = j
    return { kind: "typed", text: s.slice(start, this.i), offset: start, length: this.i - start, atLineStart }
  }

  /** A run of word characters: a typed literal, a number, or a word — a dotted path is one word. */
  private wordLike(start: number, atLineStart: boolean): Tok {
    const s = this.s
    const c = s[start]!
    while (this.i < s.length && isWordChar(s[this.i])) this.i++
    if (s[this.i] === "#") return this.typedRest(start, atLineStart)
    if (c >= "0" && c <= "9") {
      NUMBER_AT.lastIndex = start
      const m = NUMBER_AT.exec(s)!
      this.i = start + m[0].length
      return { kind: "number", text: m[0], offset: start, length: m[0].length, atLineStart }
    }
    while (this.i + 1 < s.length && s[this.i] === "." && isWordChar(s[this.i + 1])) {
      this.i++
      while (this.i < s.length && isWordChar(s[this.i])) this.i++
    }
    const word = s.slice(start, this.i)
    return { kind: "word", text: word, offset: start, length: word.length, atLineStart }
  }

  /** An EXECUTE body, from the lexer standing at the end of the `EXECUTE` line: its lines verbatim up to the first line
   *  whose first word is `END_EXECUTE`, and that word as a token of its own. A lone CR is refused, as in a comment. */
  executeBody(at: number): { snippet: Tok; end: Tok } {
    const s = this.s
    this.i = at
    const eol = this.lineEnd(this.i)
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
          snippet: { kind: "snippet", text: lines.join("\n"), offset: bodyStart, length: Math.max(0, wordAt - bodyStart), atLineStart: true },
          end: { kind: "word", text: s.slice(wordAt, wordAt + 11), offset: wordAt, length: 11, atLineStart: true },
        }
      }
      const cr = line.indexOf("\r")
      if (cr >= 0 && loneCr === undefined) loneCr = k + cr
      lines.push(line)
      k = end + 1
    }
    const err = this.error(eol, "an EXECUTE body with no END_EXECUTE: the body ends at the first line whose first word is END_EXECUTE.", "NETWORK_PARSE")
    this.i = s.length
    return { snippet: err, end: err }
  }

  /** The position of the next non-blank character, across lines. */
  nextNonSpace(): number {
    let j = this.i
    while (j < this.s.length && isSpace(this.s[j])) j++
    return j
  }

  get length(): number {
    return this.s.length
  }

  lineEnd(from: number): number {
    const e = this.s.indexOf("\n", from)
    return e < 0 ? this.s.length : e
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
}

/**
 * THE ONE WALK OVER THE TEXT'S TOKENS, raw mode included (the bridge's `NetworkLexer.Walk`): `EXECUTE` in value position
 * opens a body at the END OF ITS LINE (P8: `EXECUTE [EN [c]]` ends at its line) — the header's `LABEL: Execute` and
 * `JMP Execute` open none.
 */
class Walk {
  private readonly queued: Tok[] = []
  private bodyAt: number | undefined
  private before: Tok | undefined
  private last: Tok | undefined

  constructor(private readonly lx: NetworkLexer) {}

  next(): Tok {
    const t = this.queued.length > 0 ? this.queued.shift()! : this.lexed()
    this.before = this.last
    this.last = t
    return t
  }

  private lexed(): Tok {
    if (this.bodyAt !== undefined) {
      const j = this.lx.nextNonSpace()
      if (j > this.bodyAt || j >= this.lx.length) {
        const at = this.bodyAt
        this.bodyAt = undefined
        const { snippet, end } = this.lx.executeBody(at)
        if (snippet.kind !== "error") this.queued.push(end)
        return snippet
      }
    }
    const t = this.lx.next()
    if (isWord(t, "EXECUTE") && !(this.last !== undefined && isWord(this.last, "JMP")) &&
        !(this.last !== undefined && isSym(this.last, ":") && this.before !== undefined && isWord(this.before, "LABEL")))
      this.bodyAt = this.lx.lineEnd(t.offset)
    return t
  }
}

/** A line's text without the CR of a CR LF, which is the file's layout — ONE CR. */
function withoutLayoutCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line
}

/** A TITLE's value: the double-quoted token decoded with the escapes the writer writes — `$N`, `$R`, `$"`, `$$`
 *  (`NetworkLexer.DecodeTitle`); an error message for any other escape. */
export function decodeTitle(quoted: string): { value: string } | { error: string } {
  let out = ""
  for (let i = 1; i < quoted.length - 1; i++) {
    const c = quoted[i]!
    if (c !== "$") {
      out += c
      continue
    }
    const e = i + 1 < quoted.length - 1 ? quoted[i + 1]! : ""
    const v = e === "N" || e === "n" ? "\n" : e === "R" || e === "r" ? "\r" : e === '"' ? '"' : e === "$" ? "$" : undefined
    if (v === undefined) return { error: `the escape '$${e}' in a TITLE: a title spells $N, $R, $" and $$ only.` }
    out += v
    i++
  }
  return { value: out }
}
