/**
 * AST VISITORS the lowering folders share — the one home of every walk over ST syntax in `lower/` (transpile-restructure
 * 1.7.1). The walks over the IR are `ir/walk.ts`'s.
 */

import type { Expr } from "../../../frontend/syntax/index.js"
import type { FbType, Lowering, RoutineSymbol } from "./lowering.js"
import { lookup, lookupMember } from "../../../frontend/symbols/index.js"

/** The nodes an AST node holds — every own value but its `span`, which holds only positions. The AST has no exhaustive
 *  child table the way the IR has (`ir/walk.childrenOf`), so the walks below take every value and test each by shape. */
function astChildren(node: object): unknown[] {
  return Object.entries(node).flatMap(([key, child]) => (key === "span" ? [] : [child]))
}

/** The operand an IF condition LEADS with — the one that runs first whatever the rest decides: through parentheses,
 *  NOT, and the left side of AND_THEN / OR_ELSE (`queryCondition`). */
export function leadingOperand(e: Expr): Expr {
  return e.kind === "paren" ? leadingOperand(e.inner)
    : e.kind === "unary" && e.op === "NOT" ? leadingOperand(e.operand)
    : e.kind === "binary" && (e.op === "AND_THEN" || e.op === "OR_ELSE") ? leadingOperand(e.left)
    : e
}

/** Only try the lowering path for an expression that actually HOLDS a call — everything else `constEval` covers. */
export function exprHoldsCall(e: Expr): boolean {
  switch (e.kind) {
    case "call":
      return true
    case "paren":
      return exprHoldsCall(e.inner)
    case "unary":
      return exprHoldsCall(e.operand)
    case "binary":
      return exprHoldsCall(e.left) || exprHoldsCall(e.right)
    default:
      return false
  }
}

/** Whether a body calls — `M()`, `THIS^.M()`, `SUPER^.M()` — a METHOD or ACTION that `frame` overrides below `chain`: a
 *  routine of that chain run on the frame then reaches the frame's own in-outs through the override. */
export function overridesCalled(frame: FbType, chain: ReadonlySet<string>, statements: readonly unknown[]): boolean {
  const scope = frame.scope
  if (scope === undefined) return false
  let found = false
  const walk = (node: unknown): void => {
    if (found || node === null || typeof node !== "object") return
    if (Array.isArray(node)) return node.forEach(walk)
    const n = node as { kind?: string; callee?: { kind: string; name?: string; base?: { kind: string }; member?: { name: string } } }
    const callee = n.kind === "call" ? n.callee : undefined
    const name = callee?.kind === "ident_expr" ? callee.name : callee?.kind === "member" && callee.base?.kind === "deref" ? callee.member?.name : undefined
    const member = name === undefined ? undefined : lookupMember(scope, name)
    if ((member?.kind === "method" || member?.kind === "action") && !chain.has((member as RoutineSymbol).owner.name.toUpperCase())) found = true
    astChildren(node).forEach(walk)
  }
  walk(statements)
  return found
}

/**
 * The bare names a body reads — or "all" when it calls a METHOD or ACTION of its own instance (`M()`, `THIS^.M()`,
 * `SUPER^()`), which may reach any of the FB's in-outs. ponytail: "all" over-approximates; a call graph would narrow it.
 */
export function reachedNames(r: Lowering, statements: readonly unknown[]): Set<string> | "all" {
  const names = new Set<string>()
  let all = false
  const walk = (node: unknown): void => {
    if (all || node === null || typeof node !== "object") return
    if (Array.isArray(node)) return node.forEach(walk)
    const n = node as { kind?: string; name?: string; callee?: { kind: string; name?: string; base?: { kind: string } } }
    if (n.kind === "ident_expr") names.add(n.name!.toUpperCase())
    if (n.kind === "call" && n.callee !== undefined) {
      const callee = n.callee
      const kind = callee.kind === "ident_expr" ? lookup(r.scope, callee.name!)?.symbol.kind : undefined
      if (kind === "method" || kind === "action" || callee.kind === "deref" || (callee.kind === "member" && callee.base?.kind === "deref")) all = true
    }
    astChildren(node).forEach(walk)
  }
  walk(statements)
  return all ? "all" : names
}

/**
 * FORM 2's TEST (`pointer-model.md` §4): which `POINTER TO` parameters this body only DEREFERENCES.
 *
 * A parameter's form is decided by the CALLEE, not by the call sites — whether a borrow is sound depends on whether
 * the callee keeps the pointer past the call, which is a property of its own body. §4 measured it that way over the
 * corpus's 99 pointer parameters: 62 are used only in the callee's own body.
 *
 * The test here is the strict half of that: every occurrence of the name is the BASE OF A `^`. That admits
 * `p^`, `p^.field` and `p^[i]`, and rejects everything that could let the address outlive the call — storing it
 * (`held := p`), comparing it, taking `ADR` of it, or handing it on to another callee (`f(q := p)`, a REBORROW,
 * which is sound and is simply not this step: `ptrparam_passed_on` stays refused and says so).
 *
 * Conservative by construction: a name this cannot see through — a call that could reach anything — disqualifies
 * every parameter, the same way `reachedNames` answers `"all"`.
 */
export function borrowedPointerNames(r: Lowering, statements: readonly unknown[], candidates: ReadonlySet<string>): Set<string> {
  const borrowed = new Set(candidates)
  const walk = (node: unknown, derefBase: boolean): void => {
    if (node === null || typeof node !== "object") return
    if (Array.isArray(node)) return void node.forEach((x) => walk(x, false))
    const n = node as { kind?: string; name?: string; base?: unknown }
    // the one accepted position: `<name>^`, however the result is then indexed or fielded
    if (n.kind === "deref") return walk(n.base, true)
    if (n.kind === "ident_expr") {
      if (!derefBase) borrowed.delete(n.name!.toUpperCase())
      return
    }
    for (const child of astChildren(node)) walk(child, false)
  }
  walk(statements, false)
  return borrowed
}

/**
 * The names whose FIRST MENTION in `statements` — any identifier, at any depth, a read included — is the callee of a
 * call STATEMENT at the top level of the list, with the source offset of that call (`init/step.ts` orders the called
 * PROGRAMs' initialization by it: `init_frame_order_several{,_renamed}` record only bodies that call them as bare
 * statements). A name mentioned first anywhere else — read, called inside an expression or a branch — is absent: which
 * order that gives is not recorded (gate 5c).
 */
export function leadingCalls(statements: readonly unknown[]): Map<string, number> {
  const mentioned = new Map<string, number>()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node === null || typeof node !== "object") return
    const n = node as { kind?: string; name?: unknown; span?: { start: number } }
    if (n.kind === "ident_expr" && typeof n.name === "string" && n.span !== undefined) {
      const name = n.name.toUpperCase()
      if (!mentioned.has(name) || mentioned.get(name)! > n.span.start) mentioned.set(name, n.span.start)
    }
    astChildren(node).forEach(walk)
  }
  walk(statements)
  const leading = new Map<string, number>()
  for (const s of statements as { kind?: string; call?: { callee?: { kind?: string; name?: string; span?: { start: number } } } }[]) {
    const callee = s.kind === "call_stmt" ? s.call?.callee : undefined
    if (callee?.kind !== "ident_expr" || callee.name === undefined || callee.span === undefined) continue
    const name = callee.name.toUpperCase()
    if (!leading.has(name) && mentioned.get(name) === callee.span.start) leading.set(name, callee.span.start)
  }
  return leading
}
