/**
 * THE MARKS OF A PLAIN-ST NETWORK BODY, as the network check holds them (`_plain-st.ts`, the one network check, holds the
 * rest): the value mark NOT, and the marks before a receiver — a coil, a pin, EN, an output — each in the IDE's order, on
 * nothing that holds none. Refused by name, as the bridge's reader refuses each (`StNetworkReader`).
 */
import { type CallArg, type CallExpr, type Expr, type Span, type Statement, EXECUTE } from "../../../frontend/syntax/index.js"
import { NETWORK_ELEMENTS } from "../../../frontend/types/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { calleeText } from "./_plain-st-box.js"
import { CODE } from "./_plain-st-wires.js"

function isOperand(e: Expr): boolean {
  return e.kind === "ident_expr" || e.kind === "literal" || e.kind === "member" || e.kind === "index" || e.kind === "deref" || e.kind === "global_expr"
}

/** The head of a call that is the text's own (an element, the Execute box, a jump or the return), else undefined. */
export function ownHead(e: Expr): string | undefined {
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
  if (box !== undefined && head === undefined) return
  if (box === undefined && isOperand(operand) && !(operand.kind === "ident_expr" && wires.has(operand.name.toLowerCase()))) return
  emit(out, span, CODE, "NOT before a wire, a branch, a coil, the rail, an Execute box or another NOT: NOT marks a contact or a box read where it stands, and the NOT box is NOT(…)")
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
}

/** A pin's, EN's or an output's own marks: in order, and on no branch's feed (a Parallel holds no flag). */
export function checkPinMarks(call: CallExpr, a: CallArg, out: DiagnosticItem[]): void {
  checkMarkOrder(a.marks!, a.span, out)
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
    if (m.includes("NOT") && (ops[i] === "S=" || ops[i] === "R="))
      emit(out, t.span, CODE, `NOT ${calleeText({ kind: "call", callee: t, args: [], span: t.span })} ${ops[i]}: a negated set or reset coil is no coil of its own (the reset coil is R=)`)
    if (t.kind === "ident_expr" && wires.has(t.name.toLowerCase()))
      emit(out, t.span, CODE, `a mark on the wire ${t.name}: a wire holds none, its producer or a consumer does`)
    if (i > 0)
      emit(out, t.span, CODE, "a marked coil inside a chain: every target receives the rung's power flow, and a chained assignment would hand the marked value on")
  })
}
