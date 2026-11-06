/**
 * THE ONE NETWORK CHECK OF PLAIN-ST NETWORK TEXT (openspec network-language, design.md "The LSP subset"): a network body
 * is ST, read by the ST front-end and checked by every ST check; this says only what a network may hold, refused by name,
 * as the bridge's reader refuses it (`StNetworkReader`). Nothing else is network-specific: no lexer, no grammar, no
 * keyword list.
 *
 *   the `%` lines   `%NETWORK` opens a network; then `%DISABLED`, then its wires, then its `//` comment lines, then its
 *                   code (or its one `%UNSUPPORTED` line);
 *   statements      an `ASSIGN(value, Q => y, …)` (every coil, jump and return), a wire's definition `w1 := value`, a value
 *                   standing alone (`a;`, `RAIL();`, a box whose flow ends), the empty item `;`, and the network's label as
 *                   its first statement — no `IF`, no other assignment;
 *   expressions     every box a call; infix only the contacts (`a AND b`, `a OR b`); `COMMENT(a, 'why')` wherever an
 *                   operand stands (`comment-text.ts` holds its form);
 *   marks           a function on the value, nested in run order: `INVERT(a)`, `RISING(a)`, `FALLING(a)`, at most two of
 *                   each on one line; on a receiver its output name (`Q_INVERTED => x`, `Q_SET => k`);
 *   wires           a name its network declares, `VAR w1 : ANY; END_VAR` on one line: declared in reach by nothing, named by one network, defined
 *                   once (`w := <box>`) and read by its name any number of times, before its definition too; no box's
 *                   output and no ASSIGN's target is a wire; an enabled box other than a comparison is read by a data
 *                   output only as a coil's value, however often its wire is read (CODESYS: "A box with EN can be used
 *                   for comparison operators only.");
 *   boxes           the call is the box (`types` `infer/network-box.ts`): an FB's the call of its instance, or of its
 *                   type where it has none (`???`); `EN :=` first the shown EN; the box hands on its default output — its
 *                   ENO where EN is shown, else a function's value, an FB's first output — and a member closes its call
 *                   only where another output flows on;
 *   elements        `BRANCH(FEED := f, b1, b2)` / `BRANCH_SHORTCIRCUIT(…)` take the feed first, if fed, then the
 *                   branches, positional; `RISING(x)` / `FALLING(x)` / `INVERT(x)` one value; `RAIL()` none; none names
 *                   anything declared in reach (nor does `COMMENT`); the Execute box `EXECUTE(EN := e, '<ST>')` takes EN
 *                   where it shows EN, then its ST, nothing else, and no member closes its call (its one output is its
 *                   ENO) — its ST full ST, read by the ST checks as it stands.
 *
 * A `%DISABLED` network is held to the subset too (it is text a push writes), though nothing compiles it.
 */
import {
  emptyPinMessage,
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
  ASSIGN,
  assignFormFinding,
  closedString,
  COMMENT,
  EXECUTE,
  INVERT,
  isTrivia,
  type Token,
  UNNAMED,
  walkStatements,
} from "../../../frontend/syntax/index.js"
import { lookup, networkScope, scopeForUnit, type Scope } from "../../../frontend/symbols/index.js"
import { boxMember, isOperatorBox, NETWORK_ELEMENTS, networkBox, resolveCallee, rootBox, VALUE } from "../../../frontend/types/index.js"
import { messagesFor, type Messages } from "../../messages/index.js"
import { emit, SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { calleeText, checkBox } from "./_plain-st-box.js"
import { checkWires, CODE } from "./_plain-st-wires.js"
import { checkComments, checkLines, checkNumbering, checkStrings } from "./_plain-st-lines.js"
import { checkMarks, checkRetiredForms } from "./_plain-st-marks.js"


/** The names the text spells its own calls with: a POU or variable of one of them in reach is refused (rule 9). */
const RESERVED: readonly string[] = [INVERT, "RISING", "FALLING", ASSIGN]

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
 * What the IDE stores as `???` and the build answers in its own words, each vendor's (`network_unnamed_*`, both vendors;
 * the box map, `box-states#0047,0153`):
 *  - a coil nobody named, `ASSIGN(a, Q => ???)`: "The assignment target is not specified." Behind an enable CODESYS adds
 *    two errors about an implicit variable it names itself, which no text holds; this one stands for them;
 *  - an FB box with no instance (`TON(IN := a);`, the call of its type): the build reads the instance `???` as text — the
 *    two errors of the marker, the instance error over the marker, the marker's first again — at the call's head;
 *  - `???` as an operand, or on a function's value `OUT => ???`: the build reads it as text, "Expression expected instead
 *    of '?'" (the ST parser's, here too) and "Unexpected token '?' found"; on an operator's (`MOVE(i, OUT => ???)`) the
 *    coil's own error, "The assignment target is not specified." (box-states#0433,0529);
 *  - `???` on an output a block or a program declares (`t2(q1 => ???)`) and on a jump's label (`JMP.???`): the first of
 *    those alone, "Expression expected instead of '?'" (C0007), on the `???`;
 *  - `???` on the unnamed slot the IDE stores past a block's or a program's declared outputs (`p(OUT => ???)`): an output
 *    nothing is wired to, which the build compiles clean (lenze-mid's recorded build, its `Mach1_MIDS` and `AHWF`
 *    boxes) — nothing.
 */
