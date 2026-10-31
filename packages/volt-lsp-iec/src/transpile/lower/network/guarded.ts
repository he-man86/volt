/**
 * THE CALLS A SHORT-CIRCUIT BRANCH RUNS ONLY WHEN THE BRANCH RUNS (measured, network-text-st 1.4): a `BRANCH_SHORTCIRCUIT`
 * branch that reads a wire defined once by a call statement's output (an FB on the branch, its value read once) runs that
 * call inside the branch's guard, not where it stands — and the calls that call reads through its own wires with it.
 */
import { type Expr, type Statement, stmtExprs, walkExpr } from "../../../frontend/syntax/index.js"

/** The guarded call statements, by the wire (lower-case) each defines. */
export function guardedCalls(statements: readonly Statement[], wires: ReadonlySet<string>): Map<string, Statement> {
  const occurrences = new Map<string, number>()
  for (const s of statements)
    for (const e of stmtExprs(s))
      walkExpr(e, (x) => {
        if (x.kind === "ident_expr" && wires.has(x.name.toLowerCase())) occurrences.set(x.name.toLowerCase(), (occurrences.get(x.name.toLowerCase()) ?? 0) + 1)
      })
  // a wire a call statement's output defines and one item reads: its definition and that read
  const byWire = new Map<string, Statement>()
  for (const s of statements)
    if (s.kind === "call_stmt")
      for (const a of s.call.args) {
        const wire = a.output && a.value?.kind === "ident_expr" ? a.value.name.toLowerCase() : undefined
        if (wire !== undefined && wires.has(wire) && occurrences.get(wire) === 2) byWire.set(wire, s)
      }
  const out = new Map<string, Statement>()
  const take = (e: Expr): void =>
    walkExpr(e, (x) => {
      const wire = x.kind === "ident_expr" ? x.name.toLowerCase() : undefined
      const s = wire === undefined ? undefined : byWire.get(wire)
      if (s === undefined || out.has(wire!)) return
      out.set(wire!, s)
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

/** The guarded call statements `e` reads through their wires, and the ones those read in turn, in source order. */
export function guardedReadBy(e: Expr, guarded: ReadonlyMap<string, Statement>): Statement[] {
  const found = new Set<Statement>()
  const visit = (x: Expr): void =>
    walkExpr(x, (y) => {
      const s = y.kind === "ident_expr" ? guarded.get(y.name.toLowerCase()) : undefined
      if (s === undefined || found.has(s)) return
      found.add(s)
      if (s.kind === "call_stmt") for (const a of s.call.args) if (!a.output && a.value !== undefined) visit(a.value)
    })
  visit(e)
  return [...found].sort((a, b) => a.span.start - b.span.start)
}
