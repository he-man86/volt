/**
 * WHAT THE EXEC TWIN READS OFF A NETWORK BODY'S STATEMENTS before it writes them (`network-twin.ts`): each wire's
 * occurrences, the call statements a short-circuit branch runs only when the branch runs, and the FB output a wire is.
 */
import { type BodySpan, type CallExpr, type Expr, plainStText, type Statement, stmtExprs, walkExpr } from "../../src/frontend/syntax/index.js"
import { lookup, type Scope } from "../../src/frontend/symbols/index.js"
import { inferExprType } from "../../src/frontend/types/index.js"

/** `t1.Q` for a wire `t1(…, Q => w)` / `t1_EN(…, Q => w)` defines, where `t1` is an FB instance; else undefined. */
export function fbOutputOf(call: CallExpr, param: string, source: string, scope: Scope, project: Scope): { member: string; at: number; pin: string } | undefined {
  if (call.callee.kind !== "ident_expr" && call.callee.kind !== "member" && call.callee.kind !== "index") return undefined
  const text = source.slice(call.callee.span.start, call.callee.span.end)
  const suffix = /_EN(O|ONLY)?$/i.exec(text)?.[0]
  const enabled = call.callee.kind === "ident_expr" && suffix !== undefined && lookup(scope, text) === undefined
  const instance = enabled ? text.slice(0, -suffix!.length) : text
  const head: Expr = enabled ? { kind: "ident_expr", name: instance, span: call.callee.span } : call.callee
  if (inferExprType(head, scope, project).kind !== "function_block") return undefined
  return { member: `${instance}.${param}`, at: call.span.start, pin: param.toLowerCase() }
}

/** The guarded call statements `e` reads through their wires (`guardedCalls`), and the ones those read in turn, in source
 *  order. */
export function guardedReadBy(e: Expr, guardedByWire: ReadonlyMap<string, Statement>): Statement[] {
  const found = new Set<Statement>()
  const visit = (x: Expr) =>
    walkExpr(x, (y) => {
      const s = y.kind === "ident_expr" ? guardedByWire.get(y.name.toLowerCase()) : undefined
      if (s === undefined || found.has(s)) return
      found.add(s)
      if (s.kind === "call_stmt") for (const a of s.call.args) if (!a.output && a.value !== undefined) visit(a.value)
    })
  visit(e)
  return [...found].sort((a, b) => a.span.start - b.span.start)
}

/** The call statements a `BRANCH_SHORTCIRCUIT` branch reads through a wire read once (an FB on the branch, and the calls
 *  that FB reads in turn), by that wire: the network runs them only when the branch runs (1.4), so the twin writes each
 *  inside the branch's guard, not where it stands. */
export function guardedCalls(body: BodySpan, statements: readonly Statement[], reads: ValueReads): Map<string, Statement> {
  const wires = new Set(plainStText(body).networks.flatMap((n) => n.wires.map((w) => w.name.toLowerCase())))
  const byWire = new Map<string, Statement>()
  for (const s of statements)
    if (s.kind === "call_stmt")
      for (const a of s.call.args)
        if (a.output && a.value?.kind === "ident_expr" && wires.has(a.value.name.toLowerCase()) && reads.occurrences.get(a.value.name.toLowerCase()) === 2)
          byWire.set(a.value.name.toLowerCase(), s)
  const out = new Map<string, Statement>()
  const take = (e: Expr) =>
    walkExpr(e, (x) => {
      const s = x.kind === "ident_expr" ? byWire.get(x.name.toLowerCase()) : undefined
      if (s === undefined || out.has((x as { name: string }).name.toLowerCase())) return
      out.set((x as { name: string }).name.toLowerCase(), s)
      if (s.kind === "call_stmt") for (const a of s.call.args) if (!a.output && a.value !== undefined) take(a.value)
    })
  for (const s of statements)
    for (const e of stmtExprs(s))
      walkExpr(e, (x) => {
        if (x.kind !== "call" || x.callee.kind !== "ident_expr" || x.callee.name.toUpperCase() !== "BRANCH_SHORTCIRCUIT") return
        for (const a of x.args) if (a.param === undefined && a.value !== undefined) take(a.value)
      })
  return out
}

export type AssignStatement = Extract<Statement, { kind: "assign" }>

/** Each wire's occurrences in the network's code (its definition included). */
export interface ValueReads {
  occurrences: Map<string, number>
}

export function valueReads(body: BodySpan, statements: readonly Statement[]): ValueReads {
  const wires = new Set(plainStText(body).networks.flatMap((n) => n.wires.map((w) => w.name.toLowerCase())))
  const occurrences = new Map<string, number>()
  for (const s of statements) {
    for (const e of stmtExprs(s))
      walkExpr(e, (x) => {
        if (x.kind === "ident_expr" && wires.has(x.name.toLowerCase())) occurrences.set(x.name.toLowerCase(), (occurrences.get(x.name.toLowerCase()) ?? 0) + 1)
      })
  }
  return { occurrences }
}