function checkUnnamed(body: BodySpan, scope: Scope | undefined, project: Scope, dialect: ParseResult["dialect"], out: DiagnosticItem[]): void {
  const tc = dialect === "twincat"
  const error = (span: Span, message: string) => out.push({ severity: "error", span, source: SOURCE, code: UNNAMED_CODE, message })
  const target = (t: Expr) => {
    if (t.kind === "ident_expr" && t.name === UNNAMED) error(t.span, tc ? "Assignment target not specified" : "The assignment target is not specified.")
  }
  const marker = "Expression expected instead of '?'"
  const unexpected = tc ? "Unexpected Token '?' found" : "Unexpected token '?' found"
  // the `???` read otherwise than as an operand: a coil's target, an output's binding, a jump's label
  const handled = new Set<number>()
  const isUnnamed = (e: Expr | undefined): e is Extract<Expr, { kind: "ident_expr" }> => e?.kind === "ident_expr" && e.name === UNNAMED
  walkStatements(sourceStatements(body).statements, (stmt) => {
    if (stmt.kind === "assign") for (const t of [stmt.target, ...(stmt.chained ?? [])]) {
      target(t)
      handled.add(t.span.start)
    }
    if (stmt.kind === "jmp" && isUnnamed(stmt.target)) {
      error(stmt.target.span, marker)
      handled.add(stmt.target.span.start)
    }
    for (const e of stmtExprs(stmt))
      walkExpr(e, (x) => {
        if (x.kind === "assign_expr") target(x.target)
        if (x.kind === "assign_expr") handled.add(x.target.span.start)
        if (x.kind === "call" && x.callee.kind === "ident_expr" && x.callee.name.toUpperCase() === "JMP" && isUnnamed(x.args[0]?.value)) {
          error(x.args[0]!.value!.span, marker)
          handled.add(x.args[0]!.value!.span.start)
        }
        const box = x.kind === "call" && scope !== undefined ? networkBox(x, scope, project) : undefined
        if (x.kind === "call")
          for (const a of x.args) {
            if (!a.output || !isUnnamed(a.value)) continue
            handled.add(a.value.span.start)
            const name = a.param?.name.toUpperCase()
            const declared = box?.signature?.outputs.some((o) => o.toUpperCase() === name) === true
            const fnValue = name === VALUE && box?.signature?.shape === "function" && box.instance === undefined
            if (declared) error(a.value.span, marker)
            else if (fnValue && isOperatorBox(box!)) target(a.value)
            else if (fnValue) {
              error(a.value.span, marker)
              error(a.value.span, unexpected)
            }
          }
        if (x.kind === "call" && box?.instance?.kind === "ident_expr" && box.instance.name === UNNAMED)
          for (const m of [marker, unexpected,
            "Program name, function or function block instance expected instead of '!!!'ERROR'!!!'", marker]) error(x.callee.span, m)
      })
  })
  // every other `???` is an operand (a contact, a box input): the marker read as text
  for (const t of plainStText(body).sourceTokens)
    if (t.kind === "identifier" && t.text === UNNAMED && !handled.has(t.span.start)) {
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
        if (x.kind !== "call") return
        const en = x.args[0] !== undefined && !x.args[0].output && x.args[0].param?.name.toUpperCase() === "EN"
        if (en && x.callee.kind === "member") {
          // a library function named through its namespace, showing EN and so its ENO: CODESYS reads ENO as a member of
          // its result
          const callee = x.callee
          const base = callee.base.kind === "ident_expr" ? lookup(scope, callee.base.name) : undefined
          if (!tc && callee.base.kind === "ident_expr" && (base === undefined || base.symbol.kind === "namespace"))
            error(callee.member.span, "not-a-member", messages.notAMember("ENO", callee.member.name))
          return
        }
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
  // a name the text spells its own call with, declared in reach (network-language rule 9)
  const reserved = scope === undefined ? undefined : RESERVED.find((n) => lookup(scope, n) !== undefined)
  if (reserved !== undefined)
    emit(out, body.languageLine?.span ?? body.span, CODE, `a POU or variable named INVERT, RISING, FALLING or ASSIGN is refused: '${reserved}' is declared in reach, and the text spells its own call with that name`)
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
      return emit(out, stmt.span, CODE, "a network holds no IF: a jump on a value is ASSIGN(value, Q => JMP.label), a return ASSIGN(value, Q => RETURN)")
    case "call_stmt":
      checkExprs(stmt, scope, boxes, project, wires, network, out)
      return
    case "expr_stmt":
      // a member closes a call only where the call is a box (`checkBox` judges the member)
      if (stmt.expr.kind === "member" && stmt.expr.base.kind === "call" && calleeText(stmt.expr.base).toUpperCase() !== EXECUTE &&
          boxes !== undefined && boxMember(stmt.expr, boxes, project) === undefined)
        emit(out, stmt.span, CODE, `the call ${calleeText(stmt.expr.base)} stands as a statement closed by .${stmt.expr.member.name}: it is no box`)
      // a value standing alone, as it stands in a tree (`a;`, `INVERT(AND(a, b));`, `RAIL();`)
      checkExprs(stmt, scope, boxes, project, wires, network, out)
      return
    case "assign":
    case "jmp":
    case "return":
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
  checkRetiredForms(stmt, wires, out)
  checkMarks(stmt, wires, out)
  for (const e of stmtExprs(stmt))
    walkExpr(e, (x) => {
      // an OPERAND's text is the operand's own ST (`operand-text.ts`): no box, no subset
      if (network.operands.some((o) => x.span.start >= o.start && x.span.end <= o.end)) return
      if (x.kind === "binary" && CALL_ONLY.has(x.op.toUpperCase()))
        emit(out, x.span, CODE, `an infix '${x.op}': in a network every box is a call, and only contacts are infix AND / OR`)
      if (x.kind === "call") for (const a of x.args) { const empty = emptyPinMessage(a); if (empty !== undefined) emit(out, a.span, CODE, empty) }
      if (x.kind === "call") checkCall(x, scope, wires, out)
      if (x.kind === "call" && calleeText(x).toUpperCase() === EXECUTE) return checkExecute(x, closer.get(x), scope, network.executes, out)
      if (x.kind === "call" && boxes !== undefined) checkBox(x, closer.get(x), x !== root, boxes, project, out)
    })
}

/** The binding of each infix operator, loosest first (`StNetworkReader.Levels`). */
const INFIX_LEVEL: Readonly<Record<string, number>> = { OR: 0, XOR: 1, AND: 2, "&": 2, "=": 3, "<>": 3, "<": 4, ">": 4, "<=": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, MOD: 6 }

/** A bracket groups a chain inside a tighter chain or the same one (a second box), and nothing else: the writer brackets
 *  exactly these, so any other bracket is a second spelling — the bridge's reader refuses it in the same words. A
 *  bracketed assignment (an inline wire `(w1 := a)`, a retired coil) and the bracket of `NOT(…)` are no grouping bracket. */
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
      // a jump or the return written in a tree the retired way, `(JMP.l := c)` (`checkRetiredForms` names it)
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
  // a jump or the return in a tree (an ASSIGN's target), read as this call (`network/plain-st.ts`), always well formed
  if (upper === "JMP" || upper === "RETURN") return
  if (NETWORK_ELEMENTS.has(upper)) {
    if (declared) emit(out, call.callee.span, CODE, `the call ${name} names something declared in reach, which the text reads as its own ${upper}`)
    if (upper === "RAIL") return call.args.length === 0 ? undefined : emit(out, call.span, CODE, "the rail RAIL() takes no value and names no output")
    // a well-formed ASSIGN or INVERT is read as what it is (`network/plain-st.ts`): one still a call is malformed
    if (upper === ASSIGN) return emit(out, call.span, CODE, assignFormFinding(call) ?? "ASSIGN(value, Q => y)")
    if (upper === INVERT) return emit(out, call.span, CODE, `the mark ${name} takes one value, positional, and names no output`)
    return upper.startsWith("BRANCH") ? checkBranch(call, name, out) : checkEdge(call, name, out)
  }
}

