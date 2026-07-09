/**
 * non-instantiable (C0177 · declarations/). A variable declared with the type of a FUNCTION POU
 * (`inst : SomeFunction`) — a function is not a type and can't be instantiated.
 *
 * Zero-FP: only a named type that RESOLVES to a project symbol of kind `function` fires; an elementary/DUT/FB
 * type resolves to another kind (or nothing) and is skipped.
 */
import { lookup, scopeForUnit } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkNonInstantiable(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    const scope = scopeForUnit(ctx.project, unit) ?? ctx.project
    for (const section of unit.varSections) {
      for (const decl of section.decls) {
        if (decl.type.kind !== "named_type") continue
        if (lookup(scope, decl.type.name.text)?.symbol.kind !== "function") continue
        out.push({
          severity: "error",
          span: decl.type.span,
          source: SOURCE,
          code: "not-instantiable",
          message: ctx.messages.notInstantiable(decl.type.name.text),
        })
      }
    }
  }
}
