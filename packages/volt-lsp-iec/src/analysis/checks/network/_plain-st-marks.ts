/**
 * THE MARKS OF A PLAIN-ST NETWORK BODY, as the network check holds them (`_plain-st.ts`, the one network check, holds the
 * rest): the value mark NOT, and the marks before a receiver — a coil, a pin, EN, an output — each in the IDE's order, on
 * nothing that holds none. Refused by name, as the bridge's reader refuses each (`StNetworkReader`).
 */
import { type CallArg, type CallExpr, type Expr, type Span, type Statement, EXECUTE, stmtExprs, walkExpr, walkStatements } from "../../../frontend/syntax/index.js"
import { NETWORK_ELEMENTS } from "../../../frontend/types/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { calleeText } from "./_plain-st-box.js"
import { CODE } from "./_plain-st-wires.js"

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
export function checkValueNot(operand: Expr, span: Span, wires: ReadonlySet<string>, out: DiagnosticItem[]): void {
  const box = operand.kind === "member" && operand.base.kind === "call" ? operand.base : operand.kind === "call" ? operand : undefined
  const head = box === undefined ? undefined : ownHead(box)
  if (head === "RISING" || head === "FALLING")
    return emit(out, span, CODE, "NOT before an edge: the IDE negates first, so the edge is written outside the negation, RISING(NOT a)")
  if (box !== undefined && (head === undefined || head === EXECUTE)) return
  if (box === undefined && isOperand(operand) && !(operand.kind === "ident_expr" && wires.has(operand.name.toLowerCase()))) return
  emit(out, span, CODE, "NOT before a wire, a branch, a coil, the rail or another NOT: NOT marks a contact or a box read where it stands, and the NOT box is NOT(…)")
}

/** The assignment item's marks stand last in its chain, after its targets and right before its value — the bridge's
 *  reader's words. Item marks no assignment holds (`networkStatements`) stand anywhere else. */
const ITEM_MARKS_PLACE = "the assignment item's marks stand last in its chain, after its targets and right before its value (y := NOT := a)"

/** THE ASSIGNMENT ITEMS' MARKS (`y := NOT := a`): each where an assignment holds it, in order, on no wire's definition. */
export function checkItemMarks(statements: Statement[], items: readonly { words: readonly string[]; span: Span }[], wires: ReadonlySet<string>, out: DiagnosticItem[]): void {
  const held = new Set<readonly string[]>()
  walkStatements(statements, (s) => {
    if ((s.kind === "assign" || s.kind === "jmp" || s.kind === "return") && s.itemMarks !== undefined) {
      held.add(s.itemMarks)
      if (s.kind === "assign" && s.target.kind === "ident_expr" && wires.has(s.target.name.toLowerCase()))
        emit(out, s.target.span, CODE, `a mark on the wire ${s.target.name}: a wire holds none, its producer or a consumer does`)
    }
    for (const e of stmtExprs(s)) walkExpr(e, (x) => {
      if ((x.kind === "assign_expr" || x.kind === "call") && x.itemMarks !== undefined) held.add(x.itemMarks)
    })
  })
  for (const m of items) {
    if (!held.has(m.words)) emit(out, m.span, CODE, ITEM_MARKS_PLACE)
    else checkMarkOrder(m.words, m.span, out)
  }
}

/** A jump's or the return's own marks: in order, and first in its chain, as a coil's (`y := NOT JMP.l := a` hands the
 *  marked value on). */
export function checkControlMarks(s: Extract<Statement, { kind: "jmp" | "return" }>, out: DiagnosticItem[]): void {
  if (s.marks === undefined) return
  checkMarkOrder(s.marks, s.span, out)
  if (s.kind === "jmp") refuseEdge(s.marks, s.span, "jump", "JMP.l := RISING(a)", out)
  else refuseEdge(s.marks, s.span, "return", "RETURN := RISING(a)", out)
  if (s.sharesValue === true)
    emit(out, s.span, CODE, "a marked coil inside a chain: every target receives the rung's power flow, and a chained assignment would hand the marked value on")
}