/** THE EXECUTE BOX, `EXECUTE(EN := e, '<ST>')` (its `'…'` trivia to the ST parser, `plain-st.ts`): EN first
 *  where it shows EN, then its ST, nothing else; no member closes its call, its one output its ENO; and nothing declared in
 *  reach is named EXECUTE — the bridge's reader refuses each in the same words (`StNetworkReader.ExecuteBox`). */
function checkExecute(call: CallExpr, member: string | undefined, scope: Scope | undefined, executes: readonly PlainStExecute[], out: DiagnosticItem[]): void {
  const name = calleeText(call)
  if (scope !== undefined && lookup(scope, name) !== undefined)
    return emit(out, call.callee.span, CODE, `the call ${name} names something declared in reach, which the text reads as its Execute box`)
  // its one output is its ENO, the flow it hands on (network-text-one-to-one F13): no member closes its call
  if (member !== undefined) return emit(out, call.span, CODE, `the Execute box is closed by .${member}: its one output is its ENO, which flows on with no member`)
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

/** `RISING(x)`: one positional value. */
function checkEdge(call: CallExpr, name: string, out: DiagnosticItem[]): void {
  const [arg, ...rest] = call.args
  if (arg === undefined || rest.length > 0 || arg.output || arg.param !== undefined || arg.value === undefined)
    emit(out, call.span, CODE, `the mark ${name} takes one value, positional, and names no output`)
}
