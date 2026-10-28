/**
 * THE ONE NETWORK CHECK OF PLAIN-ST NETWORK TEXT (openspec network-text-st 2.3, design.md "The LSP subset"): a network
 * body is ST, read by the ST front-end and checked by every ST check; this says only what a network may hold, refused by
 * name, as the bridge's reader refuses it (`StNetworkReader`). Nothing else is network-specific: no lexer, no grammar,
 * no keyword list.
 *
 *   the `%` lines   `%NETWORK` opens a network; then `%DISABLED`, then `%WIRES`, then its `//` comment lines, then its
 *                   code (or its one `%UNSUPPORTED` line); `%EXECUTE` … `%END_EXECUTE` stands among the code, full ST
 *                   between them;
 *   statements      an assignment (`:=`, `S=`, `R=`, chained), a call, `JMP l;` and `RETURN;` on the rail,
 *                   `JMP(label, value);` and `RETURN(value);` on a value (also in a tree), the empty item `;`, and the
 *                   network's label as its first statement — no `IF`;
 *   expressions     every box a call; infix only the contacts (`a AND b`, `a OR b`, `NOT a` before an operand);
 *   wires           a name on its network's `%WIRES` line: declared in reach by nothing, named by one network, defined
 *                   once and read by its name any number of times, before its definition too; a call read once through
 *                   its wire stands directly before the statement that reads it, only other such calls between, and
 *                   defines no other wire (`w2 := w1;`: the call names w2 itself); an enabled box other than a
 *                   comparison is read by its value only as a coil's value, however often its wire is read (CODESYS: "A
 *                   box with EN can be used for comparison operators only."), and through one `OUT`;
 *   enabled boxes   `X_EN(…)` takes `EN :=` first, and names nothing declared in reach (it is the enabled box of `X`);
 *                   `X_ENO(…)` neither (X showing ENO and no EN); `X_ENONLY(…)` takes `EN :=` first, has no ENO and
 *                   returns its value — no `OUT =>` a wire;
 *   elements        `BRANCH(FEED := f, b1, b2)` / `BRANCH_SHORTCIRCUIT(…)` take the feed first, if fed, then the
 *                   branches, positional; `R_EDGE(x)` / `F_EDGE(x)` one value, a contact or a box read where it stands;
 *                   each is a value in a tree, and none names anything declared in reach.
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
  UNNAMED,
  walkStatements,
} from "../../../frontend/syntax/index.js"
import { lookup, scopeForUnit, type Scope } from "../../../frontend/symbols/index.js"
import { NETWORK_ELEMENTS, resolveCallee } from "../../../frontend/types/index.js"
import { messagesFor, type Messages } from "../../messages/index.js"
import { emit, SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { checkWires, CODE, isVariable } from "./_plain-st-wires.js"


/** The `%` lines that stand before a network's code. */
const HEADER_LINES: ReadonlySet<string> = new Set(["NETWORK", "DISABLED", "WIRES", "UNSUPPORTED"])

/** The statements a network may not hold, by their ST keyword. */
const NOT_IN_A_NETWORK: Readonly<Record<string, string>> = {
  for: "FOR", while: "WHILE", repeat: "REPEAT", case: "CASE", exit: "EXIT", continue: "CONTINUE", try: "__TRY",
}

/** The infix operators an ST expression has and a network spells as a call (every box is a call). */
const CALL_ONLY: ReadonlySet<string> = new Set(["XOR", "+", "-", "*", "/", "MOD", "=", "<>", "<", ">", "<=", ">=", "**", "&", "AND_THEN", "OR_ELSE"])

/** The network check's findings over every LD/FBD body of a parse: network text is ST, which the registry's checks read;
 *  this is the one check of what a network may hold. */
export function networkDiagnostics(parseResult: ParseResult, project: Scope): DiagnosticItem[] {
  const out: DiagnosticItem[] = []
  for (const unit of allUnits(parseResult.units))
    for (const body of unitBodies(unit)) {
      if (!isPlainStNetworkBody(body)) continue
      const scope = scopeForUnit(project, unit)
      const bodyScope = scope?.children.find((c) => c.span === body.span) ?? scope
      checkBody(body, bodyScope, out)
      checkUnnamed(body, bodyScope, parseResult.dialect, out)
      if (bodyScope !== undefined) checkBoxes(body, bodyScope, project, parseResult.dialect === "twincat", messagesFor(parseResult.dialect), out)
    }
  return out
}

