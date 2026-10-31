/**
 * The ST nodes a network lowers to (`network.ts`), each carrying the span of the user's text it stands for — so a refusal,
 * a debugger line or a trace lands in the network the user wrote. A hidden name (`__nw1_w1`) is an identifier no ST text
 * can spell, built here and never parsed.
 */
import type { CallArg, CallExpr, Expr, Span, Statement } from "../../../frontend/syntax/index.js"

/** Why a network body is not lowered, by name: `invalid` where CODESYS does not compile it, `not-modelled` otherwise. */
export class NetworkRefusal extends Error {
  readonly code: "network-box" | "network-invalid"
  constructor(message: string, kind: { code: "network-box" | "network-invalid" } = { code: "network-box" }) {
    super(message)
    this.code = kind.code
  }
}

/** A box CODESYS does not compile (`NetworkRefusal`'s kind). */
export const NOT_COMPILED = { code: "network-invalid" } as const

export const ident = (name: string, span: Span): Expr => ({ kind: "ident_expr", name, span })
export const bool = (value: boolean, span: Span): Expr => ({ kind: "literal", literalKind: "bool", text: value ? "TRUE" : "FALSE", value, span })
export const binary = (op: string, left: Expr, right: Expr, span: Span): Expr => ({ kind: "binary", op, left, right, span })
export const not = (operand: Expr, span: Span): Expr => ({ kind: "unary", op: "NOT", operand, span })
export const member = (base: Expr, name: string, span: Span): Expr => ({ kind: "member", base, member: { kind: "ident_expr", name, span }, span })
export const call = (callee: Expr, args: CallArg[], span: Span): CallExpr => ({ kind: "call", callee, args, span })
export const assign = (target: Expr, value: Expr, span: Span): Statement => ({ kind: "assign", target, value, span })

/** `IF cond THEN then ELSE otherwise END_IF` — no ELSE where `otherwise` is empty. */
export function ifThen(cond: Expr, then: Statement[], otherwise: Statement[], span: Span): Statement {
  return { kind: "if", branches: [{ kind: "if_branch", cond, body: then, span }], ...(otherwise.length > 0 ? { elseBody: otherwise } : {}), span }
}

/** `value;` as a statement: a call is the call statement; anything else the expression statement lowering refuses. */
export function standing(value: Expr): Statement {
  return value.kind === "call" ? { kind: "call_stmt", call: value, span: value.span } : { kind: "expr_stmt", expr: value, span: value.span }
}

/** `t1 := t2 := … := value;` — the first target the assignment's, the rest its chain. */
export function assignAll(targets: readonly Expr[], value: Expr, span: Span): Statement {
  const [first, ...rest] = targets
  return { kind: "assign", target: first!, value, ...(rest.length > 0 ? { chained: rest, chainOps: rest.map(() => undefined) } : {}), span }
}
