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
import { isLibrarySymbol, lookup, type Scope, scopeForUnit, type Symbol } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

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
    const inherited = new Map<string, string>()
    // seeded with the FB ITSELF: in a cycle its own scope is reached again as a "base", and every one of its variables
    // was then reported as duplicating itself ("in function block 'FB_C2_circleA' and in base 'FB_C2_circleA'").
    // A cycle is `circular-inheritance`'s to report, and it does.
    const walked = new Set<Scope>([scope])
    for (let base: Scope | undefined = scope.baseScope; base !== undefined && !walked.has(base); base = base.baseScope) {
      walked.add(base)
      const baseSym = lookup(ctx.project, base.name)?.symbol
      if (baseSym !== undefined && isLibrarySymbol(baseSym)) break // library base → vars may be hidden; stop
      for (const [name, syms] of base.symbols) if (isVar(syms) && !inherited.has(name)) inherited.set(name, base.name)
    }

    // Flag each own variable whose name is already declared in a base.
    for (const [name, syms] of scope.symbols) {
      const declaredIn = inherited.get(name)
      if (declaredIn === undefined || !isVar(syms)) continue
      const decl = syms.find((s) => s.kind === "var")
      out.push({
        severity: "error",
        span: decl?.span ?? unit.name.span,
        source: SOURCE,
        code: "duplicate-inherited-variable",
        message: ctx.messages.duplicateInheritedVariable(decl?.name ?? name, unit.name.text, declaredIn),
      })
    }
  }
}

const isVar = (syms: readonly Symbol[]): boolean => syms.some((s) => s.kind === "var")