/** An edge mark on a coil, a jump, the return or an output runs as if unmarked (live CODESYS 3.5.21.40, openspec
 *  nwl-box-storage-map); the edge is on the value. */
function refuseEdge(marks: readonly string[], span: Span, what: "coil" | "jump" | "return" | "output", value: string, out: DiagnosticItem[]): void {
  if (!marks.includes("RISING") && !marks.includes("FALLING")) return
  const runs = what === "output" ? "writes" : "runs"
  emit(out, span, CODE, `an edge mark on the ${what}: the IDE ${runs} it unmarked. The edge is on the value, ${value}`)
}

/** THE MARKS BEFORE ONE RECEIVER, outermost first: the edge outside the negation (the IDE negates first, N17), each once. */
export function checkMarkOrder(marks: readonly string[], span: Span, out: DiagnosticItem[]): void {
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
  // an edge stacked on NOT runs the NOT and no edge (live CODESYS 3.5.21.40, openspec nwl-box-storage-map)
  const stacked = marks.find((m) => m === "RISING" || m === "FALLING")
  if (negated && stacked !== undefined)
    emit(out, span, CODE, `${stacked} NOT before one receiver: the IDE runs the NOT and no edge. The edge of the negated value is RISING(NOT a)`)
}

/** A mark on a coil or a jump standing in a tree (`y := (RISING x := a) AND b`, `(RISING JMP.l := a)`). */
export function checkTreeMarks(x: CallExpr | Extract<Expr, { kind: "assign_expr" }>, out: DiagnosticItem[]): void {
  const head = x.kind === "call" ? ownHead(x) : undefined
  if (x.kind === "assign_expr") refuseEdge(x.marks!, x.span, "coil", "y := RISING(a)", out)
  else if (head === "JMP") refuseEdge(x.marks!, x.span, "jump", "JMP.l := RISING(a)", out)
  else if (head === "RETURN") refuseEdge(x.marks!, x.span, "return", "RETURN := RISING(a)", out)
}

/** A pin's, EN's or an output's own marks: in order, and on no branch's feed (a Parallel holds no flag). */
export function checkPinMarks(call: CallExpr, a: CallArg, out: DiagnosticItem[]): void {
  checkMarkOrder(a.marks!, a.span, out)
  if (a.output) refuseEdge(a.marks!, a.span, "output", `y := RISING(${calleeText(call)}(…))`, out)
  if (ownHead(call)?.startsWith("BRANCH") === true) emit(out, a.span, CODE, `a mark on the branch's ${a.param?.name ?? "pin"}: a branch holds none`)
}

/** A coil's own marks: in order; `NOT` on no `S=` / `R=` coil (a negated set coil IS the reset coil); none on a wire; and a
 *  marked coil only first in its chain — every target receives the rung's power flow (measured), while a chained
 *  assignment hands its value on, and the two agree only there. */
export function checkCoilMarks(stmt: Extract<Statement, { kind: "assign" }>, wires: ReadonlySet<string>, out: DiagnosticItem[]): void {
  const targets = [stmt.target, ...(stmt.chained ?? [])]
  const ops = [stmt.op, ...(stmt.chainOps ?? [])]
  stmt.marks?.forEach((m, i) => {
    if (m === undefined) return
    const t = targets[i]!
    checkMarkOrder(m, t.span, out)
    refuseEdge(m, t.span, "coil", "y := RISING(a)", out)
    if (m.includes("NOT") && (ops[i] === "S=" || ops[i] === "R="))
      emit(out, t.span, CODE, `NOT ${calleeText({ kind: "call", callee: t, args: [], span: t.span })} ${ops[i]}: a negated set or reset coil is no coil of its own (the reset coil is R=)`)
    if (t.kind === "ident_expr" && wires.has(t.name.toLowerCase()))
      emit(out, t.span, CODE, `a mark on the wire ${t.name}: a wire holds none, its producer or a consumer does`)
    if (i > 0)
      emit(out, t.span, CODE, "a marked coil inside a chain: every target receives the rung's power flow, and a chained assignment would hand the marked value on")
  })
}
