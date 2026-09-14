/**
 * Body iteration (Layer B) — the ONE scope-aware "walk every ST body" loop the analysis checks and the
 * language services share. Every check under `analysis/checks/**` and `services/shared` re-implemented
 * the same `units → body → scope → parseStatements → walk` loop inline; this is that loop, once.
 *
 * It lives in `symbols/` because it yields a `Scope` (from `scopeForUnit`) — `syntax/` can't own it
 * (that would be an upward dependency on `Scope`), and `analysis/`/`services/` are siblings so neither
 * can own what the other imports. `symbols/` already owns `scopeForUnit` and imports `syntax/`.
 *
 * Covers POU bodies AND property getter/setter accessor bodies (via `unitBodies`) — so diagnostics reach
 * accessor bodies that the old analysis `getBody` silently skipped. Graphical (network text) and non-parsing bodies
 * are skipped (conservative — the compilers analyze neither the way this ST engine would).
 */
import {
  isGraphicalBody,
  parseStatements,
  unitBodies,
  walkAllExprs,
  walkExpr,
  type BodySpan,
  type Expr,
  type ParseResult,
  type StatementList,
  type TopLevel,
} from "../syntax/index.js"
import { scopeForUnit } from "./scope-nav.js"
import type { Scope } from "./symbol.js"

export interface UnitBody {
  unit: TopLevel
  body: BodySpan
  scope: Scope
  statements: StatementList
}

/** Every cleanly-parsed ST body across `units` with its unit, resolved scope, and parsed statements.
 *  A unit whose scope doesn't resolve is SKIPPED (never analyzed against the project scope, where no local
 *  is visible) — that preserves the checks' zero-false-positive guarantee. Property getter/setter bodies
 *  resolve to their own child scope (keyed by body span) so accessor locals stay isolated. */
export function* bodies(units: readonly TopLevel[], project: Scope): Generator<UnitBody> {
  for (const unit of units) {
    const unitScope = scopeForUnit(project, unit)
    if (unitScope === undefined) continue
    for (const body of unitBodies(unit)) {
      if (isGraphicalBody(body)) continue
      const scope = unitScope.children.find((c) => c.span === body.span) ?? unitScope
      const parsed = parseStatements(body)
      if (parsed.ok) yield { unit, body, scope, statements: parsed.statements }
    }
  }
}

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
 * the declaration / type / oop checks (moved from `analysis/checks/_shared`, consolidate-lsp-structure C2), plus
 * the unit `scope` each resolves names against. The decl counterpart
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

/**
 * The bodies `bodies()` yields whose span holds `offset` (half-open, as a cursor sits) — for the features that act at a
 * cursor. They used to re-walk the units with the UNIT scope, so a local declared inside a property accessor resolved
 * nowhere in go-to-definition and signature help (consolidate-lsp-structure A5).
 */
export function* bodiesAt(units: readonly TopLevel[], project: Scope, offset: number): Generator<UnitBody> {
  for (const b of bodies(units, project)) if (offset >= b.body.span.start && offset < b.body.span.end) yield b
}