/**
 * What the IDE stores as `???` and the build answers in its own words, each vendor's (`network_unnamed_*`, both vendors):
 *  - a coil nobody named, `??? := a;`: "The assignment target is not specified." Behind an enable CODESYS adds two errors
 *    about an implicit variable it names itself, which no text holds; this one stands for them;
 *  - an FB box with no instance, written as the call of its type (`TON(IN := a);`): the build reads the instance `???`
 *    as text — the two errors of the marker, the instance error over the marker, the marker's first again;
 *  - `???` as an operand: the build reads it as text, "Expression expected instead of '?'" (the ST parser's, here too)
 *    and "Unexpected token '?' found".
 */
function checkUnnamed(body: BodySpan, scope: Scope | undefined, dialect: ParseResult["dialect"], out: DiagnosticItem[]): void {
  const tc = dialect === "twincat"
  const error = (span: Span, message: string) => out.push({ severity: "error", span, source: SOURCE, code: UNNAMED_CODE, message })
  const target = (t: Expr) => {
    if (t.kind === "ident_expr" && t.name === UNNAMED) error(t.span, tc ? "Assignment target not specified" : "The assignment target is not specified.")
  }
  const marker = "Expression expected instead of '?'"
  walkStatements(sourceStatements(body).statements, (stmt) => {
    if (stmt.kind === "assign") target(stmt.target)
    if (stmt.kind === "call_stmt" && stmt.call.callee.kind === "ident_expr" && scope !== undefined &&
        lookup(scope, stmt.call.callee.name)?.symbol.kind === "function_block") {
      const at = stmt.call.callee.span
      for (const m of [marker, tc ? "Unexpected Token '?' found" : "Unexpected token '?' found",
        "Program name, function or function block instance expected instead of '!!!'ERROR'!!!'", marker]) error(at, m)
    }
    for (const e of stmtExprs(stmt)) walkExpr(e, (x) => { if (x.kind === "assign_expr") target(x.target) })
  })
  const tokens = plainStText(body).sourceTokens
  const q = (k: number) => tokens[k]?.kind === "punct" && tokens[k]!.text === "?"
  for (let i = 0; i + 2 < tokens.length; i++)
    if (q(i) && q(i + 1) && q(i + 2) && tokens[i + 2]!.span.start === tokens[i]!.span.end + 1) {
      error(tokens[i]!.span, tc ? "Unexpected Token '?' found" : "Unexpected token '?' found")
      i += 2
    }
}

const UNNAMED_CODE = "network-unnamed-target"

/** The operator boxes the build counts the inputs of, by the symbol its message names (`ng_r1_*`, `ng_r5_one_input_*`,
 *  both vendors): two exactly, or two at least. */
const TWO_EXACTLY: Readonly<Record<string, string>> = { SUB: "-", DIV: "/", MOD: "MOD", GT: ">", GE: ">=", LT: "<", LE: "<=", EQ: "=", NE: "<>" }
const TWO_AT_LEAST: Readonly<Record<string, string>> = { ADD: "+", MUL: "*", AND: "AND", OR: "OR", XOR: "XOR" }

/**
 * What the build answers of a box whose inputs a push states as written: an operator box with an input count its symbol
 * does not take ("'-' needs exactly '2' operands"); a METHOD box given positional pins — the push names no method's
 * pins, so the build counts none ("Function 'M' requires exactly '1' inputs", `ng_m_method_positional`, both vendors); a
 * FUNCTION box given more pins than it declares, positional and named together (`ng_m_function_positional_then_named_same`);
 * and on CODESYS a library function's box named through its namespace and shown with ENO, whose ENO the build reads
 * as a member of the result (`ng_m_library_function_qualified_eno`: "'ENO' is no component of 'LEN'").
 */
