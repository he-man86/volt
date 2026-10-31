/**
 * THE ONE NETWORK CHECK OF PLAIN-ST NETWORK TEXT (openspec network-text-st 2.3, design.md "The LSP subset"): a network
 * body is ST, read by the ST front-end and checked by every ST check; this says only what a network may hold, refused by
 * name, as the bridge's reader refuses it (`StNetworkReader`). Nothing else is network-specific: no lexer, no grammar,
 * no keyword list.
 *
 *   the `%` lines   `%NETWORK` opens a network; then `%DISABLED`, then its wires, then its `//` comment lines, then its
 *                   code (or its one `%UNSUPPORTED` line);
 *   statements      an assignment (`:=`, `S=`, `R=`, chained) whose targets may be a jump `JMP.l` or the return `RETURN`
 *                   (`:=` only, also in a tree), a call, the empty item `;`, and the network's label as its first
 *                   statement — no `IF`;
 *   expressions     every box a call; infix only the contacts (`a AND b`, `a OR b`); `NOT` before an operand or a box
 *                   read where it stands (its negated output);
 *   marks           `NOT`, `RISING`, `FALLING` before a receiver (a coil, a pin, EN, an output) are its own, the edge
 *                   outside the negation; none on a jump or the return, on a wire or a branch's feed, `NOT` on no `S=` /
 *                   `R=` coil, and a marked coil only first in its chain (every target receives the power flow);
 *   wires           a name its network declares, `VAR_TEMP w1 : ANY; END_VAR` on one line: declared in reach by nothing, named by one network, defined
 *                   once (`w := <box>`) and read by its name any number of times, before its definition too; a box's
 *                   output reaches no wire; an enabled box other than a comparison is read by its
 *                   value only as a coil's value, however often its wire is read (CODESYS: "A box with EN can be used for
 *                   comparison operators only.");
 *   boxes           the call is the box (`types` `infer/network-box.ts`): an FB's the call of its instance, or of its
 *                   type where it has none (`???`); `EN :=` first the shown EN; `.ENO` closes the call of a box
 *                   showing ENO, `.NAME` a consumed box whose callee declares several outputs, naming the one read — no
 *                   other member, none on a box with one output, none but `.ENO` at a root; `ENO => v` with `.ENO`;
 *   elements        `BRANCH(FEED := f, b1, b2)` / `BRANCH_SHORTCIRCUIT(…)` take the feed first, if fed, then the
 *                   branches, positional; `RISING(x)` / `FALLING(x)` one value, a contact or a box read where it stands;
 *                   `RAIL()` none; each is a value in a tree, and none names anything declared in reach; the Execute box
 *                   `EXECUTE(EN := e, '<ST>')` takes EN where it shows EN, then its ST, nothing else, and no member
 *                   closes its call (its one output is its ENO) — its ST full ST, read by the ST checks as it stands.
 *
 * A `%DISABLED` network is held to the subset too (it is text a push writes), though nothing compiles it.
 */
import {
  type BodySpan,
  type CallArg,
  type CallExpr,
  type Expr,
  isPlainStNetworkBody,
  type ParseResult,
  type PlainStExecute,
  type PlainStNetwork,
  plainStText,
  sourceStatements,
  type Span,
  type Statement,
  stmtExprs,
  unitBodies,
  walkExpr,
  allUnits,
  closedString,
  EXECUTE,
  UNNAMED,
  walkStatements,
} from "../../../frontend/syntax/index.js"
import { lookup, networkScope, scopeForUnit, type Scope } from "../../../frontend/symbols/index.js"
import { boxMember, NETWORK_ELEMENTS, networkBox, resolveCallee } from "../../../frontend/types/index.js"
import { messagesFor, type Messages } from "../../messages/index.js"
import { emit, SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { calleeText, checkBox } from "./_plain-st-box.js"
import { checkWires, CODE } from "./_plain-st-wires.js"


/** The `%` lines that stand before a network's code. */
const HEADER_LINES: ReadonlySet<string> = new Set(["NETWORK", "DISABLED", "UNSUPPORTED"])

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
      checkBody(body, bodyScope, project, out)
      checkUnnamed(body, bodyScope === undefined ? undefined : networkScope(bodyScope, body), project, parseResult.dialect, out)
      if (bodyScope !== undefined) checkBoxes(body, networkScope(bodyScope, body), project, parseResult.dialect === "twincat", messagesFor(parseResult.dialect), out)
    }
  return out
}

