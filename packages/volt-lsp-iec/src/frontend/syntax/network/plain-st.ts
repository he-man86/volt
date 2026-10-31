/**
 * PLAIN-ST NETWORK TEXT — an LD/FBD body as ST (openspec `network-text-st` 2.3; the bridge's `StNetworkWriter`): the ST
 * parser reads it, and Volt adds only `%` lines for what is not code. This module is the front-end's whole knowledge of
 * the form: which lines are Volt's, where each network stands, and the token stream the ST statement parser reads.
 *
 * ```
 * %LANGUAGE LD
 * %NETWORK "Start the motor"
 * VAR w1 : ANY; END_VAR
 * // runs while auto is on
 * w1 := start AND NOT stop;
 * lamp := w1;
 * done := MOVE(EN := w1, 1, OUT => x).ENO;
 * hot := GT(temp, 80);
 * ```
 *
 * THE STATEMENT TOKENS are the body's own tokens, with these readings applied:
 *  - a `%` line (`%NETWORK`, `%DISABLED`, `%UNSUPPORTED`) is trivia: it is no code;
 *  - a network's wires, `VAR w1 : ANY; w2 : ANY; END_VAR` on one line after its `%` lines, are trivia: each name a
 *    wire of the network (`symbols` `network-scope.ts`), its type its definition's;
 *  - the Execute box `EXECUTE(EN := c, '<ST>')` is the call `EXECUTE(EN := c)`, its `'…'` trivia, and its
 *    ST — the string decoded (`$'` a quote, `$$` a dollar), lexed, each token where it stands in the string — follows the
 *    statement the box stands in, so the ST engine reads it as the statements it is (the one place tokens stand out of
 *    source order: after their statement's `;`);
 *  - a RECEIVER'S MARKS — `NOT`, `RISING`, `FALLING` before a complete operand followed by `:=`, `S=`, `R=` or `=>` (a coil
 *    `NOT y := a;`, a pin `t1(NOT IN := a)`, an output `NOT Q => x`) — are trivia, each recorded on its receiver (`marks`,
 *    keyed by the receiver's first offset; `networkStatements` puts them on the AST); a mark word before anything else is
 *    the value's (`NOT a`), and one followed by `(` a call (`RISING(a)`, `NOT(a)`);
 *  - a jump or the return as a TARGET (`JMP.l := v;`, `RETURN := v;`) reads its keyword as a name, so the ST parser reads
 *    an assignment; `networkStatements` reads it back as the jump or the return it is;
 *  - an operator box word heading a call (`GT(`, `ADD(`, `AND(`, `NOT(`, …: the ST lexer reads each as a keyword) where an operand starts is the call of
 *    that box — every box is a call — and after an operand it is the contact (`a AND b`). The same rule the bridge's
 *    reader keeps (`StNetworkReader`): position, never spacing.
 */
import type { BodySpan, CallArg, Expr, IdentExpr, Statement, StatementList } from "../ast/nodes/index.js"
import { stmtExprs, walkExpr } from "../ast/walk.js"
import { isTrivia, type Token } from "../lex/tokens.js"
import type { Dialect } from "../lex/vocabulary.js"
import { joinSpans, type Span } from "../span.js"
import { isPlainStNetworkBody } from "../format/bodies.js"
import { codeAt, joinCodeStrings, takeCode } from "./execute-code.js"
import { isOperandHead, takeOperand } from "./operand-text.js"
import { addLine, isWord, networkOf, percentKeyAt, percentLine, reached, takeWires, type NetworkState, type PlainStMarks, type PlainStNetwork } from "./network-lines.js"
import { takeReceiverToken } from "./receivers.js"

export { closedString, EXECUTE } from "./execute-code.js"
export type { PlainStExecute, PlainStNetwork } from "./network-lines.js"

/** The boxes whose name the ST lexer reads as a keyword (the 14 IL operators, NOT, the built-in functions): heading a
 *  call, in a network, each is its box. */
const KEYWORD_BOXES: ReadonlySet<string> = new Set([
  "AND", "OR", "XOR", "ADD", "SUB", "MUL", "DIV", "MOD", "GT", "GE", "LT", "LE", "EQ", "NE", "NOT",
  // the built-in boxes ST calls already, which the ST statement parser does not take as a statement's head (`MOVE(b, OUT => a);`)
  "MOVE", "SEL", "MUX", "LIMIT", "MIN", "MAX", "SHL", "SHR", "ROL", "ROR", "ABS", "SQRT", "LN", "LOG", "EXP", "EXPT",
  "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "TRUNC", "ADR", "SIZEOF", "BITADR", "INDEXOF",
])

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
  /** Each receiver's marks (a coil, a pin, EN, an output), by the receiver's first offset. */
  marks: ReadonlyMap<number, PlainStMarks>
}

