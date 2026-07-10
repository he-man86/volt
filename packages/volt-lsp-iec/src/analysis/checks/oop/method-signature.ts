/**
 * method-signature (oop/) — an overriding method whose signature doesn't match the one it overrides:
 *   C0089 — an FB method vs the INTERFACE method it implements ("… of interface '<I>' does not match …").
 *   C0094 / C0568 — an FB method vs the BASE FB method it overrides ("… the overridden … of base '<B>' …").
 *
 * A method (folded after its FB) is registered as a `method` symbol on the FB scope, carrying its `Method` AST;
 * interface methods are `interface_method` symbols on the interface scope. Both expose `varSections`, so we
 * compare the OVERRIDING pair only when both sides exist (a missing method is C0087's job, not ours).
 *
 * Zero-FP subset: we compare only the per-section PARAMETER COUNTS (VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT). A
 * legal override must have an identical parameter list, hence identical counts, so a count delta is an
 * unambiguous mismatch; a same-count/different-type mismatch is (deliberately) not flagged yet. Library
 * bases/interfaces (whose members we can't fully see) are skipped, as are abstract/unresolved cases.
 */
import { lookup, scopeForUnit, findScopeByName, type Scope, type Symbol } from "../../../symbols/index.js"
import type { Method, InterfaceMethod, VarSection } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { isLibrarySymbol, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkMethodSignatures(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "function_block") continue
    const fbSym = lookup(ctx.project, unit.name.text)?.symbol
    if (fbSym !== undefined && isLibrarySymbol(fbSym)) continue // a library FB's overrides are the library's concern
    const fbScope = scopeForUnit(ctx.project, unit)
    if (fbScope === undefined) continue
    const own = ownMethods(fbScope)
    if (own.size === 0) continue

    // C0089 — vs each implemented interface's methods.
    for (const ifaceName of unit.implements ?? []) {
      if (isLibraryName(ctx, ifaceName.text)) continue
      const ifaceScope = findScopeByName(ctx.project, ifaceName.text)
      if (ifaceScope === undefined || ifaceScope.kind !== "interface") continue
      for (const im of methodSymbols(ifaceScope, "interface_method")) {
        const mine = own.get(im.name.toLowerCase())
        if (mine === undefined) continue // not implemented here → C0087's concern
        if (!countsMatch(mine.varSections, (im.ast as InterfaceMethod).varSections))
          out.push(diag(mine, "override-mismatch-interface", ctx.messages.overrideMismatchInterface(im.name, ifaceName.text)))
      }
    }

    // C0094 / C0568 — vs the base FB's methods.
    if (unit.extends !== undefined && !isLibraryName(ctx, unit.extends.text)) {
      const baseScope = findScopeByName(ctx.project, unit.extends.text)
      if (baseScope !== undefined && baseScope.kind === "pou")
        for (const bm of methodSymbols(baseScope, "method")) {
          const mine = own.get(bm.name.toLowerCase())
          if (mine === undefined) continue
          if (!countsMatch(mine.varSections, (bm.ast as Method).varSections))
            out.push(diag(mine, "override-mismatch-base", ctx.messages.overrideMismatchBase(bm.name, unit.extends.text)))
        }
    }
  }
}

/** The FB's own methods (folded `METHOD` units → `method` symbols on the FB scope), by lowercased name. */
function ownMethods(fbScope: Scope): Map<string, Method> {
  const map = new Map<string, Method>()
  for (const syms of fbScope.symbols.values())
    for (const s of syms) if (s.kind === "method") map.set(s.name.toLowerCase(), s.ast as Method)
  return map
}

function methodSymbols(scope: Scope, kind: "method" | "interface_method"): Symbol[] {
  const out: Symbol[] = []
  for (const syms of scope.symbols.values()) for (const s of syms) if (s.kind === kind) out.push(s)
  return out
}

const isLibraryName = (ctx: CheckContext, name: string): boolean => {
  const s = lookup(ctx.project, name)?.symbol
  return s !== undefined && isLibrarySymbol(s)
}

/** VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT parameter counts match between two method signatures. */
function countsMatch(a: readonly VarSection[], b: readonly VarSection[]): boolean {
  const c = counts(a)
  const d = counts(b)
  return c[0] === d[0] && c[1] === d[1] && c[2] === d[2]
}
function counts(sections: readonly VarSection[]): [number, number, number] {
  let vin = 0
  let vout = 0
  let vinout = 0
  for (const s of sections) {
    const n = s.decls.reduce((acc, d) => acc + d.names.length, 0)
    if (s.sectionKind === "VAR_INPUT") vin += n
    else if (s.sectionKind === "VAR_OUTPUT") vout += n
    else if (s.sectionKind === "VAR_IN_OUT") vinout += n
  }
  return [vin, vout, vinout]
}

const diag = (m: Method, code: string, message: string): DiagnosticItem => ({
  severity: "error",
  span: m.name.span,
  source: SOURCE,
  code,
  message,
})
