/**
 * inheritance (oop/) — resolution + structural checks on an FB's inheritance clauses:
 *   C0091 circular-inheritance — `EXTENDS` names the FB itself (a direct cycle).
 *   C0090 base-class-not-found  — `EXTENDS <name>` where `<name>` resolves to no definition.
 *   C0086 interface-not-found   — `IMPLEMENTS <name>` where `<name>` resolves to no definition.
 *
 * C0090/C0086 reuse the SAME `nameResolves` oracle as `unresolved-identifier`, so the library
 * floor is shared by construction: a base/interface a referenced library provides (namespace root, catalog
 * built-in, or a symbol in scope) resolves and is skipped — only a name that resolves NOWHERE fires. The
 * self-cycle (C0091) is flagged before the not-found check so `EXTENDS FB` on `FB` reports the cycle, not a
 * spurious not-found.
 */
import { lookup, scopeForUnit } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { isLibrarySymbol, SOURCE, type DiagnosticItem } from "../_shared.js"
import { nameResolves } from "../names/_identifier-resolution.js"

export function checkInheritance(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "function_block") continue
    // A library-provided FB's own EXTENDS/IMPLEMENTS is the library's concern — its base may be another
    // library-internal type `nameResolves` can't see. Only user-project FBs are checked (zero-FP).
    const sym = lookup(ctx.project, unit.name.text)?.symbol
    if (sym !== undefined && isLibrarySymbol(sym)) continue
    const scope = scopeForUnit(ctx.project, unit) ?? ctx.project
    if (unit.extends !== undefined) {
      if (unit.extends.text === unit.name.text) {
        out.push({
          severity: "error",
          span: unit.extends.span,
          source: SOURCE,
          code: "circular-inheritance",
          message: ctx.messages.circularInheritance(`${unit.name.text} -> ${unit.name.text}`),
        })
      } else if (!nameResolves(unit.extends.text, scope, ctx.project, ctx.references)) {
        out.push({
          severity: "error",
          span: unit.extends.span,
          source: SOURCE,
          code: "base-class-not-found",
          message: ctx.messages.baseClassNotFound(unit.extends.text),
        })
      }
    }
    for (const iface of unit.implements ?? []) {
      if (!nameResolves(iface.text, scope, ctx.project, ctx.references))
        out.push({
          severity: "error",
          span: iface.span,
          source: SOURCE,
          code: "interface-not-found",
          message: ctx.messages.interfaceNotFound(iface.text),
        })
    }
  }
}