const cache = new WeakMap<BodySpan, PlainStText>()

/** A jump target `JMP.l` (its label) or the return `RETURN` (no label) as the ST parser reads it; undefined for a coil. */
function controlTarget(e: Expr): { jump: true; label: IdentExpr } | { jump: false } | undefined {
  if (e.kind === "member" && e.base.kind === "ident_expr" && e.base.name.toUpperCase() === "JMP") return { jump: true, label: e.member }
  if (e.kind === "ident_expr" && e.name.toUpperCase() === "RETURN") return { jump: false }
  return undefined
}

/**
 * A NETWORK'S STATEMENTS AS THE ST THEY ARE: each receiver's marks put on the AST (`AssignStatement.marks`,
 * `AssignExpr.marks`, `CallArg.marks`); a jump and the return, TARGETS of an item, read as the ST statements they are — a
 * lone one a `JmpStatement` / `ReturnStatement` on the item's value, one beside coils (`y := JMP.l := v;`) the coils'
 * assignment followed by the jump on the SAME value (`sharesValue`, the value written once), and one in a tree
 * (`(JMP.l := c)`) the jump on its value handing it on (the call `JMP(l, c)` / `RETURN(c)` the types and the lowering read).
 */
export function networkStatements(list: StatementList, marks: ReadonlyMap<number, PlainStMarks>): StatementList {
  const markOf = (e: Expr | undefined) => (e === undefined ? undefined : marks.get(e.span.start)?.words)
  // in place: the parse is this body's own, made here
  const tree = (e: Expr): void => walkExpr(e, (x) => {
    if (x.kind === "call") for (const a of x.args) setMarks(a, markOf(a.param ?? (a.output ? undefined : a.value)))
    if (x.kind !== "assign_expr") return
    setMarks(x, markOf(x.target))
    const control = controlTarget(x.target)
    if (control === undefined) return
    const callee: Expr = { kind: "ident_expr", name: control.jump ? "JMP" : "RETURN", span: x.target.span }
    const args: CallArg[] = control.jump ? [{ kind: "call_arg", output: false, value: control.label, span: control.label.span }] : []
    args.push({ kind: "call_arg", output: false, value: x.value, span: x.value.span })
    const node = x as unknown as Record<string, unknown>
    for (const k of Object.keys(node)) if (k !== "span") delete node[k]
    Object.assign(node, { kind: "call", callee, args })
  })
  return list.flatMap((s): Statement[] => {
    for (const e of stmtExprs(s)) tree(e)
    if (s.kind !== "assign") return [s]
    const targets = [s.target, ...(s.chained ?? [])]
    const ops = [s.op, ...(s.chainOps ?? [])]
    const targetMarks = targets.map(markOf)
    const coils = targets.map((t, i) => ({ t, op: ops[i], m: targetMarks[i] })).filter((x) => controlTarget(x.t) === undefined)
    const controls = targets.filter((t) => controlTarget(t) !== undefined)
    const marked = (xs: readonly (readonly string[] | undefined)[]) => (xs.some((m) => m !== undefined) ? { marks: xs } : {})
    if (controls.length === 0) return [{ ...s, ...marked(targetMarks) }]
    const out: Statement[] = []
    if (coils.length > 0) {
      const [first, ...rest] = coils
      out.push({
        kind: "assign", target: first!.t, value: s.value, span: s.span,
        ...(first!.op !== undefined ? { op: first!.op } : {}),
        ...(rest.length > 0 ? { chained: rest.map((c) => c.t), chainOps: rest.map((c) => c.op) } : {}),
        ...marked(coils.map((c) => c.m)),
      })
    }
    controls.forEach((t, i) => {
      const c = controlTarget(t)!
      const shares = out.length > 0 || i > 0
      const value = shares ? { sharesValue: true as const } : { value: s.value }
      out.push(c.jump ? { kind: "jmp", target: c.label, ...value, span: t.span } : { kind: "return", ...value, span: t.span })
    })
    return out
  })
}

function setMarks(node: { marks?: readonly string[] }, words: readonly string[] | undefined): void {
  if (words !== undefined) node.marks = words
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
  if (t === undefined) cache.set(body, (t = read(body.tokens, body.dialect, body.unicodeIdentifiers)))
  return t
}