/**
 * What the IDE stores as `???` and the build answers in its own words, each vendor's (`network_unnamed_*`, both vendors):
 *  - a coil nobody named, `??? := a;`: "The assignment target is not specified." Behind an enable CODESYS adds two errors
 *    about an implicit variable it names itself, which no text holds; this one stands for them;
 *  - an FB box with no instance (`TON(IN := a);`, the call of its type): the build reads the instance `???` as text — the
 *    two errors of the marker, the instance error over the marker, the marker's first again — at the call's head;
 *  - `???` as an operand: the build reads it as text, "Expression expected instead of '?'" (the ST parser's, here too)
 *    and "Unexpected token '?' found".
 */
function checkUnnamed(body: BodySpan, scope: Scope | undefined, project: Scope, dialect: ParseResult["dialect"], out: DiagnosticItem[]): void {
  const tc = dialect === "twincat"
  const error = (span: Span, message: string) => out.push({ severity: "error", span, source: SOURCE, code: UNNAMED_CODE, message })
  const target = (t: Expr) => {
    if (t.kind === "ident_expr" && t.name === UNNAMED) error(t.span, tc ? "Assignment target not specified" : "The assignment target is not specified.")
  }
  const marker = "Expression expected instead of '?'"
  const unexpected = tc ? "Unexpected Token '?' found" : "Unexpected token '?' found"
  const targets = new Set<number>()
  walkStatements(sourceStatements(body).statements, (stmt) => {
    if (stmt.kind === "assign") target(stmt.target)
    if (stmt.kind === "assign") targets.add(stmt.target.span.start)
    for (const e of stmtExprs(stmt))
      walkExpr(e, (x) => {
        if (x.kind === "assign_expr") target(x.target)
        if (x.kind === "assign_expr") targets.add(x.target.span.start)
        const instance = x.kind === "call" && scope !== undefined ? networkBox(x, scope, project)?.instance : undefined
        if (x.kind === "call" && instance?.kind === "ident_expr" && instance.name === UNNAMED)
          for (const m of [marker, unexpected,
            "Program name, function or function block instance expected instead of '!!!'ERROR'!!!'", marker]) error(x.callee.span, m)
      })
  })
  // every other `???` is an operand (a contact, a box input, an output binding): the marker read as text
  for (const t of plainStText(body).sourceTokens)
    if (t.kind === "identifier" && t.text === UNNAMED && !targets.has(t.span.start)) {
      error(t.span, marker)
      error(t.span, unexpected)
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
        if (x.kind === "member" && x.base.kind === "call" && x.member.name.toUpperCase() === "ENO" && x.base.callee.kind === "member") {
          // a library function named through its namespace, closed by `.ENO`: CODESYS reads ENO as a member of its result
          const callee = x.base.callee
          const base = callee.base.kind === "ident_expr" ? lookup(scope, callee.base.name) : undefined
          if (!tc && callee.base.kind === "ident_expr" && (base === undefined || base.symbol.kind === "namespace"))
            error(x.member.span, "not-a-member", messages.notAMember("ENO", callee.member.name))
          return
        }
        if (x.kind !== "call") return
        const box = networkBox(x, scope, project)
        const inputs = (box?.pins ?? x.args).filter((a) => !a.output)
        if (x.callee.kind === "ident_expr") {
          const word = x.callee.name.toUpperCase()
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
        if (!inputs.some((a) => a.param === undefined)) return
        const callee = resolveCallee(x, scope, project)
        if (callee?.sym.kind === "method") error(x.callee.span, "function-argument-count", messages.functionRequiresInputs(callee.sym.name, callee.positionalArity))
      })
  })
}

