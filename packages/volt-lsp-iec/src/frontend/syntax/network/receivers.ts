/**
 * THE RECEIVERS OF A PLAIN-ST NETWORK BODY'S CODE (`plain-st.ts` reads the body): a mark word before a receiver — a coil,
 * a pin, EN, an output, or the EMPTY name of a pin the IDE stores unnamed (`AND(a, NOT := b)`) — and a jump or the return
 * written as a target (`JMP.l := v;`, `RETURN := v;`), each as the bridge's reader reads it (`StNetworkReader`).
 */
import { isTrivia, type Token } from "../lex/tokens.js"
import { joinSpans, type Span } from "../span.js"

/** The one form of a jump and the return: a target (the bridge's reader's words). */
const CONTROL_FORM = "a jump or a return is a target: JMP.label := value; RETURN := value; (on the rail, := RAIL())"

/** The words that mark a value or a receiver. */
const MARK_WORDS: ReadonlySet<string> = new Set(["NOT", "RISING", "FALLING"])

/** The index of the first token after `k` that is no trivia. */
function nextWord(tokens: readonly Token[], k: number): number {
  let n = k + 1
  while (n < tokens.length && isTrivia(tokens[n]!.kind)) n++
  return n
}

const isPunct = (t: Token | undefined, text: string): boolean => t?.kind === "punct" && t.text.toUpperCase() === text

/** Is `tokens[k]` an assignment operator a receiver stands before — `:=`, `S=`, `R=` (a coil) or `=>` (an output)? */
const receiverOperator = (t: Token | undefined): boolean => isPunct(t, ":=") || isPunct(t, "S=") || isPunct(t, "R=") || isPunct(t, "=>")

/** Is `tokens[k]` a mark word heading no call? */
function isMarkWord(tokens: readonly Token[], k: number): boolean {
  const t = tokens[k]
  return t !== undefined && (t.kind === "keyword" || t.kind === "identifier") && MARK_WORDS.has(t.text.toUpperCase()) &&
    !isPunct(tokens[nextWord(tokens, k)], "(")
}

/** The index of the first token before `k` that is no trivia, or -1. */
function prevWord(tokens: readonly Token[], k: number): number {
  let n = k - 1
  while (n >= 0 && isTrivia(tokens[n]!.kind)) n--
  return n
}

/** Is the `:=` at `k` an EMPTY receiver name — after `(` or `,`, past the mark words before it? The number of those
 *  marks; undefined for any other `:=`. */
function emptyName(tokens: readonly Token[], k: number): number | undefined {
  let p = prevWord(tokens, k)
  let marks = 0
  while (p >= 0 && isMarkWord(tokens, p)) {
    marks++
    p = prevWord(tokens, p)
  }
  return p >= 0 && (isPunct(tokens[p], "(") || isPunct(tokens[p], ",")) ? marks : undefined
}

/** THE RECEIVER the mark word `tokens[at]` stands before — the index of its first token — or undefined where the mark is
 *  the value's: after the mark words, a complete operand (a name chain `s.x[i]^.y`, `JMP.l`, `RETURN`), then an assignment
 *  operator. */
function receiverOfMark(tokens: readonly Token[], at: number): number | undefined {
  if (!isMarkWord(tokens, at)) return undefined
  let k = at
  while (isMarkWord(tokens, k)) k = nextWord(tokens, k)
  const start = tokens[k]
  // the empty name, `NOT := b`: the receiver is the pin the value stands in, keyed by the value
  if (isPunct(start, ":=") && emptyName(tokens, k) !== undefined) return nextWord(tokens, k)
  if (start === undefined || (start.kind !== "identifier" && !(start.kind === "keyword" && (start.keyword === "JMP" || start.keyword === "RETURN"))))
    return undefined
  let n = nextWord(tokens, k)
  for (;;) {
    const t = tokens[n]
    if (isPunct(t, ".") && tokens[nextWord(tokens, n)]?.kind === "identifier") n = nextWord(tokens, nextWord(tokens, n))
    else if (isPunct(t, "^")) n = nextWord(tokens, n)
    else if (isPunct(t, "[")) {
      let depth = 0
      for (; n < tokens.length; n = nextWord(tokens, n)) {
        if (isPunct(tokens[n], "[")) depth++
        else if (isPunct(tokens[n], "]") && --depth === 0) break
      }
      n = nextWord(tokens, n)
    } else break
  }
  return receiverOperator(tokens[n]) ? k : undefined
}