function checkBoxes(body: BodySpan, scope: Scope, project: Scope, tc: boolean, messages: Messages, out: DiagnosticItem[]): void {
  const error = (span: Span, code: string, message: string) => out.push({ severity: "error", span, source: SOURCE, code, message })
  walkStatements(sourceStatements(body).statements, (stmt) => {
    for (const e of stmtExprs(stmt))
      walkExpr(e, (x) => {
        if (x.kind !== "call") return
        const inputs = x.args.filter((a) => !a.output && a.param?.name.toUpperCase() !== "EN")
        if (x.callee.kind === "ident_expr") {
          const word = x.callee.name.toUpperCase().replace(/_(ENONLY|ENO|EN)$/, "")
          const exactly = TWO_EXACTLY[word]
          const atLeast = TWO_AT_LEAST[word]
          if (exactly !== undefined && inputs.length !== 2) error(x.callee.span, "operator-arity", messages.operatorNeedsExactly(exactly, 2))
          if (atLeast !== undefined && inputs.length < 2) error(x.callee.span, "operator-arity", messages.operatorNeedsAtLeast(atLeast, 2))
          if (exactly !== undefined || atLeast !== undefined) return
          const fn = resolveCallee(x, scope, project)
          const positional = inputs.filter((a) => a.param === undefined).length
          if (fn?.sym.kind === "function" && positional > 0 && positional < inputs.length && inputs.length > fn.positionalArity)
            error(x.callee.span, "function-argument-count", messages.functionRequiresInputs(fn.sym.name, fn.positionalArity))
          return
        }
        if (x.callee.kind !== "member") return
        const eno = /^(.+)_ENO$/i.exec(x.callee.member.name)
        const base = x.callee.base.kind === "ident_expr" ? lookup(scope, x.callee.base.name) : undefined
        if (!tc && eno !== null && x.callee.base.kind === "ident_expr" && (base === undefined || base.symbol.kind === "namespace"))
          error(x.callee.member.span, "not-a-member", messages.notAMember("ENO", eno[1]!))
        if (!inputs.some((a) => a.param === undefined)) return
        const callee = resolveCallee(x, scope, project)
        if (callee?.sym.kind === "method") error(x.callee.span, "function-argument-count", messages.functionRequiresInputs(callee.sym.name, callee.positionalArity))
      })
  })
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
  const wires = new Set(text.networks.flatMap((n) => n.wires.map((w) => w.name.toLowerCase())))
  for (const stmt of parsed.statements) {
    if (inExecute(stmt.span)) continue
    const network = of(stmt.span)
    if (network === undefined) continue
    checkStatement(stmt, !first.has(network), scope, wires, out)
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
    // its label, the jump target it stays, may stand under the line (`l:`); nothing else
    const after = body.tokens.filter((t) => t.span.start > u.span.end && t.span.start < n.span.end && t.kind !== "whitespace" && t.kind !== "eof")
    const label = after.length === 2 && after[0]!.kind === "identifier" && after[1]!.text === ":"
    if (after.length > 0 && !label) emit(out, after[0]!.span, CODE, "a network shown %UNSUPPORTED holds nothing else but its label")
  }
}

function checkStatement(stmt: Statement, first: boolean, scope: Scope | undefined, wires: ReadonlySet<string>, out: DiagnosticItem[]): void {
  const word = NOT_IN_A_NETWORK[stmt.kind]
  if (word !== undefined) return emit(out, stmt.span, CODE, `an LD/FBD network cannot hold a ${word}`)
  switch (stmt.kind) {
    case "label":
      if (!first) emit(out, stmt.span, CODE, "a label stands first in its network: it is the network's label")
      return
    case "if":
      return emit(out, stmt.span, CODE, "a network holds no IF: a jump on a value is JMP(label, value), a return RETURN(value)")
    case "call_stmt":
      if (stmt.call.callee.kind === "ident_expr" && NETWORK_ELEMENTS.has(stmt.call.callee.name.toUpperCase()))
        emit(out, stmt.span, CODE, `the call ${stmt.call.callee.name} stands alone: a branch or an edge is a value in a tree`)
      checkExprs(stmt, scope, wires, out)
      return
    case "assign":
    case "jmp":
    case "return":
      checkExprs(stmt, scope, wires, out)
      return
    case "empty":
      return
    default:
      emit(out, stmt.span, CODE, "a statement a network cannot hold: an assignment, a call, a jump or a return")
  }
}

/** Infix only for the contacts; `NOT` only before an operand; an enabled box `EN :=` first. */
function checkExprs(stmt: Statement, scope: Scope | undefined, wires: ReadonlySet<string>, out: DiagnosticItem[]): void {
  for (const e of stmtExprs(stmt))
    walkExpr(e, (x) => {
      if (x.kind === "binary" && CALL_ONLY.has(x.op.toUpperCase()))
        emit(out, x.span, CODE, `an infix '${x.op}': in a network every box is a call, and only contacts are infix AND / OR`)
      if (x.kind === "unary" && x.op.toUpperCase() === "NOT" && !isOperand(x.operand))
        emit(out, x.span, CODE, "NOT before a call, a bracket or another NOT: NOT before an operand is a negated contact, and the NOT box is NOT(…)")
      if (x.kind === "call") checkCall(x, scope, wires, out)
    })
}

function isOperand(e: Expr): boolean {
  return e.kind === "ident_expr" || e.kind === "literal" || e.kind === "member" || e.kind === "index" || e.kind === "deref" || e.kind === "global_expr"
}

