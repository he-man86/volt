/**
 * Network text as ST expressions — what lets the one type engine, resolution, hover and rename run over a graphical body
 * unchanged. A value ST can spell gets its ST reading (`networkValueExpr`): a box word is ST's operator over its operands
 * (`a ADD b` reads `a + b`, `a GT 40` reads `a > 40`); MOVE and a call are ST calls. One it cannot — an empty slot, a
 * parallel, an operator box in call form — gets none, and its sub-values are read instead (`statementExprs`), so no
 * operand the engineer wrote is left out of a check or a rename.
 *
 * Two values read as BOOL and nothing more: an edge `R_EDGE(x)` / `F_EDGE(x)` and `ENO` — the enable OUTPUT of the open
 * line it takes, not its data. Their reading is a BOOL literal with no value — typed, never folded as a constant — and the
 * operands inside them are read on their own (`sealed`).
 */
import type { Span } from "../span.js"
import type { CallArg, Expr, IdentExpr, Literal } from "../ast/nodes/index.js"
import type { NetworkCall, NetworkExecute, NetworkTextStatement, NetworkValue, NetworkWordBox } from "./ast.js"
import { statementValues, valueChildren, walkValues } from "./ast.js"
import { BOX_WORDS } from "./words.js"

/** A box word's ST operator (B1): the word's own symbol where ST spells it with one. */
const ST_OPERATOR: Readonly<Record<string, string>> = {
  AND: "AND",
  OR: "OR",
  XOR: "XOR",
  ADD: "+",
  SUB: "-",
  MUL: "*",
  DIV: "/",
  MOD: "MOD",
  GT: ">",
  GE: ">=",
  EQ: "=",
  NE: "<>",
  LE: "<=",
  LT: "<",
}

/** The ST expression a network value spells, or undefined when ST has no reading of it. */
export function networkValueExpr(v: NetworkValue): Expr | undefined {
  switch (v.kind) {
    case "operand":
      return v.expr
    case "split_ref":
      return ident(v.name.text, v.name.span)
    case "not": {
      const operand = networkValueExpr(v.operand)
      return operand !== undefined ? { kind: "unary", op: "NOT", operand, span: v.span } : undefined
    }
    case "word":
      return wordReading(v)
    case "edge":
      return bool(v.rising ? "R_EDGE" : "F_EDGE", v.span)
    case "eno":
      return bool("ENO", v.span)
    case "call":
      return v.output !== undefined ? namedOutputReading(v) : callReading(v)
    case "nested_assign":
      // What the consumer reads is the value, passed through the assignment (S2); the targets are read on their own.
      return networkValueExpr(v.value)
    default:
      return undefined
  }
}

/** A box word as ST: its operator over its operands, left to right; MOVE as ST's `MOVE(b)`. */
function wordReading(v: NetworkWordBox): Expr | undefined {
  const operands = v.operands.map(networkValueExpr)
  if (operands.some((e) => e === undefined)) return undefined
  if (v.word === "MOVE") return { kind: "call", callee: ident("MOVE", v.head.span), args: operands.map((value) => ({ kind: "call_arg", output: false, value: value!, span: value!.span })), span: v.span }
  const op = ST_OPERATOR[v.word]
  if (op === undefined) return undefined
  let left = operands[0]!
  for (const right of operands.slice(1) as Expr[])
    left = { kind: "binary", op, left, right, span: { ...left.span, end: right.span.end, endLine: right.span.endLine, endCol: right.span.endCol } }
  return { kind: "paren", inner: left, span: v.span }
}

/** A call read through a NAMED output (`fb(…).name`, S4): ST's `fb.name`. A function or an unnamed instance has no such
 *  path in ST, so no reading; its operands are read on their own. */
function namedOutputReading(v: NetworkCall): Expr | undefined {
  if (v.output === undefined || v.instance === undefined || v.headExpr === undefined) return undefined
  const member = ident(v.output.text, v.output.span)
  return { kind: "member", base: v.headExpr, member, span: v.span }
}

/** A call box as an ST call — the head as its callee, each pin ST can spell as an argument — whatever consumes it. The
 *  NOT box is ST's `NOT`, and an operator box in call form (`ADD(a)`) has no ST reading: its head is a keyword there. */
