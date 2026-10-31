/**
 * Statements → IR: the dispatch, a block, IF / ELSIF / ELSE and RETURN; assignment, CASE and the loops beside it.
 */

import type { Lowering } from "../core/lowering.js"
import { type Statement, type StatementList, walkStatements } from "../../../frontend/syntax/index.js"
import type { IrStmt } from "../../ir/index.js"
import { lowerAssign } from "./assign.js"
import { lowerCase } from "./case.js"
import { lowerExit, lowerFor, lowerRepeat, lowerWhile } from "./loops.js"
import { lowerExpr } from "../expressions/expressions.js"
import { elementaryRef } from "../../../frontend/types/index.js"
import { queryCondition } from "../interfaces/query.js"
import { lowerCallStatement } from "../calls/fb-call.js"
import { rawCondition } from "../pointers/raw-bool.js"

/**
 * A BODY: its block — or, where a JMP names a label standing at its top level, one `labeled` node (`IrLabeled`), the
 * statements cut at each such label. A label no JMP names is no statement. Every statement of a labeled body runs only
 * sometimes (a jump may pass it, or come back to it): its pointer stores are not stored for what follows (`recordTarget`).
 */
export function lowerBody(lw: Lowering, list: StatementList): IrStmt[] {
  const named = new Set<string>()
  walkStatements(list, (s) => {
    if (s.kind === "jmp" && s.target.kind === "ident_expr") named.add(s.target.name.toLowerCase())
  })
  const cuts = list.flatMap((s, i) => (s.kind === "label" && named.has(s.name.text.toLowerCase()) ? [i] : []))
  if (cuts.length === 0) return lowerBlock(lw, list)
  const starts = cuts[0] === 0 ? cuts : [0, ...cuts]
  const targets = new Map<string, number>()
  for (const i of cuts) {
    const label = (list[i] as Extract<Statement, { kind: "label" }>).name.text.toLowerCase()
    // refused: the body's diagnostic, as a refused statement's in `lowerBlock`, refuses the unit
    if (targets.has(label)) return (lw.bail("stmt-label", `the label ${label} stands twice in the body`, list[i]!.span), [])
    targets.set(label, starts.indexOf(i))
  }
  const outer = lw.jumpTargets
  lw.jumpTargets = targets
  lw.conditional++
  const segments = starts.map((start, k) => {
    const head = list[start]!
    return {
      ...(head.kind === "label" && cuts.includes(start) ? { label: head.name.text } : {}),
      body: lowerBlock(lw, list.slice(start, starts[k + 1] ?? list.length)),
    }
  })
  lw.conditional--
  lw.jumpTargets = outer
  // a label at the body's end starts nothing: a jump to it leaves the body (its target is past the last segment)
  if (segments.length > 1 && segments.at(-1)!.body.length === 0) segments.pop()
  return [{ kind: "labeled", segments, span: list[0]!.span }]
}

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
    // a label a JMP names starts a segment of its body (`lowerBody`); one standing in a block is refused at its JMP
    case "label":
      return undefined
    case "jmp": {
      const label = s.target.kind === "ident_expr" ? s.target.name.toLowerCase() : undefined
      const target = label === undefined ? undefined : lw.jumpTargets.get(label)
      if (target === undefined) return lw.bail("stmt-jmp", `the JMP's label ${label ?? ""} does not stand at the body's top level`, s.span)
      return { kind: "jump", target, label: label!, span: s.span }
    }
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
    const lowered = query === null ? lowerExpr(lw, branch.cond, elementaryRef("BOOL")) : query.cond
    if (lowered === undefined) return undefined
    // a BOOL held as its byte is taken when the byte is not 0 (`pointers/raw-bool.ts`)
    const cond = rawCondition(lw, lowered)
    const rest = build(i + 1)
    const otherwise = rest !== undefined ? rest : s.elseBody ? lowerBlock(lw, s.elseBody) : []
    return [...(query?.before ?? []), { kind: "if", cond, then: lowerBlock(lw, branch.body), else: otherwise, span: branch.span }]
  }
  return build(0)
}