function checkBody(body: BodySpan, scope: Scope | undefined, project: Scope, out: DiagnosticItem[]): void {
  const text = plainStText(body)
  // the scope the body's boxes resolve in: the unit's with the body's wires over it (`symbols` `network-scope.ts`)
  const boxes = scope === undefined ? undefined : networkScope(scope, body)
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
  const inExecute = (span: Span) => text.networks.some((n) => n.executes.some((x) => span.start >= x.code.start && span.start < x.code.end))
  const first = new Set<PlainStNetwork>()
  const wires = new Set(text.networks.flatMap((n) => n.wires.map((w) => w.name.toLowerCase())))
  for (const stmt of parsed.statements) {
    if (inExecute(stmt.span)) continue
    const network = of(stmt.span)
    if (network === undefined) continue
    checkStatement(stmt, !first.has(network), scope, boxes, project, wires, network.executes, out)
    first.add(network)
  }
  checkComments(body, text.networks, out)
  checkWires(parsed.statements, text.networks, of, inExecute, boxes, project, out)
  checkStrings(body, out)
}

/** A string spans lines only as the Execute box's ST (`network/execute-code.ts` rejoins only that one): any other one is refused as
 *  the bridge's reader refuses it. */
function checkStrings(body: BodySpan, out: DiagnosticItem[]): void {
  const text = plainStText(body)
  const code = new Set(text.networks.flatMap((n) => n.executes.map((x) => x.code.start - 1)))
  const unclosed = new Set(text.stray.map((s) => s.span.start))
  for (const t of text.tokens)
    if ((t.kind === "string_lit" || t.kind === "wstring_lit") && (t.span.endLine > t.span.startLine || !closedString(t.text)) &&
        !code.has(t.span.start) && !unclosed.has(t.span.start))
      emit(out, t.span, CODE, "a string across a line: only the Execute box's ST spans lines")
}

