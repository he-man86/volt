/**
 * PLAIN-ST NETWORK TEXT — an LD/FBD body as ST (openspec `network-text-st` 2.3; the bridge's `StNetworkWriter`): the ST
 * parser reads it, and Volt adds only `%` lines for what is not code. This module is the front-end's whole knowledge of
 * the form: which lines are Volt's, where each network stands, and the token stream the ST statement parser reads.
 *
 * ```
 * %LANGUAGE LD
 * %NETWORK "Start the motor"
 * %WIRES w1
 * // runs while auto is on
 * w1 := start AND NOT stop;
 * lamp := w1;
 * done := MOVE_EN(EN := w1, 1, OUT => x);
 * hot := GT(temp, 80);
 * ```
 *
 * THE STATEMENT TOKENS are the body's own tokens, with three readings applied and nothing reordered:
 *  - a `%` line (`%NETWORK`, `%DISABLED`, `%WIRES`, `%UNSUPPORTED`, `%END_EXECUTE`) is trivia: it is no code;
 *  - `%EXECUTE(EN := c)` is the call `EXECUTE(EN := c)` — its `%` trivia, a `;` of no width after its line — so the EN
 *    it is given is code the ST engine resolves; a bare `%EXECUTE` is trivia. The ST between it and `%END_EXECUTE` is the
 *    Execute box's own, read as it stands;
 *  - an operator box word heading a call (`GT(`, `ADD(`, `AND(`, `NOT(`, …: the ST lexer reads each as a keyword) where an operand starts is the call of
 *    that box — every box is a call — and after an operand it is the contact (`a AND b`). The same rule the bridge's
 *    reader keeps (`StNetworkReader`): position, never spacing.
 *
 * The form is told from v2 network text by its first line (`%NETWORK`), during the read-only phase only, while both are
 * read (openspec network-text-st 3.2 deletes v2 and this test with it).
 */
import type { BodySpan } from "../ast/nodes/index.js"
import { isTrivia, type Token } from "../lex/tokens.js"
import { joinSpans, pointSpan, type Span } from "../span.js"
import { isPlainStNetworkBody } from "../format/bodies.js"
import { percentKeyAt } from "../format/network-form.js"

/** The `%` lines of the form, by their key. */
const PLAIN_ST_LINES: ReadonlySet<string> = new Set(["NETWORK", "DISABLED", "WIRES", "EXECUTE", "END_EXECUTE", "UNSUPPORTED"])

/** The boxes whose name the ST lexer reads as a keyword (the 14 IL operators, NOT, the built-in functions): heading a
 *  call, in a network, each is its box. */
const KEYWORD_BOXES: ReadonlySet<string> = new Set([
  "AND", "OR", "XOR", "ADD", "SUB", "MUL", "DIV", "MOD", "GT", "GE", "LT", "LE", "EQ", "NE", "NOT",
  // the built-in boxes ST calls already, which the ST statement parser does not take as a statement's head (`MOVE(b, OUT => a);`)
  "MOVE", "SEL", "MUX", "LIMIT", "MIN", "MAX", "SHL", "SHR", "ROL", "ROR", "ABS", "SQRT", "LN", "LOG", "EXP", "EXPT",
  "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "TRUNC", "ADR", "SIZEOF", "BITADR", "INDEXOF",
])

interface PlainStWire {
  name: string
  span: Span
}

/** One `%` line: its key, its words after the key, and where it stands. */
interface PlainStLine {
  key: string
  span: Span
  /** The tokens after the key, trivia out. */
  args: readonly Token[]
}

export interface PlainStNetwork {
  index: number
  /** From the `%NETWORK` line to the end of the network's last token. */
  span: Span
  header: PlainStLine
  /** The `%` lines of the network, in order, the `%NETWORK` line first. */
  lines: readonly PlainStLine[]
  disabled: boolean
  wires: readonly PlainStWire[]
  unsupported: boolean
  /** Each Execute box: from its `%EXECUTE` line to its `%END_EXECUTE` line (or the network's end, where none closes it),
   *  and its `%EXECUTE` line — the box's own call, where the ST under it is the box's. */
  executes: readonly { span: Span; header: Span }[]
}

interface PlainStText {
  networks: readonly PlainStNetwork[]
  /** What the ST statement parser reads AS COMPILED (see the module comment): a `%DISABLED` network's code is trivia,
   *  as the vendor compiles none of it — its label is no jump target ("No such label", design.md 1c). */
  statementTokens: readonly Token[]
  /** What the ST statement parser reads AS WRITTEN: every network's code, a disabled one's too — for the services that
   *  navigate the text, and the network check, which holds a disabled network to the subset. */
  sourceTokens: readonly Token[]
  /** Text before the first `%NETWORK` line, or a `%` key the form does not have — reported by the network check. */
  stray: readonly { message: string; span: Span }[]
}

const cache = new WeakMap<BodySpan, PlainStText>()

/** The tokens the ST statement parser reads of a body: its own, or a plain-ST network body's statement tokens — as
 *  compiled, or (`asWritten`) with its disabled networks' code in. */
export function statementTokensOf(body: BodySpan, asWritten = false): readonly Token[] {
  if (!isPlainStNetworkBody(body)) return body.tokens
  const text = plainStText(body)
  return asWritten ? text.sourceTokens : text.statementTokens
}

/** The body read as plain-ST network text — once per body. */
export function plainStText(body: BodySpan): PlainStText {
  let t = cache.get(body)
  if (t === undefined) cache.set(body, (t = read(body.tokens)))
  return t
}

