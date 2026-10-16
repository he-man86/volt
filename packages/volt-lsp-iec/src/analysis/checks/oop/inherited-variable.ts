/**
 * inherited-variable (C0097 · oop/). A derived FB that declares a variable with the same name as one already
 * declared in a base FB — IEC forbids redeclaring an inherited variable. CODESYS: "Duplicate definition of
 * variable '<name>' in function block '<FB>' and in base '<base FB>'".
 *
 * Zero-FP: only a PROJECT base is compared (a library base's private vars flatten/hide across the wire, so a
 * name we can't see could false-collide — library bases in the chain are skipped, and a library-provided
 * derived FB is skipped entirely). Only `var`-kind symbols collide — a method/property of the same name is a
 * legal override, not a duplicate variable. The nearest base that declares the name is the one reported.
 */
import { exprText, renderTypeExpr, type VarDecl } from "../../../frontend/syntax/index.js"
import { extendsChain, isLibrarySymbol, lookup, scopeForUnit, type Symbol } from "../../../frontend/symbols/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { emit, type DiagnosticItem, type Fix } from "../../shared/diagnostic-item.js"
import { fixOf, removeConstruct, sameSection, sectionOf } from "../../shared/fixes.js"

export function checkInheritedVariable(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "function_block" || unit.extends === undefined) continue
    const self = lookup(ctx.project, unit.name.text)?.symbol
    if (self !== undefined && isLibrarySymbol(self)) continue // library-provided FB → not the user's concern
    const scope = scopeForUnit(ctx.project, unit)
    if (scope?.baseScope === undefined) continue

    // Map every inherited variable name → the nearest base FB that declares it (project bases only).
    // The walk is cycle-guarded: `A EXTENDS B` and `B EXTENDS A` both bind, and this looped forever on them — the
    // whole semantic pass HUNG, which in the editor is every diagnostic stopping until the file is fixed. Every other
    // chain walk here already carries the guard (`lookupInChain`, `hasUnresolvedBase`); this one did not.
    // Why missed: no fixture declared a cycle, and real projects do not contain one (conformance
    // `cc2_circular_inheritance`).
    const inherited = new Map<string, { base: string; sym: Symbol | undefined; unit: Symbol["ast"] | undefined }>()
    // seeded with the FB ITSELF: in a cycle its own scope is reached again as a "base", and every one of its variables
    // was then reported as duplicating itself ("in function block 'FB_C2_circleA' and in base 'FB_C2_circleA'").
    // A cycle is `circular-inheritance`'s to report, and it does.
    // (`extendsChain` walks each scope once, so the chain ends where a cycle closes — back at the FB itself.)
    for (const base of extendsChain(scope).reverse().slice(1)) {
      const baseSym = lookup(ctx.project, base.name)?.symbol
      if (baseSym !== undefined && isLibrarySymbol(baseSym)) break // library base → vars may be hidden; stop
      // a base VAR_TEMP is storage of the base body's run, not inherited: both vendors build a derived FB redeclaring it
      // (`var_temp_base_redeclared_as_var`, `_as_temp`, recorded 2026-10-10)
      for (const [name, syms] of base.symbols)
        if (isInherited(syms) && !inherited.has(name))
          inherited.set(name, { base: base.name, sym: syms.find((s) => s.kind === "var" && s.varSection !== "VAR_TEMP"), unit: baseSym?.ast })
    }

    // Flag each own variable whose name is already declared in a base.
    for (const [name, syms] of scope.symbols) {
      const declared = inherited.get(name)
      if (declared === undefined || !isVar(syms)) continue
      const declaredIn = declared.base
      const decl = syms.find((s) => s.kind === "var")
      emit(
        out,
        decl?.span ?? unit.name.span,
        "duplicate-inherited-variable",
        ctx.messages.duplicateInheritedVariable(decl?.name ?? name, unit.name.text, declaredIn),
        "error",
        [decl === undefined || declared.sym === undefined ? undefined : removeRedeclaration(ctx, unit, decl, declared.sym, declared.unit, declaredIn)],
      )
    }
  }
}

const isVar = (syms: readonly Symbol[]): boolean => syms.some((s) => s.kind === "var")
const isInherited = (syms: readonly Symbol[]): boolean => syms.some((s) => s.kind === "var" && s.varSection !== "VAR_TEMP")

/**
 * C0097's fix (design.md §4 F10): "Remove the redeclaration (inherit <base>.<name> : <type>[ := <value>])" — the derived
 * block's declaration removed, its title naming what the block then has: the base's variable (`qf_c0097_remove_same`,
 * `_remove_differ`). `preferred` only where the two are declared ALIKE, in sections of one kind and qualifiers (§3: then
 * removing it changes nothing). Only a
 * declaration of this document naming that one variable; a base value that is no plain expression is not named.
 */
function removeRedeclaration(ctx: CheckContext, ownUnit: Symbol["ast"], own: Symbol, base: Symbol, baseUnit: Symbol["ast"] | undefined, baseName: string): Fix | undefined {
  const [mine, theirs] = [own.ast as VarDecl, base.ast as VarDecl]
  if (own.uri !== ctx.uri || mine.kind !== "var_decl" || theirs.kind !== "var_decl" || mine.names.length !== 1) return undefined
  if (theirs.init !== undefined && (theirs.init.kind === "aggregate_init" || theirs.initOp !== undefined)) return undefined
  const inherits = `${renderTypeExpr(theirs.type)}${theirs.init === undefined ? "" : ` := ${exprText(theirs.init)}`}`
  const plain = mine.init === undefined || (mine.init.kind !== "aggregate_init" && mine.initOp === undefined)
  const ownText = `${renderTypeExpr(mine.type)}${mine.init === undefined || mine.init.kind === "aggregate_init" ? "" : ` := ${exprText(mine.init)}`}`
  // …and the base's section the same kind as the redeclaration's: the base's VAR_INPUT inherited for the derived VAR is an
  // input where a local stood (and a CONSTANT or RETAIN one another variable again)
  const sectionsOf = (u: Symbol["ast"] | undefined) => (u !== undefined && "varSections" in u ? u.varSections : [])
  const [ownSection, baseSection] = [sectionOf(sectionsOf(ownUnit), mine), sectionOf(sectionsOf(baseUnit), theirs)]
  const alike =
    plain &&
    ownText.replace(/\s+/g, "").toUpperCase() === inherits.replace(/\s+/g, "").toUpperCase() &&
    ownSection !== undefined &&
    baseSection !== undefined &&
    sameSection(ownSection, baseSection)
  return fixOf(`Remove the redeclaration (inherit ${baseName}.${base.name} : ${inherits})`, [removeConstruct(ctx.source, mine.span.start, mine.span.end)], alike)
}
