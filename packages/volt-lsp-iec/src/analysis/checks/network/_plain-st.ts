/**
 * THE ONE NETWORK CHECK OF PLAIN-ST NETWORK TEXT (openspec network-text-st 2.3, design.md "The LSP subset"): a network
 * body is ST, read by the ST front-end and checked by every ST check; this says only what a network may hold, refused by
 * name, as the bridge's reader refuses it (`StNetworkReader`). Nothing else is network-specific: no lexer, no grammar,
 * no keyword list.
 *
 *   the `%` lines   `%NETWORK` opens a network; then `%DISABLED`, then `%WIRES`, then its `//` comment lines, then its
 *                   code (or its one `%UNSUPPORTED` line); `%EXECUTE` … `%END_EXECUTE` stands among the code, full ST
 *                   between them;
 *   statements      an assignment (`:=`, `S=`, `R=`, chained), a call, `JMP l;`, `RETURN;`, an `IF` holding one `JMP`
 *                   or `RETURN` and no `ELSE`, and the network's label as its first statement;
 *   expressions     every box a call; infix only the contacts (`a AND b`, `a OR b`, `NOT a` before an operand);
 *   wires           a name on its network's `%WIRES` line: declared in reach by nothing, named by one network, defined
 *                   once before it is read; one an expression defines is read twice or more (once, it is written
 *                   inline); a call read once through its wire stands directly before the statement that reads it, only
 *                   other such calls between, and defines no other wire (`w2 := w1;`: the call names w2 itself); an
 *                   enabled box other than a comparison is read by its value only as a coil's value, however often its
 *                   wire is read (CODESYS: "A box with EN can be used for comparison operators only.");
 *   enabled boxes   `X_EN(…)` takes `EN :=` first, and names nothing declared in reach (it is the enabled box of `X`).
 *
 * A `%DISABLED` network is held to the subset too (it is text a push writes), though nothing compiles it.
 */
import {
  type BodySpan,
  type CallExpr,
  type Expr,
  isPlainStNetworkBody,
  type ParseResult,
  type PlainStNetwork,
  plainStText,
  sourceStatements,
  type Span,
  type Statement,
  stmtExprs,
  unitBodies,
  walkExpr,
  allUnits,
} from "../../../frontend/syntax/index.js"
import { lookup, scopeForUnit, type Scope } from "../../../frontend/symbols/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"

const CODE = "network-plain-st"

/** The `%` lines that stand before a network's code. */
const HEADER_LINES: ReadonlySet<string> = new Set(["NETWORK", "DISABLED", "WIRES", "UNSUPPORTED"])

/** The statements a network may not hold, by their ST keyword. */
const NOT_IN_A_NETWORK: Readonly<Record<string, string>> = {
  for: "FOR", while: "WHILE", repeat: "REPEAT", case: "CASE", exit: "EXIT", continue: "CONTINUE", try: "__TRY",
}

/** The comparison boxes: the only enabled boxes CODESYS reads by their value inside another box (1.4). */
const COMPARISONS: ReadonlySet<string> = new Set(["GT", "GE", "LT", "LE", "EQ", "NE"])

/** The infix operators an ST expression has and a network spells as a call (every box is a call). */
const CALL_ONLY: ReadonlySet<string> = new Set(["XOR", "+", "-", "*", "/", "MOD", "=", "<>", "<", ">", "<=", ">=", "**", "&", "AND_THEN", "OR_ELSE"])

export function checkPlainStNetworks(parseResult: ParseResult, project: Scope, out: DiagnosticItem[]): void {
  for (const unit of allUnits(parseResult.units))
    for (const body of unitBodies(unit)) {
      if (!isPlainStNetworkBody(body)) continue
      const scope = scopeForUnit(project, unit)
      checkBody(body, scope?.children.find((c) => c.span === body.span) ?? scope, out)
    }
}

