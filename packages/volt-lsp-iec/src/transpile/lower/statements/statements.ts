/**
 * Statements → IR: the dispatch, a block, IF / ELSIF / ELSE and RETURN; assignment, CASE and the loops beside it.
 */

import type { Lowering } from "../lowering.js"
import type { Statement, StatementList } from "../../../frontend/syntax/index.js"
import type { IrStmt } from "../../ir/index.js"
import { lowerAssign } from "./assign.js"
import { lowerCase } from "./case.js"
import { lowerExit, lowerFor, lowerRepeat, lowerWhile } from "./loops.js"
import { lowerExpr } from "../expressions/expressions.js"
import { elementaryRef } from "../../../frontend/types/index.js"
import { queryCondition } from "../interfaces/query.js"
import { lowerCallStatement } from "../calls/fb-call.js"

export function lowerBlock(lw: Lowering, list: StatementList): IrStmt[] {
  const out: IrStmt[] = []
  for (const s of list) {
    // a statement inside another runs only sometimes — a pointer it stores is not stored for what follows (`recordTarget`)
    const nests = s.kind === "if" || s.kind === "case" || s.kind === "for" || s.kind === "while" || s.kind === "repeat"
    if (nests) lw.conditional++
    const lowered = lowerStmt(lw, s)
    if (nests) lw.conditional--
    if (Array.isArray(lowered)) out.push(...lowered)
    else if (lowered !== undefined) out.push(lowered)
  }
  return out
}

export function lowerStmt(lw: Lowering, s: Statement): IrStmt | IrStmt[] | undefined {
  switch (s.kind) {
    case "empty":
      return undefined
    case "assign":
      return lowerAssign(lw, s)
    case "if":
      return lowerIf(lw, s)
    case "case":
      return lowerCase(lw, s)
    case "for":
      return lowerFor(lw, s)
    case "while":
      return lowerWhile(lw, s)
    case "repeat":
      return lowerRepeat(lw, s)
    case "call_stmt":
      return lowerCallStatement(lw, s.call)
    case "exit":
    case "continue":
      return lowerExit(lw, s)
    case "return":
      return { kind: "return", span: s.span }
    // `__TRY` is measured and not yet lowered: docs/architecture.md, "Backend — `transpile/`", sets out its model
    default:
      return lw.bail(`stmt-${s.kind}`, `${s.kind} is not lowered yet`, s.span)
  }
}

/** IF / ELSIF / ELSE. ELSIF is an ELSE holding one nested IF — one shape for the backend, not a branch list. A condition
 *  that is a `__QUERYINTERFACE` query puts the query just before the IF that tests it (`queryCondition`). */
function lowerIf(lw: Lowering, s: Extract<Statement, { kind: "if" }>): IrStmt[] | undefined {
  const build = (i: number): IrStmt[] | undefined => {
    const branch = s.branches[i]
    if (branch === undefined) return undefined
    const query = queryCondition(lw, branch.cond)
    if (query === undefined) return undefined
    const cond = query === null ? lowerExpr(lw, branch.cond, elementaryRef("BOOL")) : query.cond
    if (cond === undefined) return undefined
    const rest = build(i + 1)
    const otherwise = rest !== undefined ? rest : s.elseBody ? lowerBlock(lw, s.elseBody) : []
    return [...(query?.before ?? []), { kind: "if", cond, then: lowerBlock(lw, branch.body), else: otherwise, span: branch.span }]
  }
  return build(0)
}
