/**
 * Shared traversal for the ST statement/expression tree (`ast.ts`).
 *
 * One place that knows the shape of every `Expr`/`Statement` node, so
 * consumers (type inference, the checks, the name-offset collector, the
 * future formatter/interpreter) don't each hand-roll a `switch (kind)`.
 * Pure — depends only on the AST types, no lexer/semantic imports.
 *
 * `IdentExpr` nodes reached as children include member names (`a.b` → the
 * `.b`) and named-argument params (`f(p := v)` → the `p`), since both are
 * `IdentExpr` in the tree; a consumer that only wants "real" references
 * filters by context.
 */
import type { Expr, Statement, StatementList, TopLevel } from "./nodes.js"

/**
 * EVERY UNIT OF A FILE, NAMESPACES FLATTENED — in source order, each namespace's units where the namespace stands; a
 * namespace is not itself a unit this yields. The one namespace flattener: every walk over "the units of a file" that
 * must see inside `NAMESPACE … END_NAMESPACE` goes through here.
 */
export function allUnits(units: readonly TopLevel[]): TopLevel[] {
  const out: TopLevel[] = []
  for (const u of units) {
    if (u.kind === "namespace") out.push(...allUnits(u.units))
    else out.push(u)
  }
  return out
}

/** Immediate sub-expressions of an expression, in source order. */
export function exprChildren(e: Expr): Expr[] {
  switch (e.kind) {
    case "ident_expr":
    case "literal":
      return []
    // the name after the dot is no child: a walker that resolves names resolves them locals first (`GlobalExpr`)
    case "global_expr":
      return []
    case "binary":
      return [e.left, e.right]
    case "unary":
      return [e.operand]
    case "member":
      return [e.base, e.member]
    case "index":
      return [e.base, ...e.indices]
    case "deref":
      return [e.base]
    case "call":
      return [e.callee, ...e.args.flatMap((a) => [...(a.param ? [a.param] : []), ...(a.value ? [a.value] : [])])]
    case "paren":
      return [e.inner]
    case "assign_expr":
      return [e.target, e.value]
  }
}

/** Pre-order visit of an expression and every descendant expression. */
export function walkExpr(e: Expr, visit: (e: Expr) => void): void {
  visit(e)
  for (const c of exprChildren(e)) walkExpr(c, visit)
}

/** Expressions held DIRECTLY by a statement (not those inside its nested blocks). */
export function stmtExprs(s: Statement): Expr[] {
  switch (s.kind) {
    case "assign":
      return s.chained ? [s.target, ...s.chained, s.value] : [s.target, s.value]
    case "call_stmt":
      return [s.call]
    case "expr_stmt":
      return [s.expr]
    case "if":
      return s.branches.map((b) => b.cond)
    case "case":
      return [s.selector, ...s.arms.flatMap((a) => a.labels.flatMap((l) => (l.upper ? [l.value, l.upper] : [l.value])))]
    case "for":
      return s.by ? [s.controlVar, s.from, s.to, s.by] : [s.controlVar, s.from, s.to]
    case "while":
      return [s.cond]
    case "repeat":
      return [s.until]
    case "try":
      return s.catchVar ? [s.catchVar] : []
    case "return":
    case "exit":
    case "continue":
    // A JMP target is a label name, not a value expression — deliberately NOT walked (so identifier resolution
    // doesn't flag it as an undefined variable). The jump-labels check reads `s.target` directly.
    case "jmp":
    case "label":
    case "empty":
      return []
  }
}

/** Nested statement blocks held by a statement (IF branches/else, CASE arms/else, loop bodies). */
export function stmtChildLists(s: Statement): StatementList[] {
  switch (s.kind) {
    case "if":
      return [...s.branches.map((b) => b.body), ...(s.elseBody ? [s.elseBody] : [])]
    case "case":
      return [...s.arms.map((a) => a.body), ...(s.elseBody ? [s.elseBody] : [])]
    case "for":
    case "while":
    case "repeat":
      return [s.body]
    case "try":
      return [s.tryBody, ...(s.catchBody ? [s.catchBody] : []), ...(s.finallyBody ? [s.finallyBody] : [])]
    default:
      return []
  }
}

/** Pre-order visit of every statement in a list, recursing into nested blocks. */
export function walkStatements(list: StatementList, onStmt: (s: Statement) => void): void {
  for (const s of list) {
    onStmt(s)
    for (const sub of stmtChildLists(s)) walkStatements(sub, onStmt)
  }
}

/** Visit every expression node in a statement list (full expr trees, recursing into nested blocks). */
export function walkAllExprs(list: StatementList, visit: (e: Expr) => void): void {
  walkStatements(list, (s) => {
    for (const e of stmtExprs(s)) walkExpr(e, visit)
  })
}
