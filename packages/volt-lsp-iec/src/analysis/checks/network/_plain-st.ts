/**
 * THE ONE NETWORK CHECK OF PLAIN-ST NETWORK TEXT (openspec network-text-st 2.3, design.md "The LSP subset"): a network
 * body is ST, read by the ST front-end and checked by every ST check; this says only what a network may hold, refused by
 * name, as the bridge's reader refuses it (`StNetworkReader`). Nothing else is network-specific: no lexer, no grammar,
 * no keyword list.
 *
 *   the `%` lines   `%NETWORK` opens a network; then `%DISABLED`, then its wires, then its `//` comment lines, then its
 *                   code (or its one `%UNSUPPORTED` line);
 *   statements      an assignment (`:=`, `S=`, `R=`, chained) whose targets may be a jump `JMP.l` or the return `RETURN`
 *                   (`:=` only, also in a tree), a value standing alone as it stands in a tree (`a;`, `NOT AND(a, b);`,
 *                   `RAIL();`, a box consumed by nothing), the empty item `;`, and the network's label as its first
 *                   statement — no `IF`;
 *   expressions     every box a call; infix only the contacts (`a AND b`, `a OR b`); `NOT` before an operand or a box
 *                   read where it stands (its negated output, an Execute box's too); `COMMENT(a, 'why')` wherever an
 *                   operand stands (`comment-text.ts` holds its form);
 *   marks           `NOT`, `RISING`, `FALLING` before a receiver (a coil, a pin, EN, an output, a jump, the return) are
 *                   its own, the edge outside the negation; none on a wire or a branch's feed, `NOT` on no `S=` / `R=`
 *                   coil, and a marked receiver only first in its chain (every target receives the power flow); the
 *                   assignment item's marks (`y := NOT := a`) last in its chain, right before its value;
 *   wires           a name its network declares, `VAR w1 : ANY; END_VAR` on one line: declared in reach by nothing, named by one network, defined
 *                   once (`w := <box>`) and read by its name any number of times, before its definition too; a box's
 *                   output reaches no wire; an enabled box other than a comparison is read by its
 *                   value only as a coil's value, however often its wire is read (CODESYS: "A box with EN can be used for
 *                   comparison operators only.");
 *   boxes           the call is the box (`types` `infer/network-box.ts`): an FB's the call of its instance, or of its
 *                   type where it has none (`???`); `EN :=` first the shown EN; `.ENO` closes the call of a box
 *                   showing ENO, `.NAME` a box whose callee declares several outputs, naming the one read, at a root its
 *                   main slot past the first — no other member, none on a box with one output; `ENO => v` with `.ENO`;
 *   elements        `BRANCH(FEED := f, b1, b2)` / `BRANCH_SHORTCIRCUIT(…)` take the feed first, if fed, then the
 *                   branches, positional; `RISING(x)` / `FALLING(x)` one value, a contact or a box read where it stands;
 *                   `RAIL()` none; none names anything declared in reach (nor does `COMMENT`); the Execute box
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
  COMMENT,
  EXECUTE,
  isTrivia,
  type Token,
  UNNAMED,
  walkStatements,
} from "../../../frontend/syntax/index.js"
import { lookup, networkScope, scopeForUnit, type Scope } from "../../../frontend/symbols/index.js"
import { boxMember, NETWORK_ELEMENTS, networkBox, resolveCallee, rootBox } from "../../../frontend/types/index.js"
import { messagesFor, type Messages } from "../../messages/index.js"
import { emit, SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { calleeText, checkBox } from "./_plain-st-box.js"
import { checkWires, CODE } from "./_plain-st-wires.js"
import { checkComments, checkLines, checkNumbering, checkStrings } from "./_plain-st-lines.js"
import { checkCoilMarks, checkControlMarks, checkItemMarks, checkMarkOrder, checkPinMarks, checkTreeMarks, checkValueNot } from "./_plain-st-marks.js"


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
 *    and "Unexpected token '?' found";
 *  - `???` on a box's output pin (`p(OUT => ???)`): an output nothing is wired to, which the build compiles clean
 *    (lenze-mid's recorded build, its `Mach1_MIDS` and `AHWF` boxes) — nothing.
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
        if (x.kind === "call")
          for (const a of x.args) if (a.output && a.value?.kind === "ident_expr" && a.value.name === UNNAMED) targets.add(a.value.span.start)
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
  checkNumbering(text, scope, out)
  const operand = text.networks.flatMap((n) => n.operands)[0]
  if (operand !== undefined && scope !== undefined && lookup(scope, "OPERAND") !== undefined)
    emit(out, operand, CODE, "the call OPERAND names something declared in reach, which the text reads as its own OPERAND")
  const comment = text.networks.flatMap((n) => n.comments)[0]
  if (comment !== undefined && scope !== undefined && lookup(scope, COMMENT) !== undefined)
    emit(out, comment.call, CODE, `the call ${COMMENT} names something declared in reach, which the text reads as its own operand comment`)
  const parsed = sourceStatements(body)
  const of = (span: Span) => text.networks.find((n) => span.start >= n.span.start && span.start < n.span.end)
  const inExecute = (span: Span) => text.networks.some((n) => n.executes.some((x) => span.start >= x.code.start && span.start < x.code.end))
  const first = new Set<PlainStNetwork>()
  const wires = new Set(text.networks.flatMap((n) => n.wires.map((w) => w.name.toLowerCase())))
  checkItemMarks(parsed.statements, text.itemMarks, wires, out)
  for (const stmt of parsed.statements) {
    if (inExecute(stmt.span)) continue
    const network = of(stmt.span)
    if (network === undefined) continue
    checkStatement(stmt, !first.has(network), scope, boxes, project, wires, network, out)
    first.add(network)
  }
  checkComments(body, text.networks, out)
  checkWires(parsed.statements, text.networks, of, inExecute, boxes, project, out)
  checkStrings(body, out)
}

function checkStatement(stmt: Statement, first: boolean, scope: Scope | undefined, boxes: Scope | undefined, project: Scope, wires: ReadonlySet<string>, network: PlainStNetwork, out: DiagnosticItem[]): void {
  const word = NOT_IN_A_NETWORK[stmt.kind]
  if (word !== undefined) return emit(out, stmt.span, CODE, `an LD/FBD network cannot hold a ${word}`)
  switch (stmt.kind) {
    case "label":
      if (!first) emit(out, stmt.span, CODE, "a label stands first in its network: it is the network's label")
      return
    case "if":
      return emit(out, stmt.span, CODE, "a network holds no IF: a jump on a value is JMP.label := value, a return RETURN := value")
    case "call_stmt":
      checkExprs(stmt, scope, boxes, project, wires, network, out)
      return
    case "expr_stmt":
      // a member closes a call only where the call is a box (`checkBox` judges the member)
      if (stmt.expr.kind === "member" && stmt.expr.base.kind === "call" && calleeText(stmt.expr.base).toUpperCase() !== EXECUTE &&
          boxes !== undefined && boxMember(stmt.expr, boxes, project) === undefined)
        emit(out, stmt.span, CODE, `the call ${calleeText(stmt.expr.base)} stands as a statement closed by .${stmt.expr.member.name}: it is no box`)
      // a value standing alone, as it stands in a tree (`a;`, `NOT AND(a, b);`, `RAIL();`) — but no bracketed assignment
      if (stmt.expr.kind === "paren" && stmt.expr.inner.kind === "assign_expr")
        emit(out, stmt.span, CODE, "an assignment in brackets standing alone: an assignment is written without them, y := a;")
      checkExprs(stmt, scope, boxes, project, wires, network, out)
      return
    case "assign":
      checkCoilMarks(stmt, wires, out)
      checkExprs(stmt, scope, boxes, project, wires, network, out)
      return
    case "jmp":
    case "return":
      checkControlMarks(stmt, out)
      checkExprs(stmt, scope, boxes, project, wires, network, out)
      return
    case "empty":
      return
    default:
      emit(out, stmt.span, CODE, "a statement a network cannot hold: an assignment, a call, a jump or a return")
  }
}

/** Infix only for the contacts; `NOT` only before an operand; every box as `checkBox` holds it. */
function checkExprs(stmt: Statement, scope: Scope | undefined, boxes: Scope | undefined, project: Scope, wires: ReadonlySet<string>, network: PlainStNetwork, out: DiagnosticItem[]): void {
  // the member closing each call, and the call standing as the statement (a root)
  const closer = new Map<CallExpr, string>()
  // (the box a value standing alone is, its marks around it: `rootBox`)
  const root = stmt.kind === "call_stmt" ? (rootBox(stmt.call)?.call ?? stmt.call) : stmt.kind === "expr_stmt" ? rootBox(stmt.expr)?.call : undefined
  for (const e of stmtExprs(stmt)) walkExpr(e, (x) => { if (x.kind === "member" && x.base.kind === "call") closer.set(x.base, x.member.name) })
  checkBrackets(stmt, network, out)
  for (const e of stmtExprs(stmt))
    walkExpr(e, (x) => {
      // an OPERAND's text is the operand's own ST (`operand-text.ts`): no box, no subset
      if (network.operands.some((o) => x.span.start >= o.start && x.span.end <= o.end)) return
      if (x.kind === "binary" && CALL_ONLY.has(x.op.toUpperCase()))
        emit(out, x.span, CODE, `an infix '${x.op}': in a network every box is a call, and only contacts are infix AND / OR`)
      // NOT before an OPERAND marks that operand, a contact
      const operandText = x.kind === "unary" && x.operand.kind === "paren" && network.operands.some((o) => x.operand.span.start < o.start && x.operand.span.end > o.end)
      if (x.kind === "unary" && x.op.toUpperCase() === "NOT" && !operandText) checkValueNot(x.operand, x.span, wires, out)
      if ((x.kind === "assign_expr" || x.kind === "call") && x.marks !== undefined) {
        checkMarkOrder(x.marks, x.span, out)
        checkTreeMarks(x, out)
      }
      if (x.kind === "call") for (const a of x.args) if (a.marks !== undefined) checkPinMarks(x, a, out)
      if (x.kind === "call") checkCall(x, scope, wires, out)
      if (x.kind === "call" && calleeText(x).toUpperCase() === EXECUTE) return checkExecute(x, closer.get(x), x !== root, scope, network.executes, out)
      if (x.kind === "call" && boxes !== undefined) checkBox(x, closer.get(x), x !== root, boxes, project, out)
    })
}

