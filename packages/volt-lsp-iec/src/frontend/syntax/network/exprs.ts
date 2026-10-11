/**
 * Network text as ST expressions — what lets the one type engine, resolution, hover and rename run over a graphical
 * body unchanged. A value that ST can spell gets its ST reading (`networkValueExpr`); one it cannot — an empty slot,
 * `PARALLEL`, an operator box in call form — gets none, and its sub-values are read instead (`statementExprs`), so no
 * operand the engineer wrote is left out of a check or a rename.
 *
 * Two values read as BOOL and nothing more (spec 5.1): an edge `R_EDGE(x)` / `F_EDGE(x)` and a box consumed through
 * `.ENO` — an EXECUTE box's included. Neither is what ST would make of its spelling: `R_EDGE(x)` is a FLAG on `x`
 * (spec, "edges are R_EDGE and F_EDGE flags"), not a call of a function the project may itself declare under that
 * name (census 1.14 found both vendors allow one), and `.ENO` is the box's enable OUTPUT, not a member of its result.
 * Read as the call their spelling is, an `.ENO` nested in a group or a NOT box took the box's RETURN type, reporting
 * a mismatch the build does not give and missing one it does; read as nothing, a value used directly went unchecked
 * while the same value reached through a BOOL wire was checked. Their reading is a BOOL literal with no value — typed, never folded as
 * a constant — and the operands inside them are read on their own (`sealed`).
 */
import type { CallArg, Expr, IdentExpr, Literal, Span } from "../frontend/syntax/index.js"
import type { NetworkCall, NetworkExecute, NetworkTextStatement, NetworkValue } from "./ast.js"
import { statementValues, valueChildren, walkValues } from "./ast.js"
import { OPERATOR_HEADS } from "./lexer.js"

/** The ST expression a network value spells, or undefined when ST has no reading of it. */
export function networkValueExpr(v: NetworkValue): Expr | undefined {
  switch (v.kind) {
    case "operand":
      return v.expr
    case "wire_ref":
      return ident(v.name.text, v.name.span)
    case "not": {
      const operand = networkValueExpr(v.operand)
      return operand !== undefined ? { kind: "unary", op: "NOT", operand, span: v.span } : undefined
    }
    case "group": {
      const operands = v.operands.map(networkValueExpr)
      if (operands.some((e) => e === undefined)) return undefined
      let left = operands[0]!
      for (const right of operands.slice(1) as Expr[])
        left = { kind: "binary", op: v.op, left, right, span: { ...left.span, end: right.span.end, endLine: right.span.endLine, endCol: right.span.endCol } }
      return { kind: "paren", inner: left, span: v.span }
    }
    case "edge":
      return bool(v.rising ? "R_EDGE" : "F_EDGE", v.span)
    case "call":
      return v.eno ? bool("ENO", v.span) : callReading(v)
    case "execute":
      return v.eno ? bool("ENO", v.span) : undefined
    default:
      return undefined
  }
}

/** A call box as an ST call — the head as its callee, each pin ST can spell as an argument — whatever consumes it: its
 *  `.ENO` is not part of the call. The NOT box is ST's `NOT`, and an operator box in call form (`AND(EN := go, a, b)`)
 *  has no ST reading: its head is a keyword there. What checks a box's own pins reads it here. */
export function callReading(v: NetworkCall): Expr | undefined {
  const upper = (v.unnamedType ?? v.head).text.toUpperCase()
  if (!v.backticked && v.unnamedType === undefined && upper === "NOT") {
    const only = v.pins.length === 1 && v.pins[0]!.kind === "input" && v.pins[0]!.name === undefined ? v.pins[0]!.value : undefined
    const operand = only !== undefined ? networkValueExpr(only) : undefined
    return operand !== undefined ? { kind: "unary", op: "NOT", operand: { kind: "paren", inner: operand, span: operand.span }, span: v.span } : undefined
  }
  if (!v.backticked && OPERATOR_HEADS.has(upper)) return undefined
  const callee = v.unnamedType !== undefined ? ident(v.unnamedType.text, v.unnamedType.span) : v.headExpr
  if (callee === undefined) return undefined
  const args: CallArg[] = []
  for (const p of v.pins) {
    if (p.kind === "input") {
      const value = networkValueExpr(p.value)
      if (p.name !== undefined)
        args.push({ kind: "call_arg", param: ident(p.name.text, p.name.span), output: false, ...(value !== undefined ? { value } : {}), span: p.span })
      else if (value !== undefined) args.push({ kind: "call_arg", output: false, value, span: p.span })
    } else if (p.target?.expr !== undefined) {
      args.push({
        kind: "call_arg",
        ...(p.name !== undefined ? { param: ident(p.name.text, p.name.span) } : {}),
        output: true,
        value: p.target.expr,
        span: p.span,
      })
    } else if (p.name !== undefined) {
      args.push({ kind: "call_arg", param: ident(p.name.text, p.name.span), output: true, span: p.span })
    }
  }
  return { kind: "call", callee, args, span: v.span }
}

/**
 * Every ST expression a statement carries, each operand exactly once: a value's ST reading where it has one, else its
 * sub-values' — and every target. What the network checks, rename and hover walk.
 */
export function statementExprs(s: NetworkTextStatement): Expr[] {
  const out: Expr[] = []
  if (s.kind === "assign") for (const t of s.targets) if (t.expr !== undefined) out.push(t.expr)
  for (const v of statementValues(s)) collect(v, out)
  return out
}

function collect(v: NetworkValue, out: Expr[]): void {
  const e = networkValueExpr(v)
  if (e !== undefined) out.push(e)
  unread(v, e !== undefined, out)
}

/** The operands under `v` that `v`'s reading leaves out — all of them when it has none (`read` false). */
function unread(v: NetworkValue, read: boolean, out: Expr[]): void {
  if (!(read && sealed(v))) return childrenUnread(v, read, out)
  // A BOOL reading carries none of the operands inside it; a box read through `.ENO` is still the call it is.
  const call = v.kind === "call" ? callReading(v) : undefined
  if (call !== undefined) out.push(call)
  childrenUnread(v, call !== undefined, out)
}

function childrenUnread(v: NetworkValue, read: boolean, out: Expr[]): void {
  if (!read && v.kind === "call")
    for (const p of v.pins) if (p.kind === "output" && p.target?.expr !== undefined) out.push(p.target.expr)
  for (const c of valueChildren(v)) {
    // A read value's reading holds each child's reading, where the child has one; the rest is read on its own.
    if (read && networkValueExpr(c) !== undefined) unread(c, true, out)
    else collect(c, out)
  }
}

/** Whether a value's reading is the opaque BOOL, which holds none of its operands. */
function sealed(v: NetworkValue): boolean {
  return v.kind === "edge" || ((v.kind === "call" || v.kind === "execute") && v.eno)
}

/** Every EXECUTE box in a statement — its lines are ST, checked and walked as such. */
export function* executeBoxes(s: NetworkTextStatement): Generator<NetworkExecute> {
  for (const v of walkValues(s)) if (v.kind === "execute") yield v
}

/** The BOOL an edge or an `.ENO` reads as: typed BOOL, with no value to fold. `text` is what a message would echo —
 *  unmeasured, since no BOOL is ever reported as an untyped source. */
function bool(text: string, span: Span): Literal {
  return { kind: "literal", literalKind: "bool", text, value: undefined, span }
}

function ident(name: string, span: Span): IdentExpr {
  return { kind: "ident_expr", name, span }
}
