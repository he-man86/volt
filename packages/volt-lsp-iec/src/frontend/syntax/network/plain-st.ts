/**
 * PLAIN-ST NETWORK TEXT — an LD/FBD body as ST (openspec `network-text-st` 2.3; the bridge's `StNetworkWriter`): the ST
 * parser reads it, and Volt adds only `%` lines for what is not code. This module is the front-end's whole knowledge of
 * the form: which lines are Volt's, where each network stands, and the token stream the ST statement parser reads.
 *
 * ```
 * %LANGUAGE LD
 * %NETWORK "Start the motor"
 * VAR_TEMP w1 : ANY; END_VAR
 * // runs while auto is on
 * w1 := start AND NOT stop;
 * lamp := w1;
 * done := MOVE(EN := w1, 1, OUT => x).ENO;
 * hot := GT(temp, 80);
 * ```
 *
 * THE STATEMENT TOKENS are the body's own tokens, with three readings applied:
 *  - a `%` line (`%NETWORK`, `%DISABLED`, `%UNSUPPORTED`) is trivia: it is no code;
 *  - a network's wires, `VAR_TEMP w1 : ANY; w2 : ANY; END_VAR` on one line after its `%` lines, are trivia: each name a
 *    wire of the network (`symbols` `network-scope.ts`), its type its definition's;
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
const PLAIN_ST_LINES: ReadonlySet<string> = new Set(["NETWORK", "DISABLED", "UNSUPPORTED"])


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
  /** The wires its `VAR_TEMP … END_VAR` line declares. */
  wires: readonly PlainStWire[]
  /** Its `VAR_TEMP … END_VAR` line, where it has one. */
  declaration?: Span
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
  let cur: NetworkState | undefined
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
      const { line, end } = percentLine(tokens, i, key, stray)
      if (key === "NETWORK") {
        close()
        cur = { header: line, lines: [line], executes: [], last: line.span, wires: [], comment: false, code: false }
      } else if (cur === undefined) stray.push({ message: `'%${key}' before the first %NETWORK line`, span: line.span })
      else {
        flush()
        addLine(cur, line, stray)
      }
      for (let k = i; k < end; k++) out.push({ ...tokens[k]!, kind: "whitespace", keyword: undefined })
      i = end - 1
      continue
    }
    if (!isTrivia(t.kind) && t.kind !== "eof" && cur === undefined && networks.length === 0 && !before) {
      before = true
      stray.push({ message: `'${t.text}' before the first %NETWORK line: a network body opens with %NETWORK`, span: t.span })
    }
    // THE NETWORK'S WIRES, `VAR_TEMP w1 : ANY; … END_VAR` on one line after its % lines: trivia, each name a wire
    if (cur !== undefined && calls.length === 0 && isWord(t, "VAR_TEMP")) {
      i = takeWires(tokens, i, cur, out, stray)
      continue
    }
    // a network runs to its last token that is not whitespace — a comment after its code is in it
    if (cur !== undefined && t.kind !== "whitespace" && t.kind !== "eof") reached(cur, t)
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

/** The `%` line `tokens[at]` opens, its key `key`, and the index just past it; a key the form does not have is a finding. */
function percentLine(tokens: readonly Token[], at: number, key: string, stray: { message: string; span: Span }[]): { line: PlainStLine; end: number } {
  const end = lineEnd(tokens, at)
  const words = tokens.slice(at, end).filter((w) => !isTrivia(w.kind) && w.kind !== "eof")
  const line: PlainStLine = { key, span: joinSpans(words[0]!.span, words[words.length - 1]!.span), args: words.slice(2) }
  if (!PLAIN_ST_LINES.has(key)) stray.push({ message: `'%${key}': a network holds no such line`, span: line.span })
  return { line, end }
}

/** A `%` line of the network being read: the `%` lines stand first, before its wires, its comment and its code (an
 *  UNSUPPORTED line after its comment). */
function addLine(cur: NetworkState, line: PlainStLine, stray: { message: string; span: Span }[]): void {
  if (cur.declaration !== undefined || cur.code || (cur.comment && line.key !== "UNSUPPORTED"))
    stray.push({ message: `the line '%${line.key}' among the code: a network's % lines stand first, %NETWORK then %DISABLED`, span: line.span })
  cur.lines.push(line)
  cur.last = line.span
}

/** A token of the network being read that is no whitespace: its comment, or its code, has started. */
function reached(cur: NetworkState, t: Token): void {
  cur.last = t.span
  if (t.kind === "line_comment") cur.comment = true
  else cur.code = true
}

/** A network as it is read: its `%` lines, its wires, its Execute boxes, and whether its comment or code has started. */
interface NetworkState {
  header: PlainStLine
  lines: PlainStLine[]
  executes: PlainStExecute[]
  last: Span
  wires: PlainStWire[]
  declaration?: Span
  comment: boolean
  code: boolean
}