/** Is `tokens[k]` the keyword of a jump or the return as a TARGET — `JMP` before `.`, `RETURN` before an assignment
 *  operator? */
function isControlTarget(tokens: readonly Token[], k: number): boolean {
  const t = tokens[k]!
  if (t.kind !== "keyword") return false
  const next = tokens[nextWord(tokens, k)]
  if (t.keyword === "JMP") return isPunct(next, ".")
  return t.keyword === "RETURN" && (isPunct(next, ":=") || isPunct(next, "S=") || isPunct(next, "R="))
}

/**
 * ONE TOKEN OF A NETWORK'S CODE AS A RECEIVER READS IT: a mark word before a receiver (trivia, recorded on the receiver in
 * `marks`), the `:=` of an empty receiver name (trivia; unmarked, refused), a jump or the return as a target (its keyword a
 * name). True where the token is taken; a jump or a return in another form and an edge word before a value are findings.
 */
export function takeReceiverToken(
  tokens: readonly Token[],
  i: number,
  marks: Map<number, { words: string[]; span: Span }>,
  stray: { message: string; span: Span }[],
  out: Token[],
): boolean {
  const t = tokens[i]!
  // A RECEIVER'S MARK: trivia, recorded on the receiver it stands before
    const receiver = receiverOfMark(tokens, i)
    if (receiver !== undefined) {
      const at = tokens[receiver]!
      if (!marks.has(at.span.start) && at.kind === "keyword" && (at.keyword === "JMP" || at.keyword === "RETURN")) {
        const label = at.keyword === "JMP" ? "." + (tokens[nextWord(tokens, nextWord(tokens, receiver))]?.text ?? "") : ""
        stray.push({ message: `a mark on the target ${at.text.toUpperCase()}${label}: a jump or a return carries none`, span: t.span })
      }
      const m = marks.get(at.span.start) ?? { words: [], span: t.span }
      m.words.push(t.text.toUpperCase())
      m.span = joinSpans(m.span, t.span)
      marks.set(at.span.start, m)
      out.push({ ...t, kind: "whitespace", keyword: undefined })
      return true
    }
    // THE EMPTY RECEIVER NAME, `AND(a, NOT := b)`: its `:=` trivia (its marks are recorded on the value); unmarked it is
    // a second spelling of the value alone
    if (isPunct(t, ":=") && emptyName(tokens, i) !== undefined) {
      if (emptyName(tokens, i) === 0) stray.push({ message: "an empty pin name with no mark: a pin with no name and no mark is its value alone", span: t.span })
      out.push({ ...t, kind: "whitespace", keyword: undefined })
      return true
    }
    // a jump or the return as a target: its keyword a name; it takes `:=` alone
    if (isControlTarget(tokens, i)) {
      const op = tokens[nextWord(tokens, t.keyword === "JMP" ? nextWord(tokens, nextWord(tokens, i)) : i)]
      if (op !== undefined && !isPunct(op, ":="))
        stray.push({ message: `${t.text.toUpperCase()} ${op.text.toUpperCase()}: a jump or a return takes :=`, span: op.span })
      out.push({ ...t, kind: "identifier", keyword: undefined })
      return true
    }
    // a jump or the return in any other form (`JMP l;`, `JMP(l, v)`, `RETURN;`) is no network's
    if (t.kind === "keyword" && (t.keyword === "JMP" || t.keyword === "RETURN"))
      stray.push({ message: CONTROL_FORM, span: t.span })
    // an edge word before a value is no mark: a value's edge is the call
    if (t.kind === "identifier" && (t.text.toUpperCase() === "RISING" || t.text.toUpperCase() === "FALLING") && isMarkWord(tokens, i))
      stray.push({ message: "a value's edge is the call RISING(…) / FALLING(…); a mark word before a name marks a receiver, followed by :=, S=, R= or =>", span: t.span })
  return false
}