function checkBody(body: BodySpan, scope: Scope | undefined, out: DiagnosticItem[]): void {
  const text = plainStText(body)
  for (const s of text.stray) emit(out, s.span, CODE, s.message)
  const named = new Map<string, number>()
  for (const n of text.networks) {
    checkLines(n, body, out)
    for (const w of n.wires) {
      const key = w.name.toLowerCase()
      if (!/^w[1-9][0-9]*$/i.test(w.name)) emit(out, w.span, CODE, `the wire '${w.name}': a wire is w<n>`)
      if (named.get(key) === n.index) emit(out, w.span, CODE, `the wire '${w.name}' is named twice`)
      else if (named.has(key)) emit(out, w.span, CODE, `the wire '${w.name}' is named on an earlier network too: a wire name is one network's in a body`)
      else named.set(key, n.index)
      if (scope !== undefined && lookup(scope, w.name) !== undefined)
        emit(out, w.span, CODE, `the wire '${w.name}' is also a name declared in reach: a wire is never a variable`)
    }
  }
  const parsed = sourceStatements(body)
  const of = (span: Span) => text.networks.find((n) => span.start >= n.span.start && span.start < n.span.end)
  const inExecute = (span: Span) => text.networks.some((n) => n.executes.some((x) => span.start > x.header.end && span.start < x.span.end))
  const first = new Set<PlainStNetwork>()
  for (const stmt of parsed.statements) {
    if (inExecute(stmt.span)) continue
    const network = of(stmt.span)
    if (network === undefined) continue
    checkStatement(stmt, !first.has(network), scope, out)
    first.add(network)
  }
  checkComments(body, text.networks, out)
  checkWires(parsed.statements, text.networks, of, inExecute, scope, out)
}

