/**
 * THE TARGETS OF A PLAIN-ST NETWORK BODY'S CODE (`plain-st.ts` reads the body): a jump and the return written as an
 * ASSIGN's target (`ASSIGN(v, Q => JMP.l)`, `ASSIGN(v, Q => RETURN)`) read their keyword as a name, so the ST parser reads
 * an output binding; and a mark WORD standing before a name (`NOT a`, `NOT y := a`, `t1(RISING IN := a)`, `y := NOT := a`),
 * which the text does not have: a mark is a function (`INVERT(a)`, `RISING(a)`) or, on a receiver, its output name
 * (`Q_INVERTED => y`). The word is refused by name and read as trivia, so the rest of its statement still reads.
 */
import { isTrivia, type Token } from "../lex/tokens.js"
import type { Span } from "../span.js"
import { percentKeyAt } from "./network-lines.js"

/** The one form of a jump and the return: an ASSIGN's target (the bridge's reader's words). */
export const CONTROL_FORM = "a jump or a return is a target of an ASSIGN: ASSIGN(value, Q => JMP.label); ASSIGN(value, Q => RETURN); (on the rail, RAIL() as its value)"

/** A mark word before a value or a receiver (the bridge's reader's words). */
const MARK_FORM = "a mark is a function around a value, INVERT(a), RISING(a), FALLING(a); on a receiver it is in the output's name, Q_INVERTED => y. NOT(a) is the NOT box"

/** A mark word before a pin (the bridge's reader's words). */
const PIN_MARK_FORM = "a mark before a pin: a pin's mark is a function around its value, IN := INVERT(a), and an output's is in its name, Q_INVERTED => x"

/** The words that once marked a value or a receiver. */
const MARK_WORDS: ReadonlySet<string> = new Set(["NOT", "RISING", "FALLING"])

/** The index of the first token after `k` that is no trivia. */
function nextWord(tokens: readonly Token[], k: number): number {
  let n = k + 1
  while (n < tokens.length && isTrivia(tokens[n]!.kind)) n++
  return n
}

/** The index of the first token before `k` that is no trivia, or -1. */
function prevWord(tokens: readonly Token[], k: number): number {
  let n = k - 1
  while (n >= 0 && isTrivia(tokens[n]!.kind)) n--
  return n
}

const isPunct = (t: Token | undefined, text: string): boolean => t?.kind === "punct" && t.text.toUpperCase() === text

/** Is `tokens[k]` a mark word heading no call (`NOT a`, not the NOT box `NOT(a)`)? */
function isMarkWord(tokens: readonly Token[], k: number): boolean {
  const t = tokens[k]
  return t !== undefined && (t.kind === "keyword" || t.kind === "identifier") && MARK_WORDS.has(t.text.toUpperCase()) &&
    !isPunct(tokens[nextWord(tokens, k)], "(")
}

/** Does `tokens[k]` stand on a `%` line (`%NETWORK`, …), no code? */
function onPercentLine(tokens: readonly Token[], k: number): boolean {
  let first = k
  for (let n = prevWord(tokens, k); n >= 0 && tokens[n]!.span.startLine === tokens[k]!.span.startLine; n = prevWord(tokens, n)) first = n
  return percentKeyAt(tokens, first) !== undefined
}

/** Is the `:=` at `k` an EMPTY receiver name — after `(`, `,` or an assignment operator, past the mark words before it?
 *  The number of those marks; undefined for any other `:=`. */
function emptyName(tokens: readonly Token[], k: number): number | undefined {
  let p = prevWord(tokens, k)
  let marks = 0
  while (p >= 0 && isMarkWord(tokens, p)) {
    marks++
    p = prevWord(tokens, p)
  }
  if (p < 0 || onPercentLine(tokens, p)) return undefined
  const t = tokens[p]
  if (isPunct(t, ":=") || isPunct(t, "S=") || isPunct(t, "R=")) return marks > 0 ? marks : undefined
  return isPunct(t, "(") || isPunct(t, ",") ? marks : undefined
}

/** Is `tokens[k]` the keyword of a jump or the return as a TARGET — `JMP` before `.`, `RETURN` after `=>` (or, written
 *  the retired way, before an assignment operator: the network check names the form)? */
function isControlTarget(tokens: readonly Token[], k: number): boolean {
  const t = tokens[k]!
  if (t.kind !== "keyword") return false
  const next = tokens[nextWord(tokens, k)]
  if (t.keyword === "JMP") return isPunct(next, ".")
  if (t.keyword !== "RETURN") return false
  return isPunct(tokens[prevWord(tokens, k)], "=>") || isPunct(next, ":=") || isPunct(next, "S=") || isPunct(next, "R=")
}

/**
 * ONE TOKEN OF A NETWORK'S CODE AS A TARGET READS IT: a jump or the return as a target (its keyword a name), a mark word
 * before a name (trivia, refused naming its function), the `:=` of an empty receiver name (trivia; unmarked, refused).
 * True where the token is taken; a jump or a return in any other form is a finding.
 */
export function takeReceiverToken(tokens: readonly Token[], i: number, stray: { message: string; span: Span }[], out: Token[]): boolean {
  const t = tokens[i]!
  if (isMarkWord(tokens, i)) {
    // the first of the words: before a pin (a call's argument) or anywhere else
    if (!isMarkWord(tokens, prevWord(tokens, i))) {
      const before = tokens[prevWord(tokens, i)]
      const pin = isPunct(before, "(") || isPunct(before, ",")
      stray.push({ span: t.span, message: pin ? PIN_MARK_FORM : MARK_FORM })
    }
    out.push({ ...t, kind: "whitespace", keyword: undefined })
    return true
  }
  if (isPunct(t, ":=")) {
    const marks = emptyName(tokens, i)
    if (marks === undefined) return false
    if (marks === 0) stray.push({ message: "an empty pin name with no mark: a pin with no name and no mark is its value alone", span: t.span })
    out.push({ ...t, kind: "whitespace", keyword: undefined })
    return true
  }
  if (isControlTarget(tokens, i)) {
    out.push({ ...t, kind: "identifier", keyword: undefined })
    return true
  }
  // a jump or the return in any other form (`JMP l;`, `JMP(l, v)`, `RETURN;`) is no network's
  if (t.kind === "keyword" && (t.keyword === "JMP" || t.keyword === "RETURN")) stray.push({ message: CONTROL_FORM, span: t.span })
  return false
}
