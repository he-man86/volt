/**
 * external-global (declarations/) — C0237 + C0236. A `VAR_EXTERNAL` re-declares a global so a POU can reference
 * it; the compiler cross-checks it against the matching `VAR_GLOBAL`:
 *   - C0237 — no `VAR_GLOBAL` of that name exists anywhere (project OR library).
 *   - C0236 — one exists but its type differs from the `VAR_EXTERNAL` declaration.
 *
 * Conservative (zero-FP): C0237 fires only when NO `gvl_var` of the name exists at all. C0236 compares rendered
 * type spellings and fires only against a PROJECT global (library signatures flatten → their types are
 * unreliable) when both types are present and differ. Wording PROVISIONAL (no live recording; zero corpus surface).
 */
import { lookupLocal } from "../../../symbols/index.js"
import { renderTypeExpr } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { isLibrarySymbol, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkExternalGlobal(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    for (const section of unit.varSections) {
      if (section.sectionKind !== "VAR_EXTERNAL") continue
      for (const decl of section.decls) {
        for (const name of decl.names) {
          const globals = lookupLocal(ctx.project, name.text).filter((s) => s.kind === "gvl_var")
          if (globals.length === 0) {
            out.push({ severity: "error", span: name.span, source: SOURCE, code: "external-no-global", message: ctx.messages.externalNoGlobal(name.text) })
            continue
          }
          const projectGlobal = globals.find((s) => !isLibrarySymbol(s))
          if (projectGlobal?.typeExpr === undefined) continue
          if (renderTypeExpr(projectGlobal.typeExpr) !== renderTypeExpr(decl.type))
            out.push({ severity: "error", span: name.span, source: SOURCE, code: "external-type-mismatch", message: ctx.messages.externalTypeMismatch(name.text) })
        }
      }
    }
  }
}