export function callReading(v: NetworkCall): Expr | undefined {
  const upper = (v.unnamedType ?? v.head).text.toUpperCase()
  if (!v.backticked && v.unnamedType === undefined && upper === "NOT") {
    const only = v.pins.length === 1 && v.pins[0]!.kind === "input" ? v.pins[0]!.value : undefined
    const operand = only !== undefined ? networkValueExpr(only) : undefined
    return operand !== undefined ? { kind: "unary", op: "NOT", operand: { kind: "paren", inner: operand, span: operand.span }, span: v.span } : undefined
  }
  if (!v.backticked && v.operatorCall === true && BOX_WORDS.has(upper) && upper !== "MOVE") return undefined
  const callee = v.unnamedType !== undefined ? ident(v.unnamedType.text, v.unnamedType.span) : v.headExpr
  if (callee === undefined) return undefined
  const args: CallArg[] = []
  for (const p of v.pins) {
    if (p.kind === "input") {
      const value = networkValueExpr(p.value)
      if (p.name !== undefined)
        args.push({ kind: "call_arg", param: ident(p.name.text, p.name.span), output: false, ...(value !== undefined ? { value } : {}), span: p.span })
      else if (value !== undefined) args.push({ kind: "call_arg", output: false, value, span: p.span })
    } else if (p.name?.text.toUpperCase() === "ENO") continue // the ENO pin is no parameter of the callee
    else if (p.target?.expr !== undefined)
      args.push({ kind: "call_arg", ...(p.name !== undefined ? { param: ident(p.name.text, p.name.span) } : {}), output: true, value: p.target.expr, span: p.span })
    else if (p.name !== undefined) args.push({ kind: "call_arg", param: ident(p.name.text, p.name.span), output: true, span: p.span })
  }
  return { kind: "call", callee, args, span: v.span }
}

/** Every ST expression a statement carries, each operand exactly once: a value's ST reading where it has one, else its
 *  sub-values' — and every target. What the network checks, rename and hover walk. */
export function statementExprs(s: NetworkTextStatement): Expr[] {
  const out: Expr[] = []
  if (s.kind === "assign") for (const t of s.targets) if (t.expr !== undefined) out.push(t.expr)
  for (const v of walkValues(s)) {
    if (v.kind === "nested_assign") for (const t of v.targets) if (t.expr !== undefined) out.push(t.expr)
    if (v.kind === "word") for (const t of v.outputs) if (t.expr !== undefined) out.push(t.expr)
    if (v.kind === "call") for (const p of v.pins) if (p.kind === "output" && p.name?.text.toUpperCase() === "ENO" && p.target?.expr !== undefined) out.push(p.target.expr)
  }
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
  // A BOOL reading carries none of the operands inside it; the box an ENO takes is still the box it is.
  if (v.kind === "eno") return collect(v.box, out)
  const call = v.kind === "call" ? callReading(v) : undefined
  if (call !== undefined) out.push(call)
  childrenUnread(v, call !== undefined, out)
}

function childrenUnread(v: NetworkValue, read: boolean, out: Expr[]): void {
  if (!read && v.kind === "call")
    for (const p of v.pins) if (p.kind === "output" && p.name?.text.toUpperCase() !== "ENO" && p.target?.expr !== undefined) out.push(p.target.expr)
  for (const c of valueChildren(v)) {
    // A read value's reading holds each child's reading, where the child has one; the rest is read on its own.
    if (read && networkValueExpr(c) !== undefined && !(v.kind === "word" && c === v.en) && !(v.kind === "call" && c === v.en)) unread(c, true, out)
    else collect(c, out)
  }
}

/** Whether a value's reading holds none of its operands: the opaque BOOL of an edge or `ENO`, or `fb.name`. */
function sealed(v: NetworkValue): boolean {
  return v.kind === "edge" || v.kind === "eno" || (v.kind === "call" && v.output !== undefined)
}

/** Every EXECUTE box in a statement — its lines are ST, checked and walked as such. */
export function* executeBoxes(s: NetworkTextStatement): Generator<NetworkExecute> {
  for (const v of walkValues(s)) if (v.kind === "execute") yield v
}

/** The BOOL an edge or an ENO reads as: typed BOOL, with no value to fold. */
function bool(text: string, span: Span): Literal {
  return { kind: "literal", literalKind: "bool", text, value: undefined, span }
}

function ident(name: string, span: Span): IdentExpr {
  return { kind: "ident_expr", name, span }
}
