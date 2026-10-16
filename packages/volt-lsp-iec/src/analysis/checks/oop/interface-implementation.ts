/**
 * missing-interface-implementation (D.2 · oop/). Every FB that `IMPLEMENTS <Iface>` must provide each method/property the
 * interface declares, its OWN and the ones it inherits through its EXTENDS list (rule H4): an FB implementing the derived
 * interface without the base interface's method is "There is no implementation for method 'MB' defined in interface
 * '<BASE INTERFACE>'" (`inh_implements_derived_missing_base_method`, both vendors 2026-10-02) — the interface that
 * DECLARES it named. Only the derived interface's own members were asked, so the inherited obligation went unsaid.
 *
 * NOT SAID: a base's ABSTRACT method a concrete FB leaves unimplemented ("There is no implementation for ABSTRACT method
 * 'M' defined in function block '<BASE>'", `inh_abstract_method_not_implemented`, both vendors) — a known divergence: a
 * wire diagnostic needs its CODESYS `Cnnnn`, which the build message does not carry (`corpus/support/diagnostic-codes.ts`).
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
import { emit, type DiagnosticItem, type Fix } from "../../shared/diagnostic-item.js"
import { fixOf, insertText, lineBreakOf } from "../../shared/fixes.js"
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
import { renderTypeExpr, type FunctionBlock, type InterfaceMethod, type InterfaceProperty, type TopLevel, type VarSection } from "../../../frontend/syntax/index.js"
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
            // a PROPERTY is named by its accessor METHODs, as both vendors name it: "There is no implementation for method
            // '__GETLEVEL' defined in interface …" (`rk_interface_property_not_implemented`, 2026-10-11)
            const prop = m.kind === "interface_property" ? (m.ast as InterfaceProperty) : undefined
            const members = prop === undefined ? [m.name] : [...(prop.hasGetter ? [`__GET${m.name}`] : []), ...(prop.hasSetter ? [`__SET${m.name}`] : [])]
            const fix = stubFix(ctx, unit, m.ast as InterfaceMethod | InterfaceProperty)
            for (const member of members)
              emit(
                out,
                ifaceName.span,
                "missing-interface-implementation",
                ctx.messages.missingInterfaceImpl(member, declaring.name),
                "error",
                [fix],
              )
          }
    }
  }
}

/**
 * C0087's fix (design.md §4 F8): "Add METHOD '<name>'" / "Add PROPERTY '<name>'" — a stub with the interface member's
 * signature (its result type and every parameter section; a property's type and the accessors it declares), written after
 * the function block and the members that follow it in its file (`qf_c0087_stub_method`, `_method_sections`,
 * `_stub_property`, `_property_set`). It is the one edit that answers the finding (`preferred`); a body is the user's to
 * write. A parameter with a default value, or a property accessor with sections of its own, is not stubbed (unrecorded).
 */
function stubFix(ctx: CheckContext, fb: FunctionBlock, member: InterfaceMethod | InterfaceProperty): Fix | undefined {
  const br = lineBreakOf(ctx.source)
  let lines: string[]
  if (member.kind === "interface_method") {
    const sections = member.varSections.map((s) => sectionText(s, br))
    if (sections.some((s) => s === undefined)) return undefined
    lines = [`METHOD ${member.name.text}${member.returnType === undefined ? "" : ` : ${renderTypeExpr(member.returnType)}`}`, ...(sections as string[]), "END_METHOD"]
  } else {
    if (member.getterVarSections.length > 0 || member.setterVarSections.length > 0) return undefined
    lines = [
      `PROPERTY ${member.name.text} : ${renderTypeExpr(member.dataType)}`,
      ...(member.hasGetter ? ["GET", "END_GET"] : []),
      ...(member.hasSetter ? ["SET", "END_SET"] : []),
      "END_PROPERTY",
    ]
  }
  const kind = member.kind === "interface_method" ? "METHOD" : "PROPERTY"
  return fixOf(`Add ${kind} '${member.name.text}'`, [insertText(ctx.source, endOfGroup(ctx.source, ctx.parseResult.units, fb), `${br}${br}${lines.join(br)}`)], true)
}

/** A parameter section as a stub writes it — `VAR_INPUT`, a tab-indented line per declaration, `END_VAR` — or undefined
 *  for one a stub does not copy (a declaration with an initial value). */
function sectionText(s: VarSection, br: string): string | undefined {
  if (s.decls.some((d) => d.init !== undefined)) return undefined
  const decls = s.decls.map((d) => `\t${d.names.map((n) => n.text).join(", ")} : ${renderTypeExpr(d.type)};`)
  return [s.sectionKind, ...decls, "END_VAR"].join(br)
}

/** Where a function block's group ends in its file: its own closer, or the last METHOD, PROPERTY or ACTION's after it. */
function endOfGroup(source: string, units: readonly TopLevel[], fb: FunctionBlock): number {
  let end = closerEnd(source, fb.span.end)
  for (let i = units.indexOf(fb) + 1; i < units.length; i++) {
    const u = units[i]!
    if (u.kind !== "method" && u.kind !== "property" && u.kind !== "action") break
    end = closerEnd(source, u.span.end)
  }
  return end
}

/** The end of the `END_*` keyword that closes a unit whose span ends at `end` (a unit's span may stop before it). */
function closerEnd(source: string, end: number): number {
  const m = /^\s*END_[A-Z_]+/i.exec(source.slice(end))
  return m === null ? end : end + m[0].length
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