/** The index just past the line `tokens[at]` stands on (the token holding its newline, or the end). */
function lineEnd(tokens: readonly Token[], at: number): number {
  let k = at
  while (k < tokens.length && !tokens[k]!.text.includes("\n") && tokens[k]!.kind !== "eof") k++
  return k
}

function read(tokens: readonly Token[]): PlainStText {
  const out: Token[] = []
  const networks: PlainStNetwork[] = []
  const stray: { message: string; span: Span }[] = []
  let before = false
  let cur: { header: PlainStLine; lines: PlainStLine[]; executes: { span: Span; header: Span }[]; open?: Span; last: Span } | undefined
  const close = () => {
    if (cur === undefined) return
    if (cur.open !== undefined) {
      cur.executes.push({ span: joinSpans(cur.open, cur.last), header: cur.open })
      stray.push({ message: "%EXECUTE with no %END_EXECUTE", span: cur.open })
    }
    const wires = cur.lines.filter((l) => l.key === "WIRES").flatMap((l) => l.args.filter((a) => a.kind === "identifier").map((a) => ({ name: a.text, span: a.span })))
    networks.push({
      index: networks.length,
      span: joinSpans(cur.header.span, cur.last),
      header: cur.header,
      lines: cur.lines,
      disabled: cur.lines.some((l) => l.key === "DISABLED"),
      wires,
      unsupported: cur.lines.some((l) => l.key === "UNSUPPORTED"),
      executes: cur.executes,
    })
    cur = undefined
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    const key = percentKeyAt(tokens, i)
    if (key !== undefined && (cur?.open === undefined || key === "END_EXECUTE")) {
      const end = lineEnd(tokens, i)
      const words = tokens.slice(i, end).filter((w) => !isTrivia(w.kind) && w.kind !== "eof")
      const line: PlainStLine = { key, span: joinSpans(words[0]!.span, words[words.length - 1]!.span), args: words.slice(2) }
      if (key === "NETWORK") {
        close()
        cur = { header: line, lines: [line], executes: [], last: line.span }
      } else if (cur === undefined) stray.push({ message: `'%${key}' before the first %NETWORK line`, span: line.span })
      else {
        cur.lines.push(line)
        cur.last = line.span
        if (key === "EXECUTE") cur.open = line.span
        if (key === "END_EXECUTE" && cur.open !== undefined) {
          cur.executes.push({ span: joinSpans(cur.open, line.span), header: cur.open })
          cur.open = undefined
        }
      }
      if (!PLAIN_ST_LINES.has(key)) stray.push({ message: `'%${key}': a network holds no such line`, span: line.span })
      const callsExecute = key === "EXECUTE" && line.args.length > 0
      for (let k = i; k < end; k++) {
        const w = tokens[k]!
        out.push(callsExecute && k > i ? w : { ...w, kind: "whitespace", keyword: undefined })
      }
      if (callsExecute) out.push({ kind: "punct", text: ";", span: pointSpan(words[words.length - 1]!.span.end, words[words.length - 1]!.span.endLine, words[words.length - 1]!.span.endCol) })
      i = end - 1
      continue
    }
    if (!isTrivia(t.kind) && t.kind !== "eof" && cur === undefined && networks.length === 0 && !before) {
      before = true
      stray.push({ message: `'${t.text}' before the first %NETWORK line: a network body opens with %NETWORK`, span: t.span })
    }
    // a network runs to its last token that is not whitespace — a comment after its code is in it
    if (cur !== undefined && t.kind !== "whitespace" && t.kind !== "eof") cur.last = t.span
    out.push(cur?.open === undefined && isKeywordCallHead(tokens, i, out) ? { ...t, kind: "identifier", keyword: undefined } : t)
  }
  close()
  const disabled = networks.filter((n) => n.disabled).map((n) => n.span)
  const compiled = disabled.length === 0 ? out
    : out.flatMap((t) => (disabled.some((d) => t.span.start >= d.start && t.span.end <= d.end) && !isTrivia(t.kind)
      ? (t.span.start === t.span.end ? [] : [{ ...t, kind: "whitespace" as const, keyword: undefined }])
      : [t]))
  return { networks, statementTokens: compiled, sourceTokens: out, stray }
}

/** Does `tokens[at]` head a keyword operator's CALL: a keyword box word, `(` next, and no operand ending before it in
 *  `before` (the statement tokens so far, whose `%` lines are trivia)? */
function isKeywordCallHead(tokens: readonly Token[], at: number, before: readonly Token[]): boolean {
  const t = tokens[at]!
  if (t.kind !== "keyword" || !KEYWORD_BOXES.has(t.text.toUpperCase())) return false
  let n = at + 1
  while (n < tokens.length && isTrivia(tokens[n]!.kind)) n++
  if (tokens[n]?.kind !== "punct" || tokens[n]!.text !== "(") return false
  let p = before.length - 1
  while (p >= 0 && isTrivia(before[p]!.kind)) p--
  return p < 0 || !endsOperand(before[p]!)
}

/** The keywords that are an operand themselves. */
const OPERAND_KEYWORDS: ReadonlySet<string> = new Set(["TRUE", "FALSE", "THIS", "SUPER"])

/** Does a token end an operand — after it, an operator word is infix? */
function endsOperand(t: Token): boolean {
  if (t.kind === "punct") return t.text === ")" || t.text === "]" || t.text === "^"
  if (t.kind === "keyword") return OPERAND_KEYWORDS.has(t.text.toUpperCase())
  return t.kind !== "unknown"
}
