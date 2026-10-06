/**
 * missing-interface-implementation (D.2 · oop/). Every FB that `IMPLEMENTS <Iface>` must provide each method/property the
 * interface declares, its OWN and the ones it inherits through its EXTENDS list (rule H4): an FB implementing the derived
 * interface without the base interface's method is "There is no implementation for method 'MB' defined in interface
 * '<BASE INTERFACE>'" (`inh_implements_derived_missing_base_method`, both vendors 2026-10-02) — the interface that
 * DECLARES it named. Only the derived interface's own members were asked, so the inherited obligation went unsaid.
 *
 * NOT SAID: a base's ABSTRACT method a concrete FB leaves unimplemented ("There is no implementation for ABSTRACT method
 * 'M' defined in function block '<BASE>'", `inh_abstract_method_not_implemented`, both vendors) — a known divergence: a
 * wire diagnostic needs its CODESYS `Cnnnn`, which the build message does not carry (`server/diagnostic-codes.ts`).
 *
 * ONLY AN FB THE VENDOR COMPILES owes anything (`analysis/shared/compiled.ts`): an FB nothing reaches builds without the method
 * its derived interface inherits (`inh_implements_derived_missing_base_method_uninstanced`, both vendors 2026-10-02) — the
 * same set `method-signature` answers for.
 *
 * It walks the bases the symbol table LINKED (`extends.ts` `ancestry`), never a name lookup (rule H8). Conservative —
 * skips (zero-FP) when the obligation can't be proven unmet:
 *   - any base in the EXTENDS chain is unresolvable, or a library's (a lossy materialization) ⇒ it could provide it;
 *   - for an interface: the FB itself, or any base, is ABSTRACT ⇒ abstract hierarchies declare/defer interface members
 *     for subclasses (and CODESYS never enforces completeness on an abstract-rooted, uninstantiated FB — a
 *     `success:true` build over pro2193's `Conveyor_SingleFB` confirms it, where the whole `Module*` base chain is
 *     abstract). A flat presence-check can't model that, so don't guess.
 * Only the PRESENCE check is ported; per-signature mismatch is `method-signature`'s.
 */
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import {
  ancestry,
  findScopeByName,
  hasUnresolvedBase,
  isLibrarySymbol,
  lookupLocal,
  scopeForUnit,
  scopeUri,
  type Scope,
} from "../../../frontend/symbols/index.js"
import type { FunctionBlock, InterfaceProperty } from "../../../frontend/syntax/index.js"
import { compiledFbs } from "../../shared/compiled.js"
import type { CheckContext } from "../../pipeline/context.js"

export function checkInterfaceImplementations(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "function_block") continue
    if (unit.modifiers.includes("ABSTRACT")) continue // an abstract FB may leave interface members abstract/deferred
    const fbScope = scopeForUnit(ctx.project, unit)
    if (fbScope === undefined || !compiledFbs(ctx.project).has(fbScope)) continue // not compiled → not checked (see header)
    if (hasUnresolvedBase(fbScope)) continue // unprovable → skip (see header)
    const chain = ancestry(fbScope)
    if (chain.slice(1).some((b) => isLibraryScope(ctx.project, b))) continue

    const implementsList = unit.implements
    if (implementsList === undefined || implementsList.length === 0) continue
    if (chain.slice(1).some((b) => isAbstractFb(ctx.project, b))) continue // unprovable → skip (see header)
    const provided = providedNames(chain)
    for (const ifaceName of implementsList) {
      const ifaceScope = findScopeByName(ctx.project, ifaceName.text, scopeUri(fbScope))
      if (ifaceScope === undefined || ifaceScope.kind !== "interface") continue // typo → unresolved handles it
      if (hasUnresolvedBase(ifaceScope)) continue // a base interface nothing declares could declare anything
      for (const declaring of ancestry(ifaceScope))
        for (const symbols of declaring.symbols.values())
          for (const m of symbols) {
            if (m.kind !== "interface_method" && m.kind !== "interface_property") continue
            // a property declaring neither accessor declares nothing to implement (`oopb_itf_property_missing`, both
            // vendors 2026-10-06: they warn about the interface and never ask the FB)
            if (m.kind === "interface_property" && !(m.ast as InterfaceProperty).hasGetter && !(m.ast as InterfaceProperty).hasSetter) continue
            if (provided.has(m.name.toLowerCase())) continue
            out.push({
              severity: "error",
              span: ifaceName.span,
              source: SOURCE,
              code: "missing-interface-implementation",
              message: ctx.messages.missingInterfaceImpl(m.kind === "interface_method" ? "method" : "property", m.name, declaring.name),
            })
          }
    }
  }
}

/** Names the FB's chain provides (own + EXTENDS-inherited methods and properties). */
function providedNames(chain: readonly Scope[]): Set<string> {
  const names = new Set<string>()
  for (const scope of chain) {
    for (const child of scope.children) if (child.kind === "method" || child.kind === "accessor") names.add(child.name.toLowerCase())
    for (const syms of scope.symbols.values()) for (const s of syms) if (s.kind === "property" || s.kind === "method") names.add(s.name.toLowerCase())
  }
  return names
}

/** The FB symbol a top-level POU scope declares. */
const fbSymbolOf = (project: Scope, s: Scope) => lookupLocal(project, s.name).find((x) => x.kind === "function_block" && (x.ast as FunctionBlock).span === s.span)

const isAbstractFb = (project: Scope, s: Scope): boolean =>
  (fbSymbolOf(project, s)?.ast as FunctionBlock | undefined)?.modifiers.includes("ABSTRACT") === true

const isLibraryScope = (project: Scope, s: Scope): boolean => {
  const sym = fbSymbolOf(project, s)
  return sym !== undefined && isLibrarySymbol(sym)
}
