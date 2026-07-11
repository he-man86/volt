/**
 * external-initializer (C0238 · declarations/). A `VAR_EXTERNAL` declaration supplies an initial value — but an
 * external variable takes its value from the matching `VAR_GLOBAL`, so an inline initializer is illegal.
 * CODESYS: "No initial value allowed for VAR_EXTERNAL <name>".
 *
 * Zero-FP: fires only for a `VAR_EXTERNAL` decl that carries an initializer (real code never does — the compiler
 * rejects it), named per variable.
 */
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkExternalInitializer(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    for (const section of unit.varSections) {
      if (section.sectionKind !== "VAR_EXTERNAL") continue
      for (const decl of section.decls) {
        if (decl.init === undefined) continue
        for (const name of decl.names)
          out.push({
            severity: "error",
            span: name.span,
            source: SOURCE,
            code: "external-initializer",
            message: ctx.messages.noInitForExternal(name.text),
          })
      }
    }
  }
}