/** The binding of each infix operator, loosest first (`StNetworkReader.Levels`). */
const INFIX_LEVEL: Readonly<Record<string, number>> = { OR: 0, XOR: 1, AND: 2, "&": 2, "=": 3, "<>": 3, "<": 4, ">": 4, "<=": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, MOD: 6 }

/** A bracket groups a chain inside a tighter chain or the same one (a second box), and nothing else: the writer brackets
 *  exactly these, so any other bracket is a second spelling — the bridge's reader refuses it in the same words. A
 *  bracketed assignment (`(JMP.l := c)`) and the bracket of `NOT(…)` are no grouping bracket. */
function checkBrackets(stmt: Statement, network: PlainStNetwork, out: DiagnosticItem[]): void {
  const grouping = new Set<Expr>()
  const level = (op: string) => INFIX_LEVEL[op.toUpperCase()] ?? Infinity
  for (const e of stmtExprs(stmt))
    walkExpr(e, (x) => {
      if (x.kind === "unary" && x.operand.kind === "paren") grouping.add(x.operand)
      if (x.kind !== "binary") return
      for (const side of [x.left, x.right])
        if (side.kind === "paren" && side.inner.kind === "binary" && level(side.inner.op) <= level(x.op)) grouping.add(side)
    })
  for (const e of stmtExprs(stmt))
    walkExpr(e, (x) => {
      if (x.kind !== "paren" || grouping.has(x) || x.inner.kind === "assign_expr") return
      // a jump or the return in a tree, `(JMP.l := c)`, read as its call (`network/plain-st.ts`)
      if (x.inner.kind === "call" && ["JMP", "RETURN"].includes(calleeText(x.inner).toUpperCase())) return
      // an OPERAND's text, the operand's own ST (`operand-text.ts`)
      const inner = x.inner.span
      if (network.operands.some((o) => inner.start >= o.start && inner.end <= o.end)) return
      emit(out, x.span, CODE, "a bracket that groups nothing: a bracket holds an AND / OR chain inside a tighter chain or the same one")
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
function checkExecute(call: CallExpr, member: string | undefined, consumed: boolean, scope: Scope | undefined, executes: readonly PlainStExecute[], out: DiagnosticItem[]): void {
  const name = calleeText(call)
  if (scope !== undefined && lookup(scope, name) !== undefined)
    return emit(out, call.callee.span, CODE, `the call ${name} names something declared in reach, which the text reads as its Execute box`)
  // EN and ENO as on every box (network-text-one-to-one F13): `.ENO` shows the ENO, its one output, at a root too
  const eno = member?.toUpperCase() === "ENO"
  if (member !== undefined && !eno) return emit(out, call.span, CODE, `the Execute box is closed by .${member}: its one output is its ENO, read as .ENO`)
  const en = call.args[0] !== undefined && !call.args[0].output && call.args[0].param?.name.toUpperCase() === "EN"
  const code = executes.some((x) => x.call.start === call.span.start)
  if (!code || call.args.length > (en ? 1 : 0))
    emit(out, call.span, CODE, "the Execute box takes EN := first where it shows EN, then its ST as one string '<ST>', and nothing else")
  else if (consumed && !eno) emit(out, call.span, CODE, "the Execute box is read and shows no ENO: its one output is its ENO, read as .ENO")
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
    emit(out, call.span, CODE, `the edge ${name} over a wire, a branch, a coil, the rail or another edge: an edge is on a contact or on a box read where it stands`)
}