function checkCall(call: CallExpr, scope: Scope | undefined, wires: ReadonlySet<string>, out: DiagnosticItem[]): void {
  if (call.callee.kind !== "ident_expr") return
  const name = call.callee.name
  const upper = name.toUpperCase()
  const declared = scope !== undefined && lookup(scope, name) !== undefined
  if (upper === "JMP" || upper === "RETURN") {
    const positional = call.args.every((a) => !a.output && a.param === undefined && a.value !== undefined)
    if (upper === "JMP" && !(positional && call.args.length === 2 && call.args[0]!.value!.kind === "ident_expr"))
      emit(out, call.span, CODE, "JMP(label, value): a label, then the value the jump is on")
    if (upper === "RETURN" && !(positional && call.args.length === 1)) emit(out, call.span, CODE, "RETURN(value): the value the return is on")
    return
  }
  if (NETWORK_ELEMENTS.has(upper)) {
    if (declared) emit(out, call.callee.span, CODE, `the call ${name} names something declared in reach, which the text reads as its own ${upper}`)
    return upper.startsWith("BRANCH") ? checkBranch(call, name, out) : checkEdge(call, name, wires, out)
  }
  if (upper.endsWith("_ENONLY") && upper.length > 7) {
    if (declared)
      emit(out, call.callee.span, CODE, `the call ${name} names something declared in reach (a POU, an instance or a variable) whose name ends in _ENONLY, which the text reads as an enabled box showing no ENO`)
    for (const a of call.args) {
      if (!a.output) continue
      const pin = a.param?.name.toUpperCase()
      if (pin === "ENO") emit(out, a.span, CODE, `the box ${name} shows no ENO: _ENONLY is a box with EN and no ENO`)
      else if (pin === "OUT" && a.value?.kind === "ident_expr" && wires.has(a.value.name.toLowerCase()) && !isVariable(scope, name.slice(0, -7)))
        emit(out, a.span, CODE, `the box ${name} returns its value, read where it stands, not through OUT => ${a.value.name}`)
    }
    const en = call.args[0]
    if (en === undefined || en.output || en.param?.name.toUpperCase() !== "EN")
      emit(out, call.callee.span, CODE, `the enabled box ${name} takes EN := as its first argument`)
    return
  }
  if (upper.endsWith("_ENO") && upper.length > 4) {
    if (declared)
      emit(out, call.callee.span, CODE, `the call ${name} names something declared in reach (a POU, an instance or a variable) whose name ends in _ENO, which the text reads as a box showing ENO`)
    return
  }
  if (!upper.endsWith("_EN")) return
  // A box showing ENO returns it, and is read by it (measured, design.md "3.0"): its value reaches no wire.
  const base = name.slice(0, -3)
  for (const a of call.args)
    if (a.output && a.param?.name.toUpperCase() === "OUT" && a.value?.kind === "ident_expr" && wires.has(a.value.name.toLowerCase()) && !isVariable(scope, base))
      emit(out, a.span, CODE, `the box ${name} returns its ENO, and its value reaches no wire: a box with EN read by its value is ${base}_ENONLY, which returns it`)
  if (declared)
    emit(out, call.callee.span, CODE, `the call ${name} names something declared in reach (a POU, an instance or a variable) whose name ends in _EN, which the text reads as an enabled box`)
  const en = call.args[0]
  if (en === undefined || en.output || en.param?.name.toUpperCase() !== "EN")
    emit(out, call.callee.span, CODE, `the enabled box ${name} takes EN := as its first argument`)
}

/** `BRANCH(FEED := f, b1, b2)`: the feed first if fed, then the branches, positional; at least one branch. */
function checkBranch(call: CallExpr, name: string, out: DiagnosticItem[]): void {
  const fed = call.args[0] !== undefined && !call.args[0].output && call.args[0].param?.name.toUpperCase() === "FEED"
  const branches = call.args.slice(fed ? 1 : 0)
  if (branches.some((a) => a.output || a.param !== undefined))
    emit(out, call.span, CODE, `the branch ${name} takes FEED := first, if fed, then its branches, positional`)
  else if (branches.length === 0) emit(out, call.span, CODE, `the branch ${name} holds no branch`)
}

/** `R_EDGE(x)`: one positional value — a contact (`x`, `NOT x`) or a box read where it stands, never a wire, a branch, a
 *  coil or another edge. */
function checkEdge(call: CallExpr, name: string, wires: ReadonlySet<string>, out: DiagnosticItem[]): void {
  const [arg, ...rest] = call.args
  if (arg === undefined || rest.length > 0 || arg.output || arg.param !== undefined || arg.value === undefined)
    return emit(out, call.span, CODE, `the edge ${name} takes one value, positional`)
  const v = arg.value
  const inner = v.kind === "unary" && v.op.toUpperCase() === "NOT" ? v.operand : v
  const element = v.kind === "call" && v.callee.kind === "ident_expr" && NETWORK_ELEMENTS.has(v.callee.name.toUpperCase())
  if (element || v.kind === "assign_expr" || (inner.kind === "ident_expr" && wires.has(inner.name.toLowerCase())))
    emit(out, call.span, CODE, `the edge ${name} over a wire, a branch, a coil, a box written as a statement or another edge: an edge is on a contact or on a box read where it stands`)
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