/** A network's `%` lines: `%NETWORK` first, then `%DISABLED`, then `%WIRES`; `%UNSUPPORTED` alone under them. */
function checkLines(n: PlainStNetwork, body: BodySpan, out: DiagnosticItem[]): void {
  const order = ["NETWORK", "DISABLED", "WIRES"]
  let at = 0
  let code = false
  for (const line of n.lines.slice(1)) {
    const k = order.indexOf(line.key)
    if (k >= 0) {
      if (k <= at || code) emit(out, line.span, CODE, `'%${line.key}' out of place: a network's % lines stand before its code, in the order %DISABLED, %WIRES`)
      at = Math.max(at, k)
    } else code = true
  }
  const title = n.header.args
  if (title.length > 1 || (title.length === 1 && !/^".*"$/s.test(title[0]!.text)))
    emit(out, n.header.span, CODE, "a network title is one \"…\" after %NETWORK and one space")
  if (n.unsupported) {
    const u = n.lines.find((l) => l.key === "UNSUPPORTED")!
    const words = u.args.map((t) => t.text).join("")
    if (!/^".+"#[0-9a-f]{8}$/i.test(words)) emit(out, u.span, CODE, "the line is %UNSUPPORTED \"<shape>\" #<8 hex digits>")
    const after = body.tokens.find((t) => t.span.start > u.span.end && t.span.start < n.span.end && t.kind !== "whitespace" && t.kind !== "eof")
    if (after !== undefined) emit(out, after.span, CODE, "a network shown %UNSUPPORTED holds nothing else")
  }
}

function checkStatement(stmt: Statement, first: boolean, scope: Scope | undefined, out: DiagnosticItem[]): void {
  const word = NOT_IN_A_NETWORK[stmt.kind]
  if (word !== undefined) return emit(out, stmt.span, CODE, `an LD/FBD network cannot hold a ${word}`)
  switch (stmt.kind) {
    case "label":
      if (!first) emit(out, stmt.span, CODE, "a label stands first in its network: it is the network's label")
      return
    case "if": {
      const only = stmt.branches.length === 1 && stmt.elseBody === undefined && stmt.branches[0]!.body.length === 1
      const inner = stmt.branches[0]?.body[0]
      if (!only || (inner?.kind !== "jmp" && inner?.kind !== "return"))
        emit(out, stmt.span, CODE, "a network's IF holds one JMP or RETURN and no ELSE: an LD/FBD network cannot hold other code under a condition")
      checkExprs(stmt, scope, out)
      return
    }
    case "assign":
    case "call_stmt":
    case "jmp":
    case "return":
      checkExprs(stmt, scope, out)
      return
    default:
      emit(out, stmt.span, CODE, "a statement a network cannot hold: an assignment, a call, a jump or a return")
  }
}

/** Infix only for the contacts; `NOT` only before an operand; an enabled box `EN :=` first. */
function checkExprs(stmt: Statement, scope: Scope | undefined, out: DiagnosticItem[]): void {
  for (const e of stmtExprs(stmt))
    walkExpr(e, (x) => {
      if (x.kind === "binary" && CALL_ONLY.has(x.op.toUpperCase()))
        emit(out, x.span, CODE, `an infix '${x.op}': in a network every box is a call, and only contacts are infix AND / OR`)
      if (x.kind === "unary" && x.op.toUpperCase() === "NOT" && !isOperand(x.operand))
        emit(out, x.span, CODE, "NOT before a call, a bracket or another NOT: NOT before an operand is a negated contact, and the NOT box is NOT(…)")
      if (x.kind === "call") checkCall(x, scope, out)
    })
}

function isOperand(e: Expr): boolean {
  return e.kind === "ident_expr" || e.kind === "literal" || e.kind === "member" || e.kind === "index" || e.kind === "deref" || e.kind === "global_expr"
}

function checkCall(call: CallExpr, scope: Scope | undefined, out: DiagnosticItem[]): void {
  if (call.callee.kind !== "ident_expr") return
  const outs = call.args.filter((a) => a.output && a.param?.name.toUpperCase() === "OUT")
  if (outs.length > 1) emit(out, call.span, CODE, `the call ${call.callee.name} names OUT twice: a box has one value`)
  if (!call.callee.name.toUpperCase().endsWith("_EN")) return
  if (scope !== undefined && lookup(scope, call.callee.name) !== undefined)
    emit(out, call.callee.span, CODE, `the call ${call.callee.name} names something declared in reach (a POU, an instance or a variable) whose name ends in _EN, which the text reads as an enabled box`)
  const en = call.args[0]
  if (en === undefined || en.output || en.param?.name.toUpperCase() !== "EN")
    emit(out, call.callee.span, CODE, `the enabled box ${call.callee.name} takes EN := as its first argument`)
}

/** A `//` comment stands before its network's code; a block comment or a pragma nowhere outside an Execute box. */
function checkComments(body: BodySpan, networks: readonly PlainStNetwork[], out: DiagnosticItem[]): void {
  for (const n of networks) {
    let code = false
    for (const t of body.tokens) {
      if (t.span.start < n.span.start || t.span.start >= n.span.end) continue
      if (n.executes.some((x) => t.span.start > x.header.end && t.span.start < x.span.end)) continue
      if (t.kind === "block_comment" || t.kind === "pragma")
        emit(out, t.span, CODE, t.kind === "pragma" ? "a pragma {…} in a network: a network holds none" : "a (* comment in a network: a network's comment is its // lines before the code")
      else if (t.kind === "line_comment" && code)
        emit(out, t.span, CODE, "a // comment after the code starts: a network's comment is its // lines before the code")
      else if (t.kind !== "whitespace" && t.kind !== "line_comment" && t.kind !== "eof" && !n.lines.some((l) => HEADER_LINES.has(l.key) && t.span.start >= l.span.start && t.span.start <= l.span.end))
        code = true
    }
  }
}

/** A wire a call STATEMENT defines through an output: its statement's index, its call, its pin. */
type CallWire = { index: number; call: CallExpr; pin: string }

/** A read of a wire: its statement's index, where it stands, whether it is a coil's whole value (an assignment to no
 * wire), and whether it is a wire definition statement's whole value (`w2 := w1;`). */
type WireRead = { index: number; span: Span; assignValue: boolean; wireDefValue: boolean }

/** Each wire defined once, before it is read, in its own network; an expression's wire read twice or more. */
function checkWires(
  statements: readonly Statement[],
  networks: readonly PlainStNetwork[],
  of: (span: Span) => PlainStNetwork | undefined,
  inExecute: (span: Span) => boolean,
  scope: Scope | undefined,
  out: DiagnosticItem[],
): void {
  const wireOf = new Map<string, { network: PlainStNetwork; span: Span }>()
  for (const n of networks) for (const w of n.wires) if (!wireOf.has(w.name.toLowerCase())) wireOf.set(w.name.toLowerCase(), { network: n, span: w.span })
  const defined = new Map<string, { at: number; byExpression: boolean }>()
  const reads = new Map<string, number>()
  const byCall = new Map<string, CallWire>()
  const readAt = new Map<string, WireRead[]>()
  const isWire = (e: Expr) => e.kind === "ident_expr" && wireOf.has(e.name.toLowerCase())
  let index = -1
  const define = (target: Expr, byExpression: boolean) => {
    if (target.kind !== "ident_expr" || !wireOf.has(target.name.toLowerCase())) return
    const key = target.name.toLowerCase()
    if (defined.has(key)) emit(out, target.span, CODE, `the wire ${target.name} is defined twice`)
    else defined.set(key, { at: target.span.start, byExpression })
  }
  for (const stmt of statements) {
    if (inExecute(stmt.span)) continue
    index++
    const targets = new Set<Expr>()
    const assignValues = new Set<Expr>()
    let wireDefValue: Expr | undefined
    if (stmt.kind === "assign" && stmt.op === undefined && (stmt.chained ?? []).length === 0 && isWire(stmt.target)) wireDefValue = stmt.value
    else if (stmt.kind === "assign") assignValues.add(stmt.value)
    if (stmt.kind === "assign") {
      if (stmt.op === undefined && (stmt.chained ?? []).length === 0) define(stmt.target, true)
      else for (const t of [stmt.target, ...(stmt.chained ?? [])])
        if (t.kind === "ident_expr" && wireOf.has(t.name.toLowerCase()))
          emit(out, t.span, CODE, `the wire ${t.name} is assigned beside other targets or by S=/R=: a wire is defined alone`)
      targets.add(stmt.target)
      for (const c of stmt.chained ?? []) targets.add(c)
    }
    for (const e of stmtExprs(stmt))
      walkExpr(e, (x) => {
        if (x.kind === "assign_expr") {
          define(x.target, true)
          targets.add(x.target)
          if (!isWire(x.target)) assignValues.add(x.value)
        }
        if (x.kind === "call") {
          const statement = stmt.kind === "call_stmt" && stmt.call === x
          for (const a of x.args) if (a.output && a.value !== undefined) {
            define(a.value, false)
            targets.add(a.value)
            if (statement && a.value.kind === "ident_expr" && wireOf.has(a.value.name.toLowerCase()))
              byCall.set(a.value.name.toLowerCase(), { index, call: x, pin: a.param?.name ?? "" })
            if (!statement && a.value.kind === "ident_expr" && wireOf.has(a.value.name.toLowerCase()))
              emit(out, a.value.span, CODE, `the call is read by its return and defines the wire ${a.value.name}: a box read where it stands has no wire`)
          }
        }
        if (x.kind !== "ident_expr" || targets.has(x)) return
        const key = x.name.toLowerCase()
        const wire = wireOf.get(key)
        if (wire === undefined) return
        reads.set(key, (reads.get(key) ?? 0) + 1)
        readAt.set(key, [...(readAt.get(key) ?? []), { index, span: x.span, assignValue: assignValues.has(x), wireDefValue: x === wireDefValue }])
        if (of(x.span) !== wire.network) emit(out, x.span, CODE, `the wire ${x.name} is read outside its network: a wire is its network's`)
        const d = defined.get(key)
        if (d === undefined || d.at > x.span.start) emit(out, x.span, CODE, `the wire ${x.name} is read before it is defined`)
      })
  }
  checkCallWires(byCall, reads, readAt, scope, out)
  for (const [key, wire] of wireOf) {
    const d = defined.get(key)
    const n = reads.get(key) ?? 0
    if (d === undefined) emit(out, wire.span, CODE, `the wire ${key} is named and never defined`)
    else if (n === 0) emit(out, wire.span, CODE, `the wire ${key} is defined and never read`)
    else if (d.byExpression && n < 2)
      emit(out, wire.span, CODE, `the wire ${key} is read ${n} time: a wire defined by an expression is read twice or more (written inline when read once)`)
  }
}

/** The wires call statements define: a call read once stands directly before its reader and defines no other wire; an
 * enabled box other than a comparison is read by its value only as a coil's value. */
function checkCallWires(
  byCall: ReadonlyMap<string, CallWire>,
  reads: ReadonlyMap<string, number>,
  readAt: ReadonlyMap<string, WireRead[]>,
  scope: Scope | undefined,
  out: DiagnosticItem[],
): void {
  // A call read once through its wire is the box itself, standing where it is read: only other such calls stand between
  // it and the statement that reads it, so the text runs it where the network does.
  const readOnce = (key: string) => (reads.get(key) ?? 0) === 1
  const runCalls = new Set([...byCall].filter(([key]) => readOnce(key)).map(([, c]) => c.index))
  for (const [key, c] of byCall) {
    const name = calleeName(c.call)
    const base = name.slice(0, -3)
    // An enabled box other than a comparison is read by its value only as a coil's value, however often its wire is read.
    const enabledValue = c.pin.toUpperCase() === "OUT" && name.toUpperCase().endsWith("_EN") && !COMPARISONS.has(base.toUpperCase()) && !isVariable(scope, base)
    if (!readOnce(key)) {
      if (enabledValue) for (const r of readAt.get(key) ?? []) if (!r.assignValue) emitEnabledValue(out, r.span, name)
      continue
    }
    const r = readAt.get(key)![0]!
    if (r.index > c.index)
      for (let k = c.index + 1; k < r.index; k++)
        if (!runCalls.has(k)) {
          emit(out, c.call.span, CODE, `the call ${name} defines the wire ${key}, read once, and does not stand directly before the statement that reads it: a box read once stands where it is read`)
          break
        }
    // `w2 := w1;` over a box read once through w1 is the box defining w2: the call names w2 itself, so one model has one text.
    if (r.wireDefValue) {
      emit(out, r.span, CODE, `the wire is defined by the box ${name}, read once through the wire ${key}: the box defines the wire itself (${c.pin} => the wire)`)
      continue
    }
    if (enabledValue && !r.assignValue) emitEnabledValue(out, r.span, name)
  }
}

function emitEnabledValue(out: DiagnosticItem[], span: Span, name: string): void {
  emit(out, span, CODE, `the enabled box ${name} is read by its value where it is no coil's value: a box with EN can be used for comparison operators only (CODESYS), and any other is read by its value only as a coil's value`)
}

function calleeName(call: CallExpr): string {
  return call.callee.kind === "ident_expr" ? call.callee.name : ""
}

/** Is `name` a variable in reach (an FB instance, whose `X_EN` is an enabled FB, not an enabled function)? */
function isVariable(scope: Scope | undefined, name: string): boolean {
  const kind = scope === undefined ? undefined : lookup(scope, name)?.symbol.kind
  return kind === "var" || kind === "gvl_var" || kind === "method_param"
}
