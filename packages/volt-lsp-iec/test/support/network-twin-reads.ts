/**
 * WHAT THE EXEC TWIN READS OFF A NETWORK BODY'S STATEMENTS before it writes them (`network-twin.ts`): each wire's
 * occurrences, the assignments a wire is the whole value of, and the call statements a short-circuit branch runs only
 * when the branch runs.
 */
import { type BodySpan, type Expr, plainStText, type Statement, stmtExprs, walkExpr } from "../../src/frontend/syntax/index.js"

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

/** Each wire's occurrences in the network's code (its definition included), and the assignments whose whole value it is. */
export interface ValueReads {
  occurrences: Map<string, number>
  assignedBy: Map<string, AssignStatement>
}

export function valueReads(body: BodySpan, statements: readonly Statement[]): ValueReads {
  const wires = new Set(plainStText(body).networks.flatMap((n) => n.wires.map((w) => w.name.toLowerCase())))
  const occurrences = new Map<string, number>()
  const assignedBy = new Map<string, AssignStatement>()
  for (const s of statements) {
    for (const e of stmtExprs(s))
      walkExpr(e, (x) => {
        if (x.kind === "ident_expr" && wires.has(x.name.toLowerCase())) occurrences.set(x.name.toLowerCase(), (occurrences.get(x.name.toLowerCase()) ?? 0) + 1)
      })
    if (s.kind === "assign" && s.value.kind === "ident_expr" && wires.has(s.value.name.toLowerCase())) assignedBy.set(s.value.name.toLowerCase(), s)
  }
  return { occurrences, assignedBy }
}
