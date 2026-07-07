/**
 * duplicate-declaration (D.2 · names/). Same identifier declared twice in one scope → both vendors
 * error "A local variable named '<n>' is already defined in '<POU>'". Scoped to THIS file's unit
 * scopes only — cross-file name reuse (two GVLs, a `Delete` FB + `Delete` function) is legal and
 * namespace-resolved, so the project scope is never walked. `qualified_only` GVL vars are excluded
 * (they live in their own namespace, so same-named vars across GVLs don't collide).
 *
 * (The identifier-SHAPE lints — reserved-keyword / double-underscore / consecutive-underscore — are
 * opt-in style lints, off by default: the compilers parse-cascade on them, so a single clean message
 * would never match the IDE's error spray.)
 */
import { scopeForUnit, type Scope, type Symbol } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkDuplicateDeclarations(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    const scope = scopeForUnit(ctx.project, unit)
    if (scope !== undefined) walkScopeForDuplicates(scope, ctx, out)
  }
}

function walkScopeForDuplicates(scope: Scope, ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const [, symbols] of scope.symbols) {
    const bareName: Symbol[] = symbols.filter((s) => !s.qualifiedOnly)
    for (let i = 1; i < bareName.length; i++) {
      const sym = bareName[i]
      out.push({
        severity: "error",
        span: sym.span,
        source: SOURCE,
        code: "duplicate-declaration",
        message: ctx.messages.duplicateDeclaration(sym.name, scope.name),
      })
    }
  }
  for (const child of scope.children) walkScopeForDuplicates(child, ctx, out)
}
