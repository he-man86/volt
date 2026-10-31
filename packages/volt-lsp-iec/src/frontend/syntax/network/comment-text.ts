/**
 * THE OPERAND COMMENT, `COMMENT(<operand>, '<the comment>')` (openspec nwl-schema-completeness-gate; the bridge's
 * `StNetworkReader.TryCommented` and its `COMMENT` element): one function wherever an operand stands — a value
 * `y := COMMENT(a, 'why')`, a coil `COMMENT(y, 'why') := a`, a pin `IN := COMMENT(a, 'why')`, an output target
 * `Q => COMMENT(x, 'why')`. It wraps the operand alone (a name, a literal, `???` or `OPERAND('…')`); the marks stand outside
 * it (`NOT COMMENT(a, 'why')`). Its string is IEC's escape: `$$`, `$'`, `$L`, `$R`, every other character as it stands.
 *
 * The statement tokens read it as the operand it wraps: the head, its brackets, the `,` and the string are trivia, so the
 * ST engine types, resolves and lowers the operand where it stands, and a mark before it marks that operand.
 */
import { isTrivia, type Token } from "../lex/tokens.js"
import { joinSpans, type Span } from "../span.js"

export const COMMENT = "COMMENT"

const FORM = `${COMMENT} takes an operand and one string, ${COMMENT}(a, '<the comment>'), and names no output`
const OPERAND_ONLY = `${COMMENT} wraps an operand, and the marks stand outside it: NOT ${COMMENT}(a, 'why'), RISING(${COMMENT}(a, 'why'))`

/** One operand comment as the text states it: the whole call, the operand it wraps, and its comment decoded. */
export interface PlainStComment {
  call: Span
  operand: Span
  text: string
}

function next(tokens: readonly Token[], k: number): number {
  let n = k + 1
  while (n < tokens.length && isTrivia(tokens[n]!.kind)) n++
  return n
}

const isPunct = (t: Token | undefined, text: string): boolean => t?.kind === "punct" && t.text === text
const isWord = (t: Token | undefined): boolean => t !== undefined && (t.kind === "identifier" || t.kind === "keyword")

/** Is `tokens[at]` the word COMMENT heading a call? */
export function isCommentHead(tokens: readonly Token[], at: number): boolean {
  const t = tokens[at]!
  return isWord(t) && t.text.toUpperCase() === COMMENT && isPunct(tokens[next(tokens, at)], "(")
}

/** The arguments of the call opening at `open`, each its token indices (trivia out), and the index of its `)`. */
function argsOf(tokens: readonly Token[], open: number): { args: number[][]; close: number } | undefined {
  const args: number[][] = [[]]
  let depth = 0
  for (let n = open; n < tokens.length && tokens[n]!.kind !== "eof"; n = next(tokens, n)) {
    const t = tokens[n]!
    if (isPunct(t, "(") || isPunct(t, "[")) depth++
    else if (isPunct(t, ")") || isPunct(t, "]")) {
      if (--depth === 0) return { args, close: n }
    } else if (depth === 1 && isPunct(t, ",")) {
      args.push([])
      continue
    }
    if (n !== open) args.at(-1)!.push(n)
  }
  return undefined
}

/** Is `ks` one operand as the bridge's reader takes it: a literal or a name chain `a.b[i]^.c`, `???`, or `OPERAND('…')`? */
function isOperand(tokens: readonly Token[], ks: readonly number[]): boolean {
  const ts = ks.map((k) => tokens[k]!)
  if (ts.length === 0) return false
  if (ts.length === 3 && ts.every((t) => isPunct(t, "?"))) return true
  if (ts.length === 4 && isWord(ts[0]) && ts[0]!.text.toUpperCase() === "OPERAND" && isPunct(ts[1], "(") && ts[2]!.kind === "string_lit" && isPunct(ts[3], ")")) return true
  let depth = 0
  for (const [k, t] of ts.entries()) {
    if (isPunct(t, "[")) depth++
    else if (isPunct(t, "]")) depth--
    else if (depth > 0) continue
    else if (t.kind === "punct" && t.text !== "." && t.text !== "^" && !(k === 0 && t.text === "-" && ts.length === 2)) return false
    else if (t.kind === "keyword" && !["TRUE", "FALSE"].includes(t.text.toUpperCase())) return false
  }
  return true
}

