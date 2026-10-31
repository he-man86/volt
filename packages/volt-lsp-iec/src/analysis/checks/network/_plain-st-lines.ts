/**
 * THE LINES OF A PLAIN-ST NETWORK BODY THAT ARE NO CODE, as the network check holds them (`_plain-st.ts`, the one network
 * check, holds the rest): the `%` lines in their order and form, a title's and a comment line's escapes, the wires'
 * numbering, and the one string that spans lines. Refused by name, as the bridge's reader refuses each (`StNetworkReader`).
 */
import { type BodySpan, isTrivia, type PlainStNetwork, plainStText, closedString, type Span, type Token } from "../../../frontend/syntax/index.js"
import { lookup, type Scope } from "../../../frontend/symbols/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { CODE } from "./_plain-st-wires.js"

/** The `%` lines that stand before a network's code. */
const HEADER_LINES: ReadonlySet<string> = new Set(["NETWORK", "DISABLED", "UNSUPPORTED"])

/** THE WIRE NAMES THE WRITER GIVES (the bridge's `StNetworkWriter.BodyWires`, its reader's `RequireWriterNumbering`): w1,
 *  w2, … across the body, in the order the text first names them, past every name the code uses and every name in reach;
 *  each network declares its wires in that order. */
export function checkNumbering(text: ReturnType<typeof plainStText>, scope: Scope | undefined, out: DiagnosticItem[]): void {
  const wires = new Set(text.networks.flatMap((n) => n.wires.map((w) => w.name.toLowerCase())))
  const taken = new Set<string>()
  const code = text.networks.flatMap((n) => n.executes.map((x) => x.code))
  for (const t of text.sourceTokens)
    if (t.kind === "identifier" && !wires.has(t.text.toLowerCase()) && !code.some((c) => t.span.start >= c.start && t.span.start < c.end)) taken.add(t.text.toLowerCase())
  let next = 1
  const fresh = (): string => {
    for (;;) {
      const name = `w${next++}`
      if (!taken.has(name) && (scope === undefined || lookup(scope, name) === undefined)) return name
    }
  }
  for (const n of text.networks) {
    if (n.wires.length === 0) continue
    const own = new Set(n.wires.map((w) => w.name.toLowerCase()))
    const first: string[] = []
    let prev: Token | undefined
    for (const t of text.sourceTokens) {
      if (t.span.start < n.span.start || t.span.start >= n.span.end || isTrivia(t.kind)) continue
      if (t.kind === "identifier" && own.has(t.text.toLowerCase()) && prev?.text !== "." && !first.some((f) => f.toLowerCase() === t.text.toLowerCase())) first.push(t.text)
      prev = t
    }
    for (let k = 0; k < first.length; k++) {
      const expected = fresh()
      const at = n.declaration ?? n.header.span
      if (first[k] !== expected)
        return emit(out, at, CODE, `the wire ${first[k]} is the body's ${expected}: a body's wires are w1, w2, … across its networks, in the order the text first names them`)
      if (n.wires[k]?.name !== first[k])
        return emit(out, at, CODE, `the wire ${n.wires[k]?.name} is the body's ${first[k]}: a network declares its wires in the order the text first names them`)
    }
  }
}

/** A string spans lines only as the Execute box's ST (`network/execute-code.ts` rejoins only that one): any other one is refused as
 *  the bridge's reader refuses it. */
export function checkStrings(body: BodySpan, out: DiagnosticItem[]): void {
  const text = plainStText(body)
  const code = new Set(text.networks.flatMap((n) => n.executes.map((x) => x.code.start - 1)))
  const unclosed = new Set(text.stray.map((s) => s.span.start))
  for (const t of text.tokens)
    if ((t.kind === "string_lit" || t.kind === "wstring_lit") && (t.span.endLine > t.span.startLine || !closedString(t.text)) &&
        !code.has(t.span.start) && !unclosed.has(t.span.start))
      emit(out, t.span, CODE, "a string across a line: only the Execute box's ST spans lines")
}

