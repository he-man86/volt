/**
 * THE EXECUTE BOX'S ST in network text: `EXECUTE(EN := e, '<ST>')`, its ST one string, its last pin, line breaks as they stand, `$'` a quote and `$$` a dollar (the bridge's `StNetworkReader` /
 * `NetworkSpelling.UnescapeCode`). `plain-st.ts` reads the network; this module is the string: rejoined across its lines,
 * found as the box's last pin, and read as the ST tokens it holds.
 */
import { lex } from "../lex/lexer.js"
import { isTrivia, type Token } from "../lex/tokens.js"
import type { Dialect } from "../lex/vocabulary.js"
import type { Span } from "../span.js"

/** The Execute box's call head: `EXECUTE(EN := c, '<ST>')`. */
export const EXECUTE = "EXECUTE"

/**
 * THE ONE STRING THAT SPANS LINES: an Execute box holds its ST as `EXECUTE(EN := e, '<ST>')`, its line breaks as they
 * stand (the bridge's `StNetworkReader.Lex`). The lexer ends every string at its line — IEC's rule, and every ST body's —
 * so the ST string is rejoined HERE, in a network body only, where it stands as a positional pin of an open `EXECUTE(`
 * call: from the body's own tokens up to its closing quote (`$'` a quote, `$$` a
 * dollar), the rest of the body lexed again after it. One not closed runs to the BODY's end, no further, and is "an
 * unclosed string", as the bridge's reader refuses it — the units after the body keep their own analysis.
 */
export function joinCodeStrings(tokens: readonly Token[], dialect: Dialect, unicodeIdentifiers: boolean): { tokens: Token[]; unclosed: Span[] } {
  const out = [...tokens]
  const unclosed: Span[] = []
  const heads: (Token | undefined)[] = []
  let last: Token | undefined
  for (let i = 0; i < out.length; i++) {
    const t = out[i]!
    if (isTrivia(t.kind) || t.kind === "eof") continue
    if (t.kind === "string_lit" && !closedString(t.text) && (last?.text === "(" || last?.text === ",") &&
        heads.at(-1)?.text.toUpperCase() === EXECUTE) {
      const joined = rejoin(out, i, dialect, unicodeIdentifiers)
      out.splice(i, out.length - i, ...joined.tokens)
      if (!joined.closed) unclosed.push(out[i]!.span)
    }
    if (t.kind === "punct" && t.text === "(") heads.push(last !== undefined && (last.kind === "identifier" || last.kind === "keyword") ? last : undefined)
    if (t.kind === "punct" && t.text === ")") heads.pop()
    last = out[i]
  }
  return { tokens: out, unclosed }
}

/** The string opening at `tokens[at]`, read across lines to its closing quote (or to the body's end), and the body's
 *  tokens after it lexed again, each where it stands. */
function rejoin(tokens: readonly Token[], at: number, dialect: Dialect, unicodeIdentifiers: boolean): { tokens: Token[]; closed: boolean } {
  const first = tokens[at]!
  let src = ""
  let pos = first.span.start
  let k = at
  for (; k < tokens.length && tokens[k]!.kind !== "eof"; k++) {
    const t = tokens[k]!
    if (t.span.start !== pos) throw new Error(`network text: the body's tokens leave a gap at offset ${pos}`)
    src += t.text
    pos = t.span.end
  }
  let p = 1
  let closed = false
  while (p < src.length) {
    if (src[p] === "$") p += 2
    else if (src[p++] === "'") {
      closed = true
      break
    }
  }
  p = Math.min(p, src.length)
  let line = first.span.startLine
  let col = first.span.startCol
  for (let c = 0; c < p; c++) {
    if (src[c] === "\n") {
      line++
      col = 0
    } else col++
  }
  const string: Token = { kind: "string_lit", text: src.slice(0, p), span: { start: first.span.start, end: first.span.start + p, startLine: first.span.startLine, startCol: first.span.startCol, endLine: line, endCol: col } }
  const base = first.span.start + p
  const rest = lex(src.slice(p), dialect, unicodeIdentifiers)
    .filter((t) => t.kind !== "eof")
    .map((t) => ({ ...t, span: {
      start: base + t.span.start,
      end: base + t.span.end,
      startLine: line + t.span.startLine - 1,
      startCol: t.span.startLine === 1 ? col + t.span.startCol : t.span.startCol,
      endLine: line + t.span.endLine - 1,
      endCol: t.span.endLine === 1 ? col + t.span.endCol : t.span.endCol,
    } }))
  return { tokens: [string, ...rest, ...tokens.slice(k)], closed }
}

/** Does a string token end in its closing quote (not at its line's end), each `$` escape two characters? */
export function closedString(text: string): boolean {
  for (let i = 1; i < text.length; i++) {
    if (text[i] === "$") i++
    else if (text[i] === text[0]) return i === text.length - 1
  }
  return false
}