/** The comment a `'…'` string states, in IEC's escape — or the refusal, in the bridge's words (`NetworkSpelling.Unescape`). */
function commentText(string: string): { text: string } | { error: string } {
  const raw = string.slice(1, -1)
  let text = ""
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!
    if (c !== "$") {
      text += c
      continue
    }
    const e = raw[i + 1]
    const v = e === "$" ? "$" : e === "L" ? "\n" : e === "R" ? "\r" : e === "'" ? "'" : undefined
    if (v === undefined)
      return { error: e === undefined
        ? "a `$` at the end of delimited text: a `$` is written `$$`."
        : `the escape '$${e}': an operand comment spells $$ $' $L $R, every other character as it stands.` }
    text += v
    i++
  }
  return { text }
}

/**
 * The COMMENT call at `at` taken where it is well formed: its head and `(` trivia (pushed to `out`), its `,`, string and
 * `)` trivia when the reader reaches them (`blank`), the comment recorded — the index of its `(`. A finding (the form, an
 * operand with its marks inside, a wire, the escape, an empty comment) goes to `stray`; a call not in the form is left as
 * it stands (undefined).
 */
export function takeComment(
  tokens: readonly Token[],
  at: number,
  wires: readonly { name: string }[],
  into: { out: Token[]; stray: { message: string; span: Span }[]; blank: Set<number>; comments: PlainStComment[] },
): number | undefined {
  const head = tokens[at]!
  const open = next(tokens, at)
  const call = argsOf(tokens, open)
  const refuse = (message: string, span: Span = head.span): undefined => {
    into.stray.push({ message, span })
    return undefined
  }
  if (call === undefined) return refuse(FORM)
  const [operand, string, ...more] = call.args
  const s = string?.length === 1 ? tokens[string[0]!]! : undefined
  const member = isPunct(tokens[next(tokens, call.close)], ".")
  const formal = operand?.some((k) => isPunct(tokens[k], ":=") || isPunct(tokens[k], "=>")) === true
  if (more.length > 0 || s === undefined || s.kind !== "string_lit" || !s.text.startsWith("'") || member || formal) return refuse(FORM)
  const receiver = ["=>", ":=", "S=", "R="].some((op) => tokens[next(tokens, call.close)]?.text.toUpperCase() === op)
  const name = operand!.length === 1 ? tokens[operand![0]!]!.text.toLowerCase() : undefined
  if (name !== undefined && wires.some((w) => w.name.toLowerCase() === name))
    return refuse(receiver ? `a comment on the wire ${tokens[operand![0]!]!.text}: a wire is no operand` : OPERAND_ONLY)
  if (!isOperand(tokens, operand!)) return refuse(OPERAND_ONLY)
  if (s.text.length < 2 || !s.text.endsWith("'")) return refuse(FORM)
  const decoded = commentText(s.text)
  if ("error" in decoded) return refuse(decoded.error, s.span)
  const operandSpan = joinSpans(tokens[operand![0]!]!.span, tokens[operand!.at(-1)!]!.span)
  if (decoded.text.length === 0) {
    const plain = tokens.slice(operand![0]!, operand!.at(-1)! + 1).map((t) => t.text).join("")
    return refuse(`${COMMENT}(${plain}, ''): an empty comment is the plain operand ${plain}`, s.span)
  }
  for (let k = at; k <= open; k++) into.out.push({ ...tokens[k]!, kind: "whitespace", keyword: undefined })
  into.blank.add(string![0]!)
  into.blank.add(call.close)
  // the `,` after the operand
  let comma = next(tokens, operand!.at(-1)!)
  while (comma < string![0]! && !isPunct(tokens[comma], ",")) comma = next(tokens, comma)
  into.blank.add(comma)
  into.comments.push({ call: joinSpans(head.span, tokens[call.close]!.span), operand: operandSpan, text: decoded.text })
  return open
}
