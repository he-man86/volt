/**
 * The network-text lexer — a port of the bridge's `NetworkLexer` (`volt-cli/src/Volt.Engine/Format/Network/NetworkLexer.cs`,
 * openspec ld-fbd-coverage 2R.6b, `v2-spec.md`), so the editor reads a body token for token as the push does. It runs over
 * the body's RAW text, not over the ST lexer's tokens, because the two languages cut text differently where it matters: a
 * dotted path is one token here (`Mach1.GenFlags.Warning`), `???` is one token, `S=` and `R=` are one token each, a `//`
 * line is a comment whose text is what follows `//` and one space (IEC's `$` escapes decoded), a negative literal is the
 * minus TOUCHING its digit (`-1`), and an EXECUTE body is verbatim ST from the line after `EXECUTE` to the first line whose
 * first word is `END_EXECUTE`. Newlines are otherwise layout.
 *
 * A lexical error is a token that has consumed its text, never an exception, as in the bridge.
 */
import { unescapeText } from "./words.js"

export interface Tok {
  kind:
    | "word" // an identifier or dotted path
    | "number" // 5, 1.5, -1
    | "typed" // T#1S, 16#FF
    | "address" // %IX0.0
    | "unnamed" // ???
    | "backtick" // text = the content between the backticks, a doubled backtick and the `$` escapes decoded
    | "dstring" // a double-quoted string as written (quotes included): a TITLE, or a WSTRING literal
    | "sstring" // a single-quoted ST string as written (quotes included)
    | "comment" // a // line; text = what follows `//` and one space, its escapes decoded
    | "hash" // `#3f9a01c2` after an UNSUPPORTED line's shape; text = the hex digits
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
// BY NAME ("write ADD / GT / …"), never as a stray character.
const SYMS = [":=", "=>", "<=", ">=", "<>", "(", ")", ",", ";", ":", ".", "=", "<", ">", "+", "-", "*", "/", "{", "}"]

// ASCII only, as the bridge's patterns are: a letter or digit outside ASCII is no character of a bare token.
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c)
const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c)
const isHex = (c: string | undefined): boolean => c !== undefined && /[0-9A-Fa-f]/.test(c)

export class NetworkLexer {
  i: number
  private readonly lineStarts: number[] = [0]

  constructor(
    readonly s: string,
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

  /** The 0-based column `offset` stands at. */
  columnOf(offset: number): number {
    return offset - this.lineStarts[this.lineOf(offset)]!
  }

  /** Every token from the lexer's position to the end, EXECUTE bodies taken by the walk's rule (`Walk`). */
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
    if (c === "#") {
      let j = this.i + 1
      while (j < s.length && isHex(s[j])) j++
      this.i = j
      return { kind: "hash", text: s.slice(start + 1, j), offset: start, length: j - start, atLineStart }
    }
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
    // A negative literal is the minus TOUCHING the digit, `-1`; `- 1`, `-x` and `+1` stay symbols the parser refuses.
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

  /** A `//` line: `//` and ONE space are syntax; the rest is the comment's text, its escapes decoded. */
  private comment(start: number, atLineStart: boolean): Tok {
    this.i += 2
    const end = this.lineEnd(this.i)
    let text = withoutLayoutCr(this.s.slice(this.i, end))
    this.i = end
    if (text.includes("\r")) return this.loneCr(start)
    if (text.startsWith(" ")) text = text.slice(1)
    const decoded = unescapeText(text)
    if ("error" in decoded)
      return { kind: "error", text: decoded.error, offset: start, length: end - start, atLineStart, code: "NETWORK_PARSE" }
    return { kind: "comment", text: decoded.value, offset: start, length: end - start, atLineStart }
  }

  /** Backticked text runs to the next lone backtick on its line; a doubled one is a backtick of the text, and `$` escapes
   *  as in every delimited text. */
  private backticked(start: number, atLineStart: boolean): Tok {
    const s = this.s
    const eol = this.lineEnd(this.i)
    let j = this.i + 1
    let raw = ""
    for (;;) {
      if (j >= eol) {
        this.i = eol
        return this.error(start, "an unclosed backtick: backticked text runs to the next backtick, on its line.", "NETWORK_PARSE")
      }
      if (s[j] === "`") {
        if (j + 1 < eol && s[j + 1] === "`") {
          raw += "`"
          j += 2
          continue
        }
        break
      }
      raw += s[j]
      j++
    }
    this.i = j + 1
    const inner = unescapeText(raw)
    if ("error" in inner) return this.error(start, inner.error, "NETWORK_PARSE")
    return { kind: "backtick", text: inner.value, offset: start, length: this.i - start, atLineStart }
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

  /** A run of word characters: a typed literal, a number, `S=` / `R=`, or a word — a dotted path is one word. */
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
    // `S=` and `R=` are single tokens: the set and reset coils.
    if ((word === "S" || word === "R" || word === "s" || word === "r") && s[this.i] === "=" && s[this.i + 1] !== ">") {
      this.i++
      return { kind: "sym", text: word.toUpperCase() + "=", offset: start, length: 2, atLineStart }
    }
    return { kind: "word", text: word, offset: start, length: word.length, atLineStart }
  }

  /** An EXECUTE body, from the lexer standing at the end of the `EXECUTE` line: its lines verbatim up to the first line
   *  whose first word is `END_EXECUTE`, and that word as a token of its own. A lone CR is refused, as in a comment. */
  executeBody(): { snippet: Tok; end: Tok } {
    const s = this.s
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
 * THE ONE WALK OVER THE TEXT'S TOKENS, raw mode included (the bridge's `NetworkLexer.Walk`): `EXECUTE` ends its line, and
 * its body starts on the next one, up to the first line whose first word is `END_EXECUTE`. The header's `LABEL: Execute`
 * and `JMP Execute` open none. A token after `EXECUTE` on its line is an error token.
 */
class Walk {
  private readonly queued: Tok[] = []
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
    const t = this.lx.next()
    if (isWord(t, "EXECUTE") && !(this.last !== undefined && isWord(this.last, "JMP")) &&
        !(this.last !== undefined && isSym(this.last, ":") && this.before !== undefined && isWord(this.before, "LABEL"))) {
      const eol = this.lx.lineEnd(t.offset)
      let j = this.lx.i
      while (j < eol && isSpace(this.lx.s[j])) j++
      if (j < eol) {
        this.lx.i = eol
        this.queued.push({
          kind: "error",
          text: "EXECUTE ends its line: its ST starts on the next line, and END_EXECUTE ends it.",
          offset: j,
          length: eol - j,
          atLineStart: false,
          code: "NETWORK_PARSE",
        })
        return t
      }
      this.lx.i = eol
      const { snippet, end } = this.lx.executeBody()
      this.queued.push(snippet)
      if (snippet.kind !== "error") this.queued.push(end)
    }
    return t
  }
}

/** A line's text without the CR of a CR LF, which is the file's layout — ONE CR. */
function withoutLayoutCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line
}

/** A TITLE's value: the double-quoted token, IEC's escapes decoded (`NetworkLexer.DecodeTitle`). */
export function decodeTitle(quoted: string): { value: string } | { error: string } {
  return unescapeText(quoted.slice(1, -1))
}
