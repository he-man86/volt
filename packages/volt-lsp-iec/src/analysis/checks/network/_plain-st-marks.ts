/**
 * THE MARKS AND THE RETIRED FORMS OF A PLAIN-ST NETWORK BODY, as the network check holds them (`_plain-st.ts`, the one
 * network check, holds the rest), in the bridge reader's words (`StNetworkReader.Marked`). A mark on a value is a function
 * nested in run order — `INVERT(a)` (read as the ST `NOT a`), `RISING(a)`, `FALLING(a)` — and the marks around a value go
 * to the receiver it stands at as far as that holds them, the rest to the node itself:
 *
 *   the line into a coil (an ASSIGN's value)   a negation outside an edge, `INVERT(RISING(…))`;
 *   a pin or EN                                one mark;
 *   the node, a contact's operand or a box     an edge outside a negation, `RISING(INVERT(a))` — never a wire, a branch,
 *                                              the rail, an ASSIGN or a contact group.
 *
 * What is left over is a stack deeper than the IDE stores. A statement written the retired way is refused naming its
 * ASSIGN (`syntax` `network/retired.ts`).
 */
import { type CallExpr, type Expr, retiredForms, type Statement } from "../../../frontend/syntax/index.js"
import { NETWORK_ELEMENTS } from "../../../frontend/types/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { CODE } from "./_plain-st-wires.js"

/** A statement written the retired way, refused naming the ASSIGN it is (`syntax` `network/retired.ts`). */
export function checkRetiredForms(stmt: Statement, wires: ReadonlySet<string>, out: DiagnosticItem[]): void {
  for (const r of retiredForms(stmt, wires)) emit(out, r.span, CODE, r.message)
}

type Receiver = "none" | "pin" | "item"

/** The mark a node is (`INVERT` read as `NOT`), and what it marks; undefined for any other node. */
function markOf(e: Expr): { mark: string; inner: Expr } | undefined {
  if (e.kind === "unary" && e.op.toUpperCase() === "NOT") return { mark: "INVERT", inner: e.operand }
  if (e.kind !== "call" || e.callee.kind !== "ident_expr" || e.args.length !== 1 || e.args[0]!.value === undefined) return undefined
  const head = e.callee.name.toUpperCase()
  const a = e.args[0]!
  return (head === "RISING" || head === "FALLING") && !a.output && a.param === undefined ? { mark: head, inner: a.value! } : undefined
}

/** Each value of a network statement with its marks where its receiver holds them, and every value inside it. */
export function checkMarks(stmt: Statement, wires: ReadonlySet<string>, out: DiagnosticItem[]): void {
  const isWire = (e: Expr) => e.kind === "ident_expr" && wires.has(e.name.toLowerCase())
  /** May the node `core` carry marks of its own: a contact's operand (no wire) or a box (no element, no contact group)? */
  const holdsMarks = (core: Expr): boolean => {
    if (core.kind === "ident_expr") return !isWire(core)
    if (["literal", "index", "deref", "global_expr", "member"].includes(core.kind)) return true
    if (core.kind !== "call") return false
    if (core.callee.kind !== "ident_expr") return true
    const head = core.callee.name.toUpperCase()
    return !NETWORK_ELEMENTS.has(head) && head !== "JMP" && head !== "RETURN"
  }
  const value = (e: Expr, receiver: Receiver): void => {
    const marks: string[] = []
    let core = e
    for (let m = markOf(core); m !== undefined; m = markOf(core)) {
      marks.push(m.mark)
      core = m.inner
    }
    let k = 0
    if (receiver === "item") {
      if (marks[k] === "INVERT") k++
      if (k < marks.length && marks[k] !== "INVERT") k++
    } else if (receiver === "pin" && k < marks.length) k++
    const held = k
    if (k < marks.length && marks[k] !== "INVERT") k++
    if (k < marks.length && marks[k] === "INVERT") k++
    if (k < marks.length)
      emit(out, e.span, CODE, `${marks.join("(")}(…): a stack of marks deeper than the IDE stores. A value's node holds an edge outside a negation, RISING(INVERT(a)), and its receiver: the line into a coil a negation outside an edge, a pin or EN one mark`)
    else if (k > held && !holdsMarks(core))
      emit(out, e.span, CODE, `${marks[k - 1]}(…) on a wire, a branch, the rail, an ASSIGN or a contact group: a mark is on a contact, a box, or a receiver`)
    inside(core)
  }
  const call = (c: CallExpr): void => {
    const head = c.callee.kind === "ident_expr" ? c.callee.name.toUpperCase() : undefined
    // a jump or the return in a tree (an ASSIGN's target): its value is the line into it
    if (head === "JMP" || head === "RETURN") return value(c.args.at(-1)!.value!, "item")
    // a box's pin or EN (an Execute box's EN too); a value an element (a branch, a malformed mark) holds at no receiver
    const element = head !== undefined && NETWORK_ELEMENTS.has(head)
    for (const a of c.args) if (a.value !== undefined && !a.output) value(a.value, element ? "none" : "pin")
  }
  const inside = (e: Expr): void => {
    switch (e.kind) {
      case "call":
        return call(e)
      case "member":
        return e.base.kind === "call" ? call(e.base) : undefined
      case "binary":
        value(e.left, "none")
        return value(e.right, "none")
      case "paren":
        return value(e.inner, "none")
      case "unary":
        return value(e.operand, "none")
      case "assign_expr":
        return value(e.value, e.assignHead !== undefined ? "item" : "none")
      default:
        return
    }
  }
  switch (stmt.kind) {
    case "assign":
      return value(stmt.value, stmt.assignHead !== undefined ? "item" : "none")
    case "jmp":
    case "return":
      return stmt.value === undefined ? undefined : value(stmt.value, "item")
    case "call_stmt":
      return value(stmt.call, "none")
    case "expr_stmt":
      return value(stmt.expr, "none")
    default:
      return
  }
}