function read(lexed: readonly Token[], dialect: Dialect, unicodeIdentifiers: boolean): PlainStText {
  const { tokens, unclosed } = joinCodeStrings(lexed, dialect, unicodeIdentifiers)
  const out: Token[] = []
  const marks = new Map<number, { words: string[]; span: Span }>()
  const networks: PlainStNetwork[] = []
  const stray: { message: string; span: Span }[] = unclosed.map((span) => ({ message: "an unclosed string", span }))
  let before = false
  let cur: NetworkState | undefined
  // the calls open around the cursor, each its head token and, for an Execute box, its ST once read; and the ST of the
  // Execute boxes of the statement being read, which follows its `;`
  let calls: OpenCall[] = []
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
        cur = { header: line, lines: [line], executes: [], operands: [], last: line.span, wires: [], comment: false, code: false }
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
    // THE NETWORK'S WIRES, `VAR w1 : ANY; … END_VAR` on one line after its % lines: trivia, each name a wire
    if (cur !== undefined && calls.length === 0 && isWord(t, "VAR_TEMP"))
      stray.push({ message: `VAR_TEMP: a network's wires keep their value across scans, as ST's VAR does, and are declared VAR w1 : ANY; END_VAR`, span: t.span })
    if (cur !== undefined && calls.length === 0 && (isWord(t, "VAR") || isWord(t, "VAR_TEMP"))) {
      i = takeWires(tokens, i, cur, out, stray)
      continue
    }
    // a network runs to its last token that is not whitespace — a comment after its code is in it
    if (cur !== undefined && t.kind !== "whitespace" && t.kind !== "eof") reached(cur, t)
    if (cur !== undefined && isUnnamed(tokens, i)) {
      out.push({ kind: "identifier", text: UNNAMED, span: joinSpans(t.span, tokens[i + 2]!.span) })
      cur.last = tokens[i + 2]!.span
      i += 2
      continue
    }
    if (cur !== undefined) {
      const taken = takeCallToken(tokens, i, cur, calls, { dialect, unicodeIdentifiers, out, pending, stray })
      if (taken !== undefined) {
        i = taken
        continue
      }
    }
    // a receiver's mark, an empty receiver name, a jump or the return as a target (`receivers.ts`)
    if (cur !== undefined && takeReceiverToken(tokens, i, marks, stray, out)) continue
    out.push(isKeywordCallHead(tokens, i, out) ? { ...t, kind: "identifier", keyword: undefined } : t)
    if (t.kind === "punct" && t.text === ";" && calls.length === 0) flush()
  }
  close()
  return { tokens, networks, statementTokens: compiled(out, networks), sourceTokens: out, stray, marks }
}

/** The calls open around the cursor, each its head token and, for an Execute box, its ST once read. */
type OpenCall = { head: Token | undefined; code?: Span; st?: string }

/**
 * A TOKEN OF A NETWORK'S CODE AS THE CALLS READ IT: `OPERAND('…')` read as the bracketed ST it holds (`operand-text.ts`);
 * the Execute box's ST, the string closing an `EXECUTE(` call, trivia, its ST the statements after its statement; a
 * bracket opening or closing a call. The index of the last token taken where the token is taken whole, else undefined.
 */
function takeCallToken(
  tokens: readonly Token[],
  i: number,
  cur: NetworkState,
  calls: OpenCall[],
  into: { dialect: Dialect; unicodeIdentifiers: boolean; out: Token[]; pending: Token[]; stray: { message: string; span: Span }[] },
): number | undefined {
  const t = tokens[i]!
  if (isOperandHead(tokens, i)) {
    const at = takeOperand(tokens, i, into.dialect, into.unicodeIdentifiers, { out: into.out, stray: into.stray, operands: cur.operands })
    calls.push({ head: undefined })
    cur.last = tokens[at]!.span
    return at
  }
  const code = codeAt(tokens, i, calls)
  if (code !== undefined) {
    takeCode(tokens, i, code.string, into.dialect, into.unicodeIdentifiers, { out: into.out, pending: into.pending, stray: into.stray, call: calls[calls.length - 1]! })
    cur.last = tokens[code.string]!.span
    return code.string
  }
  if (t.kind === "punct" && t.text === "(") calls.push({ head: lastWord(into.out) })
  if (t.kind === "punct" && t.text === ")") {
    const call = calls.pop()
    if (call?.code !== undefined && call.head !== undefined) cur.executes.push({ call: joinSpans(call.head.span, t.span), code: call.code, st: call.st })
  }
  return undefined
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

/** The name of what the IDE stores unnamed, `???`: a coil (`??? := a;`), an operand (a contact, a box input, an output
 *  binding) and an FB box's instance (`TON(…)`, the call of its type: `types` `infer/network-box.ts`). */
export const UNNAMED = "???"

/** Does `tokens[at]` open `???` — three touching `?`, one name wherever it stands, as the bridge's reader lexes it
 *  (`StNetworkReader`: `???` an identifier token)? */
function isUnnamed(tokens: readonly Token[], at: number): boolean {
  const q = (k: number) => tokens[k]?.kind === "punct" && tokens[k]!.text === "?"
  if (!q(at) || !q(at + 1) || !q(at + 2)) return false
  return tokens[at + 1]!.span.start === tokens[at]!.span.end && tokens[at + 2]!.span.start === tokens[at + 1]!.span.end
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
