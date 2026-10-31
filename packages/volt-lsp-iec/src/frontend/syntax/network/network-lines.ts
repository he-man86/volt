/**
 * THE LINES OF A PLAIN-ST NETWORK BODY THAT ARE NO CODE (`plain-st.ts` reads the body): the `%` lines (`%NETWORK`,
 * `%DISABLED`, `%UNSUPPORTED`) and a network's wires, `VAR w1 : ANY; … END_VAR` on one line after them — each network
 * as it is read (`NetworkState`) and when read to its end (`PlainStNetwork`).
 */
import { isTrivia, type Token } from "../lex/tokens.js"
import { joinSpans, type Span } from "../span.js"

/** The `%` lines of the form, by their key. */
const PLAIN_ST_LINES: ReadonlySet<string> = new Set(["NETWORK", "DISABLED", "UNSUPPORTED"])


/** The marks written before one receiver, outermost first, and where they stand. */
export interface PlainStMarks {
  words: readonly string[]
  span: Span
}

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
  /** The wires its `VAR … END_VAR` line declares. */
  wires: readonly PlainStWire[]
  /** Its `VAR … END_VAR` line, where it has one. */
  declaration?: Span
  unsupported: boolean
  /** Each Execute box whose ST stands as its last pin, `'…'`: its call, from `EXECUTE` to its `)`, and its ST, the
   *  string's content — where the box's own statements stand. */
  executes: readonly PlainStExecute[]
  /** Each `OPERAND('…')`'s text: an operand's own ST, which the network check does not hold to the subset. */
  operands: readonly Span[]
}

export interface PlainStExecute {
  call: Span
  code: Span
  /** The box's ST, the string decoded; undefined where it holds an escape the code does not have (a finding). */
  st: string | undefined
}

/** The key of the `%` line `tokens[at]` opens — a `%` first on its line, then a word, touching — or undefined. */
export function percentKeyAt(tokens: readonly Token[], at: number): string | undefined {
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

/** The `%` line `tokens[at]` opens, its key `key`, and the index just past it; a key the form does not have is a finding. */
export function percentLine(tokens: readonly Token[], at: number, key: string, stray: { message: string; span: Span }[]): { line: PlainStLine; end: number } {
  const end = lineEnd(tokens, at)
  const words = tokens.slice(at, end).filter((w) => !isTrivia(w.kind) && w.kind !== "eof")
  const line: PlainStLine = { key, span: joinSpans(words[0]!.span, words[words.length - 1]!.span), args: words.slice(2) }
  if (!PLAIN_ST_LINES.has(key)) stray.push({ message: `'%${key}': a network holds no such line`, span: line.span })
  return { line, end }
}

/** A `%` line of the network being read: the `%` lines stand first, before its wires, its comment and its code (an
 *  UNSUPPORTED line after its comment). */
export function addLine(cur: NetworkState, line: PlainStLine, stray: { message: string; span: Span }[]): void {
  if (cur.declaration !== undefined || cur.code || (cur.comment && line.key !== "UNSUPPORTED"))
    stray.push({ message: `the line '%${line.key}' among the code: a network's % lines stand first, %NETWORK then %DISABLED`, span: line.span })
  cur.lines.push(line)
  cur.last = line.span
}

/** A token of the network being read that is no whitespace: its comment, or its code, has started. */
export function reached(cur: NetworkState, t: Token): void {
  cur.last = t.span
  if (t.kind === "line_comment") cur.comment = true
  else cur.code = true
}

/** A network as it is read: its `%` lines, its wires, its Execute boxes, and whether its comment or code has started. */
export interface NetworkState {
  header: PlainStLine
  lines: PlainStLine[]
  executes: PlainStExecute[]
  operands: Span[]
  last: Span
  wires: PlainStWire[]
  declaration?: Span
  comment: boolean
  code: boolean
}

/** A network read to its end: its `%` lines, its wires, its Execute boxes. */
export function networkOf(cur: NetworkState, index: number): PlainStNetwork {
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
    operands: cur.operands,
  }
}

const WIRES_FORM = "a network's wires are declared on one line, VAR w1 : ANY; w2 : ANY; END_VAR"

export const isWord = (t: Token | undefined, w: string): boolean => t !== undefined && (t.kind === "keyword" || t.kind === "identifier") && t.text.toUpperCase() === w

/** A network's `VAR … END_VAR` at `at`: its wires to `cur`, its tokens trivia in `out`; the index of its last token. */
export function takeWires(tokens: readonly Token[], at: number, cur: NetworkState, out: Token[], stray: { message: string; span: Span }[]): number {
  const end = wiresEnd(tokens, at)
  const misplaced = cur.declaration !== undefined || cur.comment || cur.code
  if (misplaced) stray.push({ message: "VAR after the network's comment or code: its wires are declared after its % lines, before its comment", span: tokens[at]!.span })
  const declared = wiresOf(tokens, at, end)
  if (declared.error !== undefined) stray.push(declared.error)
  if (!misplaced) cur.wires.push(...declared.wires)
  cur.declaration ??= joinSpans(tokens[at]!.span, tokens[end]!.span)
  for (let k = at; k <= end; k++) out.push({ ...tokens[k]!, kind: "whitespace", keyword: undefined })
  cur.last = tokens[end]!.span
  return end
}

/** The index of the `END_VAR` closing the `VAR` at `at`, else of the last token of its line. */
function wiresEnd(tokens: readonly Token[], at: number): number {
  for (let k = at + 1; k < tokens.length && tokens[k]!.kind !== "eof"; k++) if (isWord(tokens[k], "END_VAR")) return k
  return Math.max(at, lineEnd(tokens, at) - 1)
}

/** The wires `VAR … END_VAR` (tokens `at`..`end`) declares, each `w : ANY;` on the one line — as the bridge's reader
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