/** A network's `%` lines: `%NETWORK` first, then `%DISABLED`; `%UNSUPPORTED` alone under them. */
export function checkLines(n: PlainStNetwork, body: BodySpan, out: DiagnosticItem[]): void {
  const order = ["NETWORK", "DISABLED"]
  let at = 0
  let code = false
  for (const line of n.lines.slice(1)) {
    const k = order.indexOf(line.key)
    if (k >= 0) {
      if (k <= at || code) emit(out, line.span, CODE, `'%${line.key}' out of place: a network's % lines stand first, %NETWORK then %DISABLED`)
      at = Math.max(at, k)
    } else code = true
  }
  const title = n.header.args
  if (title.length > 1 || (title.length === 1 && !/^".*"$/s.test(title[0]!.text)))
    emit(out, n.header.span, CODE, "a network title is one \"…\" after %NETWORK and one space")
  else if (title.length === 1 && title[0]!.text === '""')
    emit(out, n.header.span, CODE, "an empty title \"\": a network with no title is the line %NETWORK alone")
  else if (title.length === 1) checkEscapes(title[0]!.text.slice(1, -1), '"', n.header.span, out)
  if (n.unsupported) {
    const u = n.lines.find((l) => l.key === "UNSUPPORTED")!
    const words = u.args.map((t) => t.text).join("")
    if (!/^".+"#[0-9a-f]{8}$/i.test(words)) emit(out, u.span, CODE, "the line is %UNSUPPORTED \"<shape>\" #<8 hex digits>")
    // its label, the jump target it stays, may stand under the line (`l:`); nothing else
    const after = plainStText(body).tokens.filter((t) => t.span.start > u.span.end && t.span.start < n.span.end && t.kind !== "whitespace" && t.kind !== "eof")
    const label = after.length === 2 && after[0]!.kind === "identifier" && after[1]!.text === ":"
    if (after.length > 0 && !label) emit(out, after[0]!.span, CODE, "a network shown %UNSUPPORTED holds nothing else but its label")
  }
}

/** A title's or a comment line's escapes, as the bridge's writer writes them and its reader reads them
 *  (`NetworkSpelling.Unescape`): `$$`, `$L`, `$R`, and `$"` in a title; every other character as it stands. */
function checkEscapes(text: string, quote: '"' | undefined, span: Span, out: DiagnosticItem[]): void {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "$") continue
    const e = text[i + 1]
    if (e === "$" || e === "L" || e === "R" || (e === '"' && quote === '"')) {
      i++
      continue
    }
    return emit(out, span, CODE, e === undefined
      ? "a `$` at the end of delimited text: a `$` is written `$$`."
      : `the escape '$${e}': ${quote === '"' ? 'a title spells $$ $" $L $R' : "a comment line spells $$ $L $R"}, every other character as it stands (a comment's line break is a new // line).`)
  }
}

/** A `//` comment stands before its network's code; a block comment or a pragma nowhere (an Execute box's ST is its
 *  string's content, no token of the network). */
export function checkComments(body: BodySpan, networks: readonly PlainStNetwork[], out: DiagnosticItem[]): void {
  for (const n of networks) {
    let code = false
    for (const t of plainStText(body).tokens) {
      if (t.span.start < n.span.start || t.span.start >= n.span.end) continue
      if (t.kind === "block_comment" || t.kind === "pragma")
        emit(out, t.span, CODE, t.kind === "pragma" ? "a pragma {…} in a network: a network holds none" : "a (* comment in a network: a network's comment is its // lines before the code")
      else if (t.kind === "line_comment" && code)
        emit(out, t.span, CODE, "a // comment after the code starts: a network's comment is its // lines before the code")
      else if (t.kind === "line_comment") checkEscapes(t.text.slice(2), undefined, t.span, out)
      else if (t.kind !== "whitespace" && t.kind !== "eof" && !n.lines.some((l) => HEADER_LINES.has(l.key) && t.span.start >= l.span.start && t.span.start <= l.span.end) &&
               !(n.declaration !== undefined && t.span.start >= n.declaration.start && t.span.start < n.declaration.end))
        code = true
    }
  }
}
