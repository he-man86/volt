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
import { allUnits } from "../../../frontend/syntax/index.js"
import { scopeForUnit, type Scope, type Symbol } from "../../../frontend/symbols/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkDuplicateDeclarations(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of allUnits(ctx.parseResult.units)) {
    const scope = scopeForUnit(ctx.project, unit)
    if (scope === undefined) continue
    walkScopeForDuplicates(scope, ctx, out)
    // a FUNCTION's or METHOD's name IS its result variable (rule Y20): a local or VAR_INPUT of that name declares it a
    // second time — "A local variable named 'F' is already defined in 'F'" on both vendors
    // (`sym_function_local_named_as_function`, `sym_function_input_named_as_function`, `sym_method_local_named_as_method`,
    // `sym_method_input_named_as_method`). A METHOD with no `: <type>` has no result variable, and an input of its name is
    // an input: pro2193's `METHOD PUBLIC Rollover` takes `rollover := 5` and builds
    if (unit.kind === "function" || (unit.kind === "method" && unit.returnType !== undefined))
      for (const sym of scope.symbols.get(unit.name.text.toLowerCase()) ?? [])
        out.push({
          severity: "error",
          span: sym.span,
          source: SOURCE,
          code: "duplicate-declaration",
          message: ctx.messages.duplicateDeclaration(sym.name, scope.name),
        })
  }
}

function walkScopeForDuplicates(scope: Scope, ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const [, symbols] of scope.symbols) {
    const bareName: Symbol[] = symbols.filter((s) => !s.qualifiedOnly)
    for (let i = 1; i < bareName.length; i++) {
      const sym = bareName[i]
      // Two methods sharing a name is an unmarked overload (C0582) — a distinct error from a duplicate var, and
      // one Volt can't push at all (the bridge's CreateChild rejects the second child). Use its own wording.
      const isMethod = sym.kind === "method" && bareName[i - 1].kind === "method"
      out.push({
        severity: "error",
        span: sym.span,
        source: SOURCE,
        code: isMethod ? "duplicate-method" : "duplicate-declaration",
        message: isMethod ? ctx.messages.duplicateMethod(sym.name) : ctx.messages.duplicateDeclaration(sym.name, scope.name),
      })
    }
  }
  // A unit's scope is walked for that unit — a METHOD's, an ACTION's and a PROPERTY's are units of their own, so the FB's
  // walk does not descend into them (it reported a method's duplicate a second time, `sym_duplicate_method_param_and_local`).
  // A property's accessor scopes belong to no unit: the property's walk takes them.
  if (scope.kind === "accessor")
    for (const child of scope.children) if (child.kind === "accessor") walkScopeForDuplicates(child, ctx, out)
}