/** A network read to its end: its `%` lines, its wires, its Execute boxes. */
function networkOf(cur: NetworkState, index: number): PlainStNetwork {
  return {
    index,
    span: joinSpans(cur.header.span, cur.last),
    header: cur.header,
    lines: cur.lines,
    disabled: cur.lines.some((l) => l.key === "DISABLED"),
    wires: cur.wires,
    ...(cur.declaration !== undefined ? { declaration: cur.declaration } : {}),
    unsupported: cur.lines.some((l) => l.key === "UNSUPPORTED"),
    executes: cur.executes,
  }
}

const WIRES_FORM = "a network's wires are declared on one line, VAR_TEMP w1 : ANY; w2 : ANY; END_VAR"

const isWord = (t: Token | undefined, w: string): boolean => t !== undefined && (t.kind === "keyword" || t.kind === "identifier") && t.text.toUpperCase() === w

/** A network's `VAR_TEMP … END_VAR` at `at`: its wires to `cur`, its tokens trivia in `out`; the index of its last token. */
function takeWires(tokens: readonly Token[], at: number, cur: NetworkState, out: Token[], stray: { message: string; span: Span }[]): number {
  const end = wiresEnd(tokens, at)
  const misplaced = cur.declaration !== undefined || cur.comment || cur.code
  if (misplaced) stray.push({ message: "VAR_TEMP after the network's comment or code: its wires are declared after its % lines, before its comment", span: tokens[at]!.span })
  const declared = wiresOf(tokens, at, end)
  if (declared.error !== undefined) stray.push(declared.error)
  if (!misplaced) cur.wires.push(...declared.wires)
  cur.declaration ??= joinSpans(tokens[at]!.span, tokens[end]!.span)
  for (let k = at; k <= end; k++) out.push({ ...tokens[k]!, kind: "whitespace", keyword: undefined })
  cur.last = tokens[end]!.span
  return end
}

/** The index of the `END_VAR` closing the `VAR_TEMP` at `at`, else of the last token of its line. */
function wiresEnd(tokens: readonly Token[], at: number): number {
  for (let k = at + 1; k < tokens.length && tokens[k]!.kind !== "eof"; k++) if (isWord(tokens[k], "END_VAR")) return k
  return Math.max(at, lineEnd(tokens, at) - 1)
}

/** The wires `VAR_TEMP … END_VAR` (tokens `at`..`end`) declares, each `w : ANY;` on the one line — as the bridge's reader
 *  reads them (`StNetworkReader.WireDeclaration`), refused in its words. */
function wiresOf(tokens: readonly Token[], at: number, end: number): { wires: PlainStWire[]; error?: { message: string; span: Span } } {
  const all = joinSpans(tokens[at]!.span, tokens[end]!.span)
  const form = { wires: [], error: { message: WIRES_FORM, span: all } }
  if (!isWord(tokens[end], "END_VAR") || tokens[end]!.span.startLine !== tokens[at]!.span.startLine) return form
  const t = tokens.slice(at + 1, end).filter((x) => !isTrivia(x.kind))
  const wires: PlainStWire[] = []
  for (let k = 0; k < t.length; k += 4) {
    const [name, colon, type, semi] = [t[k], t[k + 1], t[k + 2], t[k + 3]]
    if (name?.kind !== "identifier" || colon?.text !== ":" || type === undefined || (type.kind !== "identifier" && type.kind !== "keyword") || semi?.text !== ";") return form
    if (type.text.toUpperCase() !== "ANY")
      return { wires: [], error: { message: `the wire ${name.text} is declared ${type.text}: a wire is declared : ANY, its type its definition's`, span: type.span } }
    wires.push({ name: name.text, span: name.span })
  }
  return wires.length === 0 ? form : { wires }
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

/** The name of what the IDE stores unnamed, `???`: a coil (`??? := a;`) and an FB box's instance (`TON(…)`, the call of
 *  its type: `types` `infer/network-box.ts`). */
export const UNNAMED = "???"

/** Does `tokens[at]` open `???` — three touching `?` — as a statement's target (`:=` next, at the start of a statement)? */
function isUnnamedTarget(tokens: readonly Token[], at: number, before: readonly Token[]): boolean {
  const q = (k: number) => tokens[k]?.kind === "punct" && tokens[k]!.text === "?"
  if (!q(at) || !q(at + 1) || !q(at + 2)) return false
  if (tokens[at + 1]!.span.start !== tokens[at]!.span.end || tokens[at + 2]!.span.start !== tokens[at + 1]!.span.end) return false
  let p = before.length - 1
  while (p >= 0 && isTrivia(before[p]!.kind)) p--
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
