/**
 * LT14 — THE TWO TYPES AN UNTYPED LITERAL IS GIVEN (openspec frontend-conformance, rule LT14, task 4.2).
 *
 * An untyped literal has no type of its own; its context gives it one, and two places in the package each decide which:
 *   the TRANSPILER  `transpile/lower/constants` `contextLiteralType(lit, expected)` — the type the value is LOWERED in;
 *   the CHECKER     `types/literal` `literalCheckType` — the type the literal is CHECKED as against its
 *                   target, and the target itself where the literal fits it silently.
 * Both are asked of every literal stored somewhere — an initializer, an assignment, an input argument, a FOR bound, a CASE
 * label — with the store's target as the context (a negated literal is lowered as its operand under the same context, as
 * `lower/expressions` does). Where they disagree it is a finding, one line per (target, transpiler, checker) class with its
 * count; the call site that reads `contextLiteralType` is the transpiler's (a T hand-off, frontend-conformance 5.3).
 */
import { allUnits, walkStatements, type Expr, type TopLevel } from "../../src/frontend/syntax/index.js"
import { bodies, scopeForUnit, type Scope } from "../../src/frontend/symbols/index.js"
import { inferExprType, literalCheckType, renderType, resolveCallee, resolveTypeExpr, type Type } from "../../src/frontend/types/index.js"
import { contextLiteralType } from "../../src/transpile/lower/constants.js"
import { valueExprs, type Bound } from "./dumps.js"

/** One literal store's two answers. */
export interface LiteralAnswer {
  target: string
  transpiler: string
  checker: string
}

/** The untyped numeric literal `e` stands for — itself, or the operand of its sign — or undefined. */
function untypedLiteral(e: Expr): Extract<Expr, { kind: "literal" }> | undefined {
  const lit = e.kind === "unary" && (e.op === "-" || e.op === "+") ? e.operand : e
  return lit.kind === "literal" && (lit.literalKind === "int" || lit.literalKind === "real") ? lit : undefined
}

/** Both answers for every literal stored in `b`, against an elementary target. */
export function literalAnswers(b: Bound): LiteralAnswer[] {
  const out: LiteralAnswer[] = []
  const ask = (target: Type, value: Expr | undefined): void => {
    if (value === undefined || target.kind !== "elementary") return
    const lit = untypedLiteral(value)
    if (lit === undefined) return
    // the WARNING type (`literalCheckType`): the type the literal converts from where it does not fit, else the target —
    // `literalErrorType` answers another question (a literal into a REAL is its narrowest integer for the error check)
    const checked = literalCheckType(value, target) ?? target
    out.push({ target: renderType(target), transpiler: renderType(contextLiteralType(lit, target)), checker: renderType(checked) })
  }
  const inner = (e: Expr, scope: Scope): void => {
    for (const x of valueExprs(e)) {
      if (x.kind !== "call") continue
      const callee = resolveCallee(x, scope, b.project)
      if (callee === undefined) continue
      x.args.forEach((a, i) => {
        if (a.value === undefined || a.output) return
        const param = a.param === undefined ? callee.positional[i] : callee.positional.find((p) => p.name.text.toLowerCase() === a.param!.name.toLowerCase())
        if (param !== undefined && !param.inOut) ask(resolveTypeExpr(param.type, b.project, 0, b.project, callee.sym.uri), a.value)
      })
    }
  }
  const units: readonly TopLevel[] = b.parsed.parseResult.units
  for (const unit of allUnits(units)) {
    const scope = scopeForUnit(b.project, unit)
    if (scope === undefined || !("varSections" in unit)) continue
    for (const section of unit.varSections)
      for (const decl of section.decls)
        if (decl.init !== undefined && decl.init.kind !== "aggregate_init" && decl.initOp === undefined) {
          ask(resolveTypeExpr(decl.type, b.project, 0, scope), decl.init)
          inner(decl.init, scope)
        }
  }
  for (const { scope, statements } of bodies(units, b.project))
    walkStatements(statements, (s) => {
      if (s.kind === "assign" && s.op === undefined && s.chained === undefined) {
        ask(inferExprType(s.target, scope, b.project), s.value)
        inner(s.value, scope)
      } else if (s.kind === "for") {
        const counter = inferExprType(s.controlVar, scope, b.project)
        for (const bound of [s.from, s.to, s.by]) ask(counter, bound)
      } else if (s.kind === "case") {
        const selector = inferExprType(s.selector, scope, b.project)
        for (const label of s.arms.flatMap((a) => a.labels)) for (const v of [label.value, label.upper]) ask(selector, v)
      } else if (s.kind === "expr_stmt") inner(s.expr, scope)
    })
  return out
}
