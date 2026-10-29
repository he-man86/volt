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
 * done := MOVE(EN := w1, 1, OUT => x).ENO;
 * hot := GT(temp, 80);
 * ```
 *
 * THE STATEMENT TOKENS are the body's own tokens, with three readings applied:
 *  - a `%` line (`%NETWORK`, `%DISABLED`, `%WIRES`, `%UNSUPPORTED`) is trivia: it is no code;
 *  - the Execute box `EXECUTE(EN := c, CODE := '<ST>')` is the call `EXECUTE(EN := c)`, its `CODE := '…'` trivia, and its
 *    ST — the string decoded (`$'` a quote, `$$` a dollar), lexed, each token where it stands in the string — follows the
 *    statement the box stands in, so the ST engine reads it as the statements it is (the one place tokens stand out of
 *    source order: after their statement's `;`);
 *  - an operator box word heading a call (`GT(`, `ADD(`, `AND(`, `NOT(`, …: the ST lexer reads each as a keyword) where an operand starts is the call of
 *    that box — every box is a call — and after an operand it is the contact (`a AND b`). The same rule the bridge's
 *    reader keeps (`StNetworkReader`): position, never spacing.
 */
import type { BodySpan, StatementList } from "../ast/nodes/index.js"
import { isTrivia, type Token } from "../lex/tokens.js"
import type { Dialect } from "../lex/vocabulary.js"
import { joinSpans, type Span } from "../span.js"
import { isPlainStNetworkBody } from "../format/bodies.js"
import { codeAt, joinCodeStrings, takeCode } from "./execute-code.js"

export { closedString, EXECUTE } from "./execute-code.js"

/** The `%` lines of the form, by their key. */
const PLAIN_ST_LINES: ReadonlySet<string> = new Set(["NETWORK", "DISABLED", "WIRES", "UNSUPPORTED"])


/** The boxes whose name the ST lexer reads as a keyword (the 14 IL operators, NOT, the built-in functions): heading a
 *  call, in a network, each is its box. */
const KEYWORD_BOXES: ReadonlySet<string> = new Set([
  "AND", "OR", "XOR", "ADD", "SUB", "MUL", "DIV", "MOD", "GT", "GE", "LT", "LE", "EQ", "NE", "NOT",
  // the built-in boxes ST calls already, which the ST statement parser does not take as a statement's head (`MOVE(b, OUT => a);`)
  "MOVE", "SEL", "MUX", "LIMIT", "MIN", "MAX", "SHL", "SHR", "ROL", "ROR", "ABS", "SQRT", "LN", "LOG", "EXP", "EXPT",
  "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "TRUNC", "ADR", "SIZEOF", "BITADR", "INDEXOF",
  // the jump and the return on a value, functions of the text (`JMP(label, value)`, `RETURN(value)`): a statement of them is
  // the jump statement (`networkStatements`), and one in a tree the call
  "JMP", "RETURN",
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
  /** Each Execute box whose ST stands as its last pin, `CODE := '…'`: its call, from `EXECUTE` to its `)`, and its ST, the
   *  string's content — where the box's own statements stand. */
  executes: readonly PlainStExecute[]
}

export interface PlainStExecute {
  call: Span
  code: Span
  /** The box's ST, the string decoded; undefined where it holds an escape the code does not have (a finding). */
  st: string | undefined
}

interface PlainStText {
  /** The body's tokens as the text reads them: its own, each Execute box's CODE string one token across its lines
   *  (`joinCodeStrings`). Every check that walks the text's tokens walks these, never the lexer's `body.tokens`. */
  tokens: readonly Token[]
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

/**
 * A NETWORK'S JUMP AND RETURN STATEMENTS (owner, 2026-10-28): the call statements `JMP(label, value);` and `RETURN(value);`
 * as the ST statements they are — a `JmpStatement` / `ReturnStatement` on that value — so the label checks and every
 * statement walk see a jump. A call of another shape stays the call, which the network check refuses by name.
 */
export function networkStatements(list: StatementList): StatementList {
  return list.map((s) => {
    if (s.kind !== "call_stmt" || s.call.callee.kind !== "ident_expr") return s
    const head = s.call.callee.name.toUpperCase()
    const args = s.call.args
    const positional = args.every((a) => !a.output && a.param === undefined && a.value !== undefined)
    if (head === "JMP" && positional && args.length === 2 && args[0]!.value!.kind === "ident_expr")
      return { kind: "jmp", target: args[0]!.value!, value: args[1]!.value!, span: s.span }
    if (head === "RETURN" && positional && args.length === 1) return { kind: "return", value: args[0]!.value!, span: s.span }
    return s
  })
}

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
  if (t === undefined) cache.set(body, (t = read(body.tokens, body.dialect)))
  return t
}

/** The key of the `%` line `tokens[at]` opens — a `%` first on its line, then a word, touching — or undefined. */
function percentKeyAt(tokens: readonly Token[], at: number): string | undefined {
  const t = tokens[at]!
  if (t.kind !== "punct" || t.text !== "%" || t.span.startCol !== 0) return undefined
  const next = tokens[at + 1]
  return next !== undefined && (next.kind === "identifier" || next.kind === "keyword") && next.span.start === t.span.end
    ? next.text.toUpperCase()
    : undefined
}

/** The index just past the line `tokens[at]` stands on (the token holding its newline, or the end). */
function lineEnd(tokens: readonly Token[], at: number): number {
  let k = at
  while (k < tokens.length && !tokens[k]!.text.includes("\n") && tokens[k]!.kind !== "eof") k++
  return k
}

function read(lexed: readonly Token[], dialect: Dialect): PlainStText {
  const { tokens, unclosed } = joinCodeStrings(lexed, dialect)
  const out: Token[] = []
  const networks: PlainStNetwork[] = []
  const stray: { message: string; span: Span }[] = unclosed.map((span) => ({ message: "an unclosed string", span }))
  let before = false
  let cur: { header: PlainStLine; lines: PlainStLine[]; executes: PlainStExecute[]; last: Span } | undefined
  // the calls open around the cursor, each its head token and, for an Execute box, its ST once read; and the ST of the
  // Execute boxes of the statement being read, which follows its `;`
  let calls: { head: Token | undefined; code?: Span; st?: string }[] = []
  let pending: Token[] = []
  const flush = () => {
    out.push(...pending)
    pending = []
  }
  const close = () => {
    if (cur === undefined) return
    flush()
    calls = []
    networks.push(networkOf(cur, networks.length))
    cur = undefined
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    const key = percentKeyAt(tokens, i)
    if (key !== undefined) {
      const end = lineEnd(tokens, i)
      const words = tokens.slice(i, end).filter((w) => !isTrivia(w.kind) && w.kind !== "eof")
      const line: PlainStLine = { key, span: joinSpans(words[0]!.span, words[words.length - 1]!.span), args: words.slice(2) }
      if (key === "NETWORK") {
        close()
        cur = { header: line, lines: [line], executes: [], last: line.span }
      } else if (cur === undefined) stray.push({ message: `'%${key}' before the first %NETWORK line`, span: line.span })
      else {
        flush()
        cur.lines.push(line)
        cur.last = line.span
      }
      if (!PLAIN_ST_LINES.has(key)) stray.push({ message: `'%${key}': a network holds no such line`, span: line.span })
      for (let k = i; k < end; k++) out.push({ ...tokens[k]!, kind: "whitespace", keyword: undefined })
      i = end - 1
      continue
    }
    if (!isTrivia(t.kind) && t.kind !== "eof" && cur === undefined && networks.length === 0 && !before) {
      before = true
      stray.push({ message: `'${t.text}' before the first %NETWORK line: a network body opens with %NETWORK`, span: t.span })
    }
    // a network runs to its last token that is not whitespace — a comment after its code is in it
    if (cur !== undefined && t.kind !== "whitespace" && t.kind !== "eof") cur.last = t.span
    if (cur !== undefined && isUnnamedTarget(tokens, i, out)) {
      out.push({ kind: "identifier", text: UNNAMED, span: joinSpans(t.span, tokens[i + 2]!.span) })
      cur.last = tokens[i + 2]!.span
      i += 2
      continue
    }
    if (cur !== undefined) {
      // THE EXECUTE BOX'S ST: `CODE := '…'` closing an `EXECUTE(` call is trivia, its ST the statements after its statement
      const code = codeAt(tokens, i, calls)
      if (code !== undefined) {
        takeCode(tokens, i, code.string, dialect, { out, pending, stray, call: calls[calls.length - 1]! })
        cur.last = tokens[code.string]!.span
        i = code.string
        continue
      }
      if (t.kind === "punct" && t.text === "(") calls.push({ head: lastWord(out) })
      if (t.kind === "punct" && t.text === ")") {
        const call = calls.pop()
        if (call?.code !== undefined && call.head !== undefined) cur.executes.push({ call: joinSpans(call.head.span, t.span), code: call.code, st: call.st })
      }
    }
    out.push(isKeywordCallHead(tokens, i, out) ? { ...t, kind: "identifier", keyword: undefined } : t)
    if (t.kind === "punct" && t.text === ";" && calls.length === 0) flush()
  }
  close()
  return { tokens, networks, statementTokens: compiled(out, networks), sourceTokens: out, stray }
}

/** A network read to its end: its `%` lines, its wires, its Execute boxes. */
function networkOf(cur: { header: PlainStLine; lines: PlainStLine[]; executes: PlainStExecute[]; last: Span }, index: number): PlainStNetwork {
  const wires = cur.lines.filter((l) => l.key === "WIRES").flatMap((l) => l.args.filter((a) => a.kind === "identifier").map((a) => ({ name: a.text, span: a.span })))
  return {
    index,
    span: joinSpans(cur.header.span, cur.last),
    header: cur.header,
    lines: cur.lines,
    disabled: cur.lines.some((l) => l.key === "DISABLED"),
    wires,
    unsupported: cur.lines.some((l) => l.key === "UNSUPPORTED"),
    executes: cur.executes,
  }
}

/** The statement tokens as compiled: a `%DISABLED` network's code trivia. */
function compiled(out: readonly Token[], networks: readonly PlainStNetwork[]): readonly Token[] {
  const disabled = networks.filter((n) => n.disabled).map((n) => n.span)
  return disabled.length === 0 ? out
    : out.flatMap((t) => (disabled.some((d) => t.span.start >= d.start && t.span.end <= d.end) && !isTrivia(t.kind)
      ? (t.span.start === t.span.end ? [] : [{ ...t, kind: "whitespace" as const, keyword: undefined }])
      : [t]))
}

/** The last word pushed: a call's head where a `(` follows it. */
function lastWord(out: readonly Token[]): Token | undefined {
  let p = out.length - 1
  while (p >= 0 && isTrivia(out[p]!.kind)) p--
  const t = out[p]
  return t !== undefined && (t.kind === "identifier" || t.kind === "keyword") ? t : undefined
}

/** The name of what the IDE stores unnamed, `???`: a coil (`??? := a;`) and an FB box's instance (`TON(FB := ???, …)`). */
export const UNNAMED = "???"

/** Does `tokens[at]` open `???` — three touching `?` — as a statement's target (`:=` next, at the start of a statement) or as
 *  an FB box's instance (after `FB :=`)? */
function isUnnamedTarget(tokens: readonly Token[], at: number, before: readonly Token[]): boolean {
  const q = (k: number) => tokens[k]?.kind === "punct" && tokens[k]!.text === "?"
  if (!q(at) || !q(at + 1) || !q(at + 2)) return false
  if (tokens[at + 1]!.span.start !== tokens[at]!.span.end || tokens[at + 2]!.span.start !== tokens[at + 1]!.span.end) return false
  let p = before.length - 1
  while (p >= 0 && isTrivia(before[p]!.kind)) p--
  if (before[p]?.text === ":=") {
    let f = p - 1
    while (f >= 0 && isTrivia(before[f]!.kind)) f--
    return before[f]?.kind === "identifier" && before[f]!.text.toUpperCase() === "FB"
  }
  let n = at + 3
  while (n < tokens.length && isTrivia(tokens[n]!.kind)) n++
  if (tokens[n]?.kind !== "punct" || tokens[n]!.text !== ":=") return false
  return p < 0 || before[p]!.text === ";" || before[p]!.text === ":"
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
