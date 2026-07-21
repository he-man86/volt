/**
 * Shared utilities for the per-check modules under `analysis/checks/`. The underscore marks
 * "internal to the checks tree". `DiagnosticItem` lives here (a leaf) so the orchestrator and every
 * check import it without a cycle.
 */
import { walkAllExprs, walkExpr, type Expr, type ParseResult, type Span } from "../../syntax/index.js"
import { bodies, scopeForUnit, type Scope } from "../../symbols/index.js"

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
export function forEachExpr(
  parseResult: ParseResult,
  project: Scope,
  visit: (e: Expr, scope: Scope) => void,
): void {
  for (const unit of parseResult.units) {
    if (!("varSections" in unit)) continue
    const scope = scopeForUnit(project, unit)
    if (scope === undefined) continue
    for (const section of unit.varSections)
      for (const decl of section.decls)
        if (decl.init !== undefined && decl.init.kind !== "aggregate_init") walkExpr(decl.init, (e) => visit(e, scope))
  }
  for (const { scope, statements } of bodies(parseResult.units, project)) walkAllExprs(statements, (e) => visit(e, scope))
}

/**
 * True when a URI points into a referenced-library SIGNATURE (a `Library Manager` folder) — READ-ONLY content
 * the bridge materialized, not the user's editable project source (visualizations, library FBs/types, etc.).
 *
 * Normalize the space first: the live server keys documents/symbols by `file://` URI (`Library%20Manager`),
 * the corpus and unit tests by raw OS path (`Library Manager`). Matching only the raw form left the guard
 * silently OFF under the real LSP. Single source of truth for every caller.
 */
export function isLibraryUri(uri: string): boolean {
  return uri.replace(/%20/g, " ").includes("Library Manager")
}

/**
 * True when a symbol comes from a referenced-library signature (see {@link isLibraryUri}). The bridge
 * materializes a library's declaration but not everything a project POU carries — notably PROPERTIES are absent
 * from the precompiled language model — so member/section checks skip library types to stay zero-FP. (Methods
 * ARE now materialized, so those resolve; the skip remains for the property residual.)
 */
export function isLibrarySymbol(sym: { uri: string }): boolean {
  return isLibraryUri(sym.uri)
}
