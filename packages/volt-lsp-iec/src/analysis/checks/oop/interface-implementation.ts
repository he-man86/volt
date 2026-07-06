/**
 * missing-interface-implementation (D.2 · oop/). Every FB that `IMPLEMENTS <Iface>` must provide each
 * method/property the interface declares (own or inherited through EXTENDS). Both vendors error
 * "There is no implementation for method '<M>' defined in interface '<I>'".
 *
 * Conservative — skips (zero-FP) when the obligation can't be proven unmet:
 *   - any base in the EXTENDS chain is unresolvable (a library base we can't see) ⇒ it could provide it;
 *   - the FB itself, or any base, is ABSTRACT ⇒ abstract hierarchies declare/defer interface members for
 *     subclasses (and CODESYS never enforces completeness on an abstract-rooted, uninstantiated FB — a
 *     `success:true` build over pro2193's `Conveyor_SingleFB` confirms it, where the whole `Module*` base
 *     chain is abstract). A flat presence-check can't model that, so don't guess.
 * Only the PRESENCE check is ported; per-signature mismatch used LSP-custom wording that never matched.
 */
import { findScopeByName, findScopeForUnit, SOURCE, type DiagnosticItem } from "../_shared.js"
import { lookupLocal, type Scope } from "../../../symbols/index.js"
import type { FunctionBlock } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"

export function checkInterfaceImplementations(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "function_block") continue
    if (unit.abstract === true) continue // an abstract FB may leave interface members abstract/deferred
    const implementsList = unit.implements
    if (implementsList === undefined || implementsList.length === 0) continue
    const fbScope = findScopeForUnit(ctx.project, unit)
    if (fbScope === undefined) continue

    const members = collectProvidedMembers(fbScope, ctx.project)
    if (members.baseUnresolved || members.abstractInChain) continue // unprovable → skip (see header)

    for (const ifaceName of implementsList) {
      const ifaceScope = findScopeByName(ctx.project, ifaceName.text)
      if (ifaceScope === undefined || ifaceScope.kind !== "interface") continue // typo → unresolved handles it
      for (const symbols of ifaceScope.symbols.values()) {
        for (const m of symbols) {
          if (m.kind !== "interface_method" && m.kind !== "interface_property") continue
          if (members.names.has(m.name.toLowerCase())) continue
          out.push({
            severity: "error",
            span: ifaceName.span,
            source: SOURCE,
            code: "missing-interface-implementation",
            message: ctx.messages.missingInterfaceImpl(
              m.kind === "interface_method" ? "method" : "property",
              m.name,
              ifaceName.text,
            ),
          })
        }
      }
    }
  }
}

/** Names the FB provides (own + EXTENDS-inherited), plus whether any base is unresolvable or ABSTRACT. */
function collectProvidedMembers(
  fbScope: Scope,
  project: Scope,
): { names: Set<string>; baseUnresolved: boolean; abstractInChain: boolean } {
  const names = new Set<string>()
  const visited = new Set<string>()
  let abstractInChain = false
  let scope: Scope | undefined = fbScope
  while (scope !== undefined) {
    for (const child of scope.children) {
      if (child.kind === "method" || child.kind === "accessor") names.add(child.name.toLowerCase())
    }
    for (const syms of scope.symbols.values()) {
      for (const s of syms) if (s.kind === "property" || s.kind === "method") names.add(s.name.toLowerCase())
    }
    const ext = scope.extendsName
    if (ext === undefined || visited.has(ext)) break
    visited.add(ext)
    const base = findScopeByName(project, ext)
    if (base === undefined || base.kind !== "pou") return { names, baseUnresolved: true, abstractInChain }
    if ((lookupLocal(project, ext)[0]?.ast as FunctionBlock | undefined)?.abstract === true) abstractInChain = true
    scope = base
  }
  return { names, baseUnresolved: false, abstractInChain }
}
