/**
 * Shared utilities for the per-check modules under `analysis/checks/`. The underscore marks
 * "internal to the checks tree". `DiagnosticItem` lives here (a leaf) so the orchestrator and every
 * check import it without a cycle.
 */
import { walkAllExprs, walkExpr, type Expr, type ParseResult, type Span } from "../../syntax/index.js"
import { bodies, scopeForUnit, type Scope } from "../../symbols/index.js"
import { classifyConversion, elemOf, inferExprType, renderType, type Type } from "../../types/index.js"
import type { Messages } from "../messages.js"

export interface DiagnosticItem {
  severity: "error" | "warning" | "information" | "hint"
  span: Span
  source: string
  code: string
  message: string
}

/** Source tag on every DiagnosticItem this LSP emits. */
export const SOURCE = "volt-lsp-iec"

/**
 * Visit every expression node in a project, with the scope it resolves against — the ONE traversal the
 * expr-node checks (deref, binary-operators, constant-overflow, bit-number, indexing, comparison) share,
 * instead of each re-writing the `bodies() → walkAllExprs` loop. Covers BOTH scalar variable initializers
 * (unit scope) and statement bodies (body scope). Skips units whose scope doesn't resolve (0-FP, like
 * `bodies()`). Statement-level checks (assignment/narrowing pairs) walk statements directly, not this.
 */
export function forEachExpr(parseResult: ParseResult, project: Scope, visit: (e: Expr, scope: Scope) => void): void {
  for (const unit of parseResult.units) {
    if (!("varSections" in unit)) continue
    const scope = scopeForUnit(project, unit)
    if (scope === undefined) continue
    for (const section of unit.varSections)
      for (const decl of section.decls)
        if (decl.init !== undefined && decl.init.kind !== "aggregate_init") walkExpr(decl.init, (e) => visit(e, scope))
  }
  for (const { scope, statements } of bodies(parseResult.units, project))
    walkAllExprs(statements, (e) => visit(e, scope))
}

/**
 * Visit every variable declaration in a project — the `units → varSections → sections → decls` walk shared by
 * the declaration / type / oop checks, plus the unit `scope` each resolves names against. The decl counterpart
 * of `forEachExpr`. Unlike `forEachExpr`, a unit whose scope doesn't resolve is NOT skipped: `scope` falls back
 * to the project scope, so a check that only touches the decl node (or looks up in `project`) still runs on
 * every unit. Checks needing the section or unit destructure them too.
 */
export function* forEachDecl(parseResult: ParseResult, project: Scope) {
  for (const unit of parseResult.units) {
    if (!("varSections" in unit)) continue
    const scope = scopeForUnit(project, unit) ?? project
    for (const section of unit.varSections) for (const decl of section.decls) yield { unit, section, decl, scope }
  }
}

/** A type a conversion check can decide — elementary or enum — else undefined (a struct, FB, array or unknown type). */
export function checkable(t: Type): Type | undefined {
  return t.kind === "elementary" || t.kind === "enum" ? t : undefined
}

/**
 * An expression's checkable type — the ONE the assignment, narrowing and call-argument checks share. Inference types an
 * enum value as its enum, so there is no enum lookup here: each of those checks kept its own, and the call-argument copy
 * never learned an enum's base type (consolidate-lsp-structure B6).
 */
export function checkableType(expr: Expr, scope: Scope, project: Scope): Type | undefined {
  return checkable(inferExprType(expr, scope, project))
}

/**
 * A type as the COMPILER prints it in a conversion message. An enum's name is upper-cased — `DUT_LANG_cc_enum_byte` is
 * "Cannot convert type 'DUT_LANG_CC_ENUM_BYTE' to type 'BYTE'" (conformance `cc_enum_into_*`); `renderType` keeps the
 * declared spelling, which hover wants.
 */
export function compilerTypeName(t: Type): string {
  return t.kind === "enum" ? t.name.toUpperCase() : renderType(t)
}

/**
 * Map a source→value conversion to its narrowing / change-of-sign WARNING on `at`, or undefined. The ONE mapping —
 * the assignment pair and conversion-argument checks (types/narrowing.ts), the negation operand, and the
 * call-argument check (calls/call-arguments.ts) all funnel through it, so the wording stays byte-identical.
 *
 * It lives here, not in narrowing.ts, because two check groups share it: `call-arguments.ts` imported it from its
 * sibling `narrowing.ts`, which the layering rule forbids — and that lint had been red, unnoticed, since 2026-09-06,
 * because CI is advisory and nothing else runs it.
 */
export function conversionWarning(lhs: Type, rhs: Type, at: Expr, messages: Messages): DiagnosticItem | undefined {
  const kind = classifyConversion(lhs, rhs)
  if (kind === "narrow") return conversionWarn(at, "narrowing-conversion", messages.narrowing(compilerTypeName(rhs), compilerTypeName(lhs)))
  if (kind === "sign-change")
    return conversionWarn(
      at,
      "sign-change-conversion",
      messages.signChange(signOf(rhs), compilerTypeName(rhs), signOf(lhs), compilerTypeName(lhs)),
    )
  return undefined
}

const conversionWarn = (target: Expr, code: string, message: string): DiagnosticItem => ({
  severity: "warning",
  span: target.span,
  source: SOURCE,
  code,
  message,
})

function signOf(t: Type): string {
  // the facts ride on the Type — no second lookup by name (consolidate-lsp-structure B1); an enum signs as its base
  return elemOf(t.kind === "enum" && t.base !== undefined ? t.base : t)?.signed ? "signed" : "unsigned"
}

// `isLibrarySymbol` moved to the symbols layer (B) so types (const-eval/infer) reach the SAME normalized
// predicate — re-exported here so analysis callers keep importing it from `_shared`. See its doc in symbol.ts.
export { isLibrarySymbol } from "../../symbols/index.js"
