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
  type BodySpan,
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