/** A network's `%` lines: `%NETWORK` first, then `%DISABLED`; `%UNSUPPORTED` alone under them. */
function checkLines(n: PlainStNetwork, body: BodySpan, out: DiagnosticItem[]): void {
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

function checkStatement(stmt: Statement, first: boolean, scope: Scope | undefined, boxes: Scope | undefined, project: Scope, wires: ReadonlySet<string>, executes: readonly PlainStExecute[], out: DiagnosticItem[]): void {
  const word = NOT_IN_A_NETWORK[stmt.kind]
  if (word !== undefined) return emit(out, stmt.span, CODE, `an LD/FBD network cannot hold a ${word}`)
  switch (stmt.kind) {
    case "label":
      if (!first) emit(out, stmt.span, CODE, "a label stands first in its network: it is the network's label")
      return
    case "if":
      return emit(out, stmt.span, CODE, "a network holds no IF: a jump on a value is JMP.label := value, a return RETURN := value")
    case "call_stmt":
      if (stmt.call.callee.kind === "ident_expr" && NETWORK_ELEMENTS.has(stmt.call.callee.name.toUpperCase()))
        emit(out, stmt.span, CODE, `the call ${stmt.call.callee.name} stands alone: a branch, an edge or the rail is a value in a tree`)
      checkExprs(stmt, scope, boxes, project, wires, executes, out)
      return
    case "expr_stmt":
      // a box at a root showing ENO, its call closed by `.ENO`: network text's one added statement form
      if (stmt.expr.kind === "member" && stmt.expr.base.kind === "call") {
        if (calleeText(stmt.expr.base).toUpperCase() === EXECUTE) return checkExprs(stmt, scope, boxes, project, wires, executes, out)
        const m = boxes === undefined ? undefined : boxMember(stmt.expr, boxes, project)
        if (m === undefined || !m.eno)
          emit(out, stmt.span, CODE, `the call ${calleeText(stmt.expr.base)} stands as a statement closed by .${stmt.expr.member.name}: a box at a root hands nothing on, and its call is closed by .ENO (it shows ENO) or by nothing`)
        checkExprs(stmt, scope, boxes, project, wires, executes, out)
        return
      }
      emit(out, stmt.span, CODE, "a statement a network cannot hold: an assignment, a call, a jump or a return")
      return
    case "assign":
      checkCoilMarks(stmt, wires, out)
      checkExprs(stmt, scope, boxes, project, wires, executes, out)
      return
    case "jmp":
    case "return":
      checkExprs(stmt, scope, boxes, project, wires, executes, out)
      return
    case "empty":
      return
    default:
      emit(out, stmt.span, CODE, "a statement a network cannot hold: an assignment, a call, a jump or a return")
  }
}

/** Infix only for the contacts; `NOT` only before an operand; every box as `checkBox` holds it. */
function checkExprs(stmt: Statement, scope: Scope | undefined, boxes: Scope | undefined, project: Scope, wires: ReadonlySet<string>, executes: readonly PlainStExecute[], out: DiagnosticItem[]): void {
  // the member closing each call, and the call standing as the statement (a root: it hands nothing on)
  const closer = new Map<CallExpr, string>()
  const root = stmt.kind === "call_stmt" ? stmt.call
    : stmt.kind === "expr_stmt" && stmt.expr.kind === "member" && stmt.expr.base.kind === "call" ? stmt.expr.base : undefined
  for (const e of stmtExprs(stmt)) walkExpr(e, (x) => { if (x.kind === "member" && x.base.kind === "call") closer.set(x.base, x.member.name) })
  for (const e of stmtExprs(stmt))
    walkExpr(e, (x) => {
      if (x.kind === "binary" && CALL_ONLY.has(x.op.toUpperCase()))
        emit(out, x.span, CODE, `an infix '${x.op}': in a network every box is a call, and only contacts are infix AND / OR`)
      if (x.kind === "unary" && x.op.toUpperCase() === "NOT") checkValueNot(x.operand, x.span, wires, out)
      if (x.kind === "assign_expr" && x.marks !== undefined) checkMarkOrder(x.marks, x.span, out)
      if (x.kind === "call") for (const a of x.args) if (a.marks !== undefined) checkPinMarks(x, a, out)
      if (x.kind === "call") checkCall(x, scope, wires, out)
      if (x.kind === "call" && calleeText(x).toUpperCase() === EXECUTE) return checkExecute(x, closer.get(x), scope, executes, out)
      if (x.kind === "call" && boxes !== undefined) checkBox(x, closer.get(x), x !== root, boxes, project, out)
    })
}

function isOperand(e: Expr): boolean {
  return e.kind === "ident_expr" || e.kind === "literal" || e.kind === "member" || e.kind === "index" || e.kind === "deref" || e.kind === "global_expr"
}

/** The head of a call that is the text's own (an element, the Execute box, a jump or the return), else undefined. */
function ownHead(e: Expr): string | undefined {
  if (e.kind !== "call" || e.callee.kind !== "ident_expr") return undefined
  const upper = e.callee.name.toUpperCase()
  return NETWORK_ELEMENTS.has(upper) || upper === EXECUTE || upper === "JMP" || upper === "RETURN" ? upper : undefined
}

/** THE VALUE MARK NOT: before a contact (an operand, no wire) or a box read where it stands (its negated output, `NOT
 *  t1(…).Q`) — the bridge's reader's rule (`StNetworkReader`). Before an edge the order is reversed (the IDE negates
 *  first); before anything else the text has no such mark. */
function checkValueNot(operand: Expr, span: Span, wires: ReadonlySet<string>, out: DiagnosticItem[]): void {
  const box = operand.kind === "member" && operand.base.kind === "call" ? operand.base : operand.kind === "call" ? operand : undefined
  const head = box === undefined ? undefined : ownHead(box)
  if (head === "RISING" || head === "FALLING")
    return emit(out, span, CODE, "NOT before an edge: the IDE negates first, so the edge is written outside the negation, RISING(NOT a)")
  if (box !== undefined && head === undefined) return
  if (box === undefined && isOperand(operand) && !(operand.kind === "ident_expr" && wires.has(operand.name.toLowerCase()))) return
  emit(out, span, CODE, "NOT before a wire, a branch, a coil, the rail, an Execute box or another NOT: NOT marks a contact or a box read where it stands, and the NOT box is NOT(…)")
}

/** THE MARKS BEFORE ONE RECEIVER, outermost first: the edge outside the negation (the IDE negates first, N17), each once. */
function checkMarkOrder(marks: readonly string[], span: Span, out: DiagnosticItem[]): void {
  let negated = false
  let edge = false
  for (const m of marks) {
    if (m === "NOT") {
      if (negated) return emit(out, span, CODE, "NOT twice before one receiver")
      negated = true
      continue
    }
    if (edge) return emit(out, span, CODE, "two edges before one receiver")
    if (negated) return emit(out, span, CODE, `NOT ${m}: the IDE negates first, so the edge is written outside the negation, ${m} NOT`)
    edge = true
  }
}

/** A pin's, EN's or an output's own marks: in order, and on no branch's feed (a Parallel holds no flag). */
function checkPinMarks(call: CallExpr, a: CallArg, out: DiagnosticItem[]): void {
  checkMarkOrder(a.marks!, a.span, out)
  if (ownHead(call)?.startsWith("BRANCH") === true) emit(out, a.span, CODE, `a mark on the branch's ${a.param?.name ?? "pin"}: a branch holds none`)
}

/** A coil's own marks: in order; `NOT` on no `S=` / `R=` coil (a negated set coil IS the reset coil); none on a wire; and a
 *  marked coil only first in its chain — every target receives the rung's power flow (measured), while a chained
 *  assignment hands its value on, and the two agree only there. */
function checkCoilMarks(stmt: Extract<Statement, { kind: "assign" }>, wires: ReadonlySet<string>, out: DiagnosticItem[]): void {
  const targets = [stmt.target, ...(stmt.chained ?? [])]
  const ops = [stmt.op, ...(stmt.chainOps ?? [])]
  stmt.marks?.forEach((m, i) => {
    if (m === undefined) return
    const t = targets[i]!
    checkMarkOrder(m, t.span, out)
    if (m.includes("NOT") && (ops[i] === "S=" || ops[i] === "R="))
      emit(out, t.span, CODE, `NOT ${calleeText({ kind: "call", callee: t, args: [], span: t.span })} ${ops[i]}: a negated set or reset coil is no coil of its own (the reset coil is R=)`)
    if (t.kind === "ident_expr" && wires.has(t.name.toLowerCase()))
      emit(out, t.span, CODE, `a mark on the wire ${t.name}: a wire holds none, its producer or a consumer does`)
    if (i > 0)
      emit(out, t.span, CODE, "a marked coil inside a chain: every target receives the rung's power flow, and a chained assignment would hand the marked value on")
  })
}

function checkCall(call: CallExpr, scope: Scope | undefined, wires: ReadonlySet<string>, out: DiagnosticItem[]): void {
  if (call.callee.kind !== "ident_expr") return
  const name = call.callee.name
  const upper = name.toUpperCase()
  const declared = scope !== undefined && lookup(scope, name) !== undefined
  // a jump or the return in a tree, `(JMP.l := v)`: read as this call (`network/plain-st.ts`), always well formed
  if (upper === "JMP" || upper === "RETURN") return
  if (NETWORK_ELEMENTS.has(upper)) {
    if (declared) emit(out, call.callee.span, CODE, `the call ${name} names something declared in reach, which the text reads as its own ${upper}`)
    if (upper === "RAIL") return call.args.length === 0 ? undefined : emit(out, call.span, CODE, "the rail RAIL() takes no value and names no output")
    return upper.startsWith("BRANCH") ? checkBranch(call, name, out) : checkEdge(call, name, wires, out)
  }
}

/** THE EXECUTE BOX, `EXECUTE(EN := e, '<ST>')` (its `'…'` trivia to the ST parser, `plain-st.ts`): EN first
 *  where it shows EN, then its ST, nothing else; no member closes its call, its one output its ENO; and nothing declared in
 *  reach is named EXECUTE — the bridge's reader refuses each in the same words (`StNetworkReader.ExecuteBox`). */
function checkExecute(call: CallExpr, member: string | undefined, scope: Scope | undefined, executes: readonly PlainStExecute[], out: DiagnosticItem[]): void {
  const name = calleeText(call)
  if (scope !== undefined && lookup(scope, name) !== undefined)
    return emit(out, call.callee.span, CODE, `the call ${name} names something declared in reach, which the text reads as its Execute box`)
  if (member !== undefined) return emit(out, call.span, CODE, `the Execute box is closed by .${member}: its one output is its ENO, read where the box stands`)
  const en = call.args[0] !== undefined && !call.args[0].output && call.args[0].param?.name.toUpperCase() === "EN"
  const code = executes.some((x) => x.call.start === call.span.start)
  if (!code || call.args.length > (en ? 1 : 0))
    emit(out, call.span, CODE, "the Execute box takes EN := first where it shows EN, then its ST as one string '<ST>', and nothing else")
}

/** `BRANCH(FEED := f, b1, b2)`: the feed first if fed, then the branches, positional; at least one branch. */
function checkBranch(call: CallExpr, name: string, out: DiagnosticItem[]): void {
  const fed = call.args[0] !== undefined && !call.args[0].output && call.args[0].param?.name.toUpperCase() === "FEED"
  const branches = call.args.slice(fed ? 1 : 0)
  if (branches.some((a) => a.output || a.param !== undefined))
    emit(out, call.span, CODE, `the branch ${name} takes FEED := first, if fed, then its branches, positional`)
  else if (branches.length === 0) emit(out, call.span, CODE, `the branch ${name} holds no branch`)
}

/** `RISING(x)`: one positional value — a contact (`x`, `NOT x`) or a box read where it stands, never a wire, a branch, a
 *  coil or another edge. */
function checkEdge(call: CallExpr, name: string, wires: ReadonlySet<string>, out: DiagnosticItem[]): void {
  const [arg, ...rest] = call.args
  if (arg === undefined || rest.length > 0 || arg.output || arg.param !== undefined || arg.value === undefined)
    return emit(out, call.span, CODE, `the edge ${name} takes one value, positional`)
  const v = arg.value
  const inner = v.kind === "unary" && v.op.toUpperCase() === "NOT" ? v.operand : v
  const element = v.kind === "call" && v.callee.kind === "ident_expr" && NETWORK_ELEMENTS.has(v.callee.name.toUpperCase())
  if (element || v.kind === "assign_expr" || (inner.kind === "ident_expr" && wires.has(inner.name.toLowerCase())))
    emit(out, call.span, CODE, `the edge ${name} over a wire, a branch, a coil, the rail, an Execute box or another edge: an edge is on a contact or on a box read where it stands`)
}

/** A `//` comment stands before its network's code; a block comment or a pragma nowhere (an Execute box's ST is its
 *  string's content, no token of the network). */
function checkComments(body: BodySpan, networks: readonly PlainStNetwork[], out: DiagnosticItem[]): void {
  for (const n of networks) {
    let code = false
    for (const t of plainStText(body).tokens) {
      if (t.span.start < n.span.start || t.span.start >= n.span.end) continue
      if (t.kind === "block_comment" || t.kind === "pragma")
        emit(out, t.span, CODE, t.kind === "pragma" ? "a pragma {…} in a network: a network holds none" : "a (* comment in a network: a network's comment is its // lines before the code")
      else if (t.kind === "line_comment" && code)
        emit(out, t.span, CODE, "a // comment after the code starts: a network's comment is its // lines before the code")
      else if (t.kind !== "whitespace" && t.kind !== "line_comment" && t.kind !== "eof" && !n.lines.some((l) => HEADER_LINES.has(l.key) && t.span.start >= l.span.start && t.span.start <= l.span.end) &&
               !(n.declaration !== undefined && t.span.start >= n.declaration.start && t.span.start < n.declaration.end))
        code = true
    }
  }
}
