/**
 * THE TYPES OF A PLAIN-ST NETWORK BODY'S OWN CALLS, MEMBERS AND WIRES (openspec network-text-st 2.3, network-output-member):
 * every box is a call (`network-box.ts`), and the LSP knows each one as it knows LIMIT — what it hands back, from what it is
 * given.
 *
 *   `GT(i, 3)`, `ADD(i, j, k)`, `AND(a, b)`   the operator box: the type the same operands have in ST with the operator
 *                                             between them (`i + j + k`), so the arithmetic rules are the ST ones; with
 *                                             `EN :=` first the same, EN left out;
 *   `NOT(a)`                                  the NOT box: `NOT a`'s;
 *   `f(…)`, `f(EN := e, …)`                   a function box: the value `f(…)` has, EN left out;
 *   `r1(CLK := a)`              an FB box with one output: that output's type (`r1.Q`);
 *   `<box>.ENO`                               the shown ENO, a BOOL;
 *   `<box>.OUT`, `<box>.Q`                    a function's value, a VAR_OUTPUT's or an FB output's type (`t1.Q`);
 *   `EXECUTE(EN := e, '<ST>')`                the Execute box: its ENO, a BOOL (its ST string is no pin, `plain-st.ts`);
 *   `(JMP.label := value)`, `(RETURN := value)`  the jump and the return in a tree: the value they hand on;
 *   a wire                                    its definition's: the expression assigned to it.
 *
 * Only inside a network body (`Scope.network`): in ST, `GT(i, 3)` is the vendor's syntax error, and stays one.
 */
import type { Scope, Symbol } from "../../symbols/index.js"
import type { CallArg, CallExpr, Expr, MemberExpr, VarSection } from "../../syntax/index.js"
import { resolveTypeExpr } from "../resolve.js"
import { resolveCallee } from "./callee.js"
import { isNetworkBox, NETWORK_CONTROLS } from "../names.js"
import { elementaryRef, UNKNOWN, type Type } from "../type.js"
import { stCallReturnType } from "./builtin-call.js"
import { inferExprType } from "./expr.js"
import { boxMember, dataOutputs, networkBox, VALUE, type NetworkBox } from "./network-box.js"

/** The ST operator each operator box is, by its box type. */
const OPERATOR_OF: Readonly<Record<string, string>> = {
  AND: "AND", OR: "OR", XOR: "XOR", ADD: "+", SUB: "-", MUL: "*", DIV: "/", MOD: "MOD",
  GT: ">", GE: ">=", LT: "<", LE: "<=", EQ: "=", NE: "<>",
}

/** A network box call's result type, or undefined where the call is no network box (or not in a network body). */
export function networkCallType(call: CallExpr, scope: Scope, project: Scope): Type | undefined {
  const name = call.callee.kind === "ident_expr" ? call.callee.name : undefined
  if (name !== undefined && NETWORK_CONTROLS.has(name.toUpperCase()) && isNetworkBox(scope, name)) {
    const value = call.args.at(-1)?.value
    return value === undefined ? UNKNOWN : inferExprType(value, scope, project)
  }
  if (name !== undefined && isNetworkBox(scope, name)) return elementaryRef("BOOL")
  const box = networkBox(call, scope, project)
  return box === undefined ? undefined : boxValue(box, scope, project)
}

/** What a box hands on read by its value: an FB's one output, an operator's or a function's value. */
function boxValue(box: NetworkBox, scope: Scope, project: Scope): Type {
  if (box.instance !== undefined) {
    const outputs = box.signature?.outputs
    return outputs?.length === 1 ? memberOf(box.instance, outputs[0]!, box.call, scope, project) : UNKNOWN
  }
  const upper = box.call.callee.kind === "ident_expr" ? box.call.callee.name.toUpperCase() : undefined
  const values = upper !== undefined && (upper === "NOT" || OPERATOR_OF[upper] !== undefined) ? positional(box.pins) : undefined
  if (values !== undefined && upper === "NOT" && values.length === 1)
    return inferExprType({ kind: "unary", op: "NOT", operand: values[0]!, span: box.call.span }, scope, project)
  if (values !== undefined && upper !== "NOT" && values.length >= 2) return inferExprType(chain(OPERATOR_OF[upper!]!, values, box.call), scope, project)
  if (values !== undefined) return UNKNOWN
  return stCallReturnType({ ...box.st, args: box.pins.filter((a) => !a.output) }, scope, project)
}

/** The type of `<box>.NAME`: the shown ENO a BOOL, a function's value `OUT` its value, any other output its declared type;
 *  undefined where `e` closes no box's call. */
export function networkMemberType(e: MemberExpr, scope: Scope, project: Scope): Type | undefined {
  const m = boxMember(e, scope, project)
  if (m === undefined) return undefined
  if (m.eno) return elementaryRef("BOOL")
  const { box, name } = m
  if (box.instance !== undefined) return memberOf(box.instance, name, box.call, scope, project)
  if (name.toUpperCase() === VALUE && (box.signature === undefined || dataOutputs(box.signature).length > 0)) return boxValue(box, scope, project)
  // a function's VAR_OUTPUT: its declared type
  const callee = resolveCallee(box.st, scope, project)
  const decl = ((callee?.sym.ast as { varSections?: readonly VarSection[] } | undefined)?.varSections ?? [])
    .filter((s) => s.sectionKind === "VAR_OUTPUT")
    .flatMap((s) => s.decls)
    .find((d) => d.names.some((n) => n.text.toLowerCase() === name.toLowerCase()))
  return decl === undefined || callee === undefined ? UNKNOWN : resolveTypeExpr(decl.type, project, 0, project, callee.sym.uri)
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
    // an output bound to the wire has no type: a box's output reaches no wire (`_plain-st-wires.ts` refuses it)
    return def.kind === "value" ? inferExprType(def.expr, sym.owner, project) : UNKNOWN
  } finally {
    typing.delete(sym)
  }
}

function memberOf(base: Expr, param: string, call: CallExpr, scope: Scope, project: Scope): Type {
  return inferExprType({ kind: "member", base, member: { kind: "ident_expr", name: param, span: call.span }, span: call.span }, scope, project)
}