/** The string at `tokens[at]`, the last pin of an open `EXECUTE(` call, positional: its index; undefined for anything else
 *  (a string pin of another call, or not last, is an ordinary pin, which the network check refuses on an Execute box). */
export function codeAt(tokens: readonly Token[], at: number, calls: readonly { head: Token | undefined }[]): { string: number } | undefined {
  const t = tokens[at]!
  if (t.kind !== "string_lit") return undefined
  if (calls.at(-1)?.head?.text.toUpperCase() !== EXECUTE) return undefined
  let before = at - 1
  while (before >= 0 && isTrivia(tokens[before]!.kind)) before--
  let after = at + 1
  while (after < tokens.length && isTrivia(tokens[after]!.kind)) after++
  const opens = tokens[before]?.text === "(" || tokens[before]?.text === ","
  return opens && tokens[after]?.text === ")" ? { string: at } : undefined
}

/** The span of a string token's content, inside its quotes. */
export function contentSpan(t: Token): Span {
  const closed = t.text.length >= 2 && t.text.endsWith("'")
  const [startLine, startCol] = [t.span.startLine, t.span.startCol + 1]
  const end = closed ? t.span.end - 1 : t.span.end
  const endCol = closed ? t.span.endCol - 1 : t.span.endCol
  return { start: t.span.start + 1, end, startLine, startCol, endLine: t.span.endLine, endCol }
}

/**
 * The Execute box's ST, as tokens where each stands in the source: the string's content decoded — `$'` a quote, `$$` a
 * dollar, everything else as it stands (`StNetworkReader` / `NetworkSpelling.UnescapeCode`, one spelling per code) — lexed,
 * each span mapped back through the escapes. Any other `$` answers the refusal, in the bridge's words.
 */
export function codeTokens(string: Token, dialect: Dialect, unicodeIdentifiers: boolean, what = "the Execute box's ST"): { tokens: Token[]; st: string } | string {
  const raw = string.text.slice(1, string.text.length >= 2 && string.text.endsWith("'") ? -1 : undefined)
  let decoded = ""
  const at: number[] = [] // decoded index → raw index
  for (let i = 0; i < raw.length; i++) {
    at.push(i)
    if (raw[i] !== "$") {
      decoded += raw[i]
      continue
    }
    const e = raw[i + 1]
    if (e !== "$" && e !== "'")
      return e === undefined
        ? `a \`$\` at the end of ${what}: a \`$\` is written \`$$\``
        : `the escape '$${e}' in ${what}: its ${what.endsWith("ST") ? "code" : "text"} spells a ' as $' and a $ as $$, and everything else as it stands`
    decoded += e
    i++
  }
  at.push(raw.length)
  // the line and column of each raw offset, from the string's first content character
  const lines: number[] = []
  const cols: number[] = []
  let line = string.span.startLine
  let col = string.span.startCol + 1
  for (let i = 0; i <= raw.length; i++) {
    lines.push(line)
    cols.push(col)
    if (raw[i] === "\n") {
      line++
      col = 0
    } else col++
  }
  const base = string.span.start + 1
  const map = (offset: number) => at[offset]!
  const tokens = lex(decoded, dialect, unicodeIdentifiers)
    .filter((t) => t.kind !== "eof")
    .map((t) => {
      const s = map(t.span.start)
      const e = map(t.span.end)
      return { ...t, span: { start: base + s, end: base + e, startLine: lines[s]!, startCol: cols[s]!, endLine: lines[e]!, endCol: cols[e]! } }
    })
  return { tokens, st: decoded }
}

/** The Execute box's `'…'` at `tokens[at..string]` taken: trivia in the statement tokens (its `,` before it too),
 *  its ST's tokens pending after its statement, a bad escape a finding, and the call's code and ST recorded. */
export function takeCode(
  tokens: readonly Token[],
  at: number,
  string: number,
  dialect: Dialect,
  unicodeIdentifiers: boolean,
  into: { out: Token[]; pending: Token[]; stray: { message: string; span: Span }[]; call: { code?: Span; st?: string } },
): void {
  const { out } = into
  let p = out.length - 1
  while (p >= 0 && isTrivia(out[p]!.kind)) p--
  if (out[p]?.text === ",") out[p] = { ...out[p]!, kind: "whitespace", keyword: undefined }
  for (let k = at; k <= string; k++) out.push({ ...tokens[k]!, kind: "whitespace", keyword: undefined })
  const st = codeTokens(tokens[string]!, dialect, unicodeIdentifiers)
  if (typeof st === "string") into.stray.push({ message: st, span: tokens[string]!.span })
  else into.pending.push(...st.tokens)
  into.call.code = contentSpan(tokens[string]!)
  into.call.st = typeof st === "string" ? undefined : st.st
}
