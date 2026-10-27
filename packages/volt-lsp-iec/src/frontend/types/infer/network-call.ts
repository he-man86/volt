/**
 * THE TYPES OF A PLAIN-ST NETWORK BODY'S OWN CALLS AND WIRES (openspec network-text-st 2.3): every box is a call, and the
 * LSP knows each one as it knows LIMIT — what it hands back, from what it is given.
 *
 *   `GT(i, 3)`, `ADD(i, j, k)`, `AND(a, b)`   the operator box: the type the same operands have in ST with the operator
 *                                             between them (`i + j + k`), so the arithmetic rules are the ST ones;
 *   `NOT(a)`                                  the NOT box: `NOT a`'s;
 *   `X_EN(EN := e, …)`, `EXECUTE(EN := e)`    an enabled box and the Execute box: their ENO, a BOOL (`names.ts`
 *                                             `isNetworkBox`);
 *   a wire                                    its definition's: the expression assigned to it, or the output a call
 *                                             binds to it — an ENO a BOOL, an enabled box's `OUT` its box's value, an FB's
 *                                             output the FB's (`Symbol.wire`).
 *
 * Only inside a network body (`Scope.network`): in ST, `GT(i, 3)` is the vendor's syntax error, and stays one.
 */
import type { Scope, Symbol } from "../../symbols/index.js"
import type { CallArg, CallExpr, Expr } from "../../syntax/index.js"
import { ENABLED_SUFFIX, isNetworkBox } from "../names.js"
import { elementaryRef, UNKNOWN, type Type } from "../type.js"
import { inferExprType } from "./expr.js"

/** The ST operator each operator box is, by its box type. */
const OPERATOR_OF: Readonly<Record<string, string>> = {
  AND: "AND", OR: "OR", XOR: "XOR", ADD: "+", SUB: "-", MUL: "*", DIV: "/", MOD: "MOD",
  GT: ">", GE: ">=", LT: "<", LE: "<=", EQ: "=", NE: "<>",
}

function inNetwork(scope: Scope): boolean {
  for (let s: Scope | undefined = scope; s !== undefined; s = s.parent) if (s.network === true) return true
  return false
}

/** A network box call's result type, or undefined where the call is no network box (or not in a network body). */
export function networkCallType(call: CallExpr, scope: Scope, project: Scope): Type | undefined {
  if (call.callee.kind !== "ident_expr" || !inNetwork(scope)) return undefined
  const name = call.callee.name
  if (isNetworkBox(scope, name)) return elementaryRef("BOOL")
  const values = positional(call.args)
  if (values === undefined) return undefined
  const upper = name.toUpperCase()
  if (upper === "NOT" && values.length === 1) return inferExprType({ kind: "unary", op: "NOT", operand: values[0]!, span: call.span }, scope, project)
  const op = OPERATOR_OF[upper]
  if (op === undefined || values.length < 2) return undefined
  return inferExprType(chain(op, values, call), scope, project)
}

/** A call's arguments when every one is positional (the operator boxes' form), else undefined. */
function positional(args: readonly CallArg[]): Expr[] | undefined {
  if (args.some((a) => a.param !== undefined || a.output || a.value === undefined)) return undefined
  return args.map((a) => a.value!)
}

/** `a op b op c`, left to right — what an extensible box computes. */
function chain(op: string, values: readonly Expr[], at: CallExpr): Expr {
  return values.slice(1).reduce<Expr>((left, right) => ({ kind: "binary", op, left, right, span: at.span }), values[0]!)
}

const typing = new Set<Symbol>()

/** A wire's type: its definition's (`Symbol.wire`); UNKNOWN where it has none, or while it is being typed. */
export function wireType(sym: Symbol, project: Scope): Type {
  const def = sym.wire
  if (def === undefined || def.kind === "none" || typing.has(sym)) return UNKNOWN
  typing.add(sym)
  try {
    if (def.kind === "value") return inferExprType(def.expr, sym.owner, project)
    return outputType(def.call, def.param, sym.owner, project)
  } finally {
    typing.delete(sym)
  }
}

/** The type of the output `param` of `call`: an ENO a BOOL; an enabled box's `OUT` the value its box computes; any other
 *  output the callee's own (an FB instance's `t1.Q`). */
function outputType(call: CallExpr, param: string, scope: Scope, project: Scope): Type {
  const upper = param.toUpperCase()
  if (upper === "ENO") return elementaryRef("BOOL")
  if (call.callee.kind === "ident_expr" && isNetworkBox(scope, call.callee.name) && call.callee.name.toUpperCase() !== "EXECUTE") {
    const base: Expr = { kind: "ident_expr", name: call.callee.name.slice(0, -ENABLED_SUFFIX.length), span: call.callee.span }
    const baseType = inferExprType(base, scope, project)
    // an enabled FB's output by name is the FB's own, `OUT` included where the FB declares one
    if (baseType.kind === "function_block") return memberOf(base, param, call, scope, project)
    if (upper !== "OUT") return UNKNOWN
    const args = call.args.filter((a) => !a.output && a.param?.name.toUpperCase() !== "EN")
    return inferExprType({ kind: "call", callee: base, args, span: call.span }, scope, project)
  }
  return memberOf(call.callee, param, call, scope, project)
}

function memberOf(base: Expr, param: string, call: CallExpr, scope: Scope, project: Scope): Type {
  return inferExprType({ kind: "member", base, member: { kind: "ident_expr", name: param, span: call.span }, span: call.span }, scope, project)
}
