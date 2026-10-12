/**
 * external-initializer (C0238 · declarations/). A `VAR_EXTERNAL` declaration supplies an initial value — but an
 * external variable takes its value from the matching `VAR_GLOBAL`, so an inline initializer is illegal.
 * CODESYS: "No initial value allowed for VAR_EXTERNAL <name>".
 *
 * Zero-FP: fires only for a `VAR_EXTERNAL` decl that carries an initializer (real code never does — the compiler
 * rejects it), named per variable.
 */
import type { CheckContext } from "../../pipeline/context.js"
import { forEachDecl } from "../../../frontend/symbols/index.js"
import { SOURCE, withFixes, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { removeInitializerFix } from "../../shared/fixes.js"

export function checkExternalInitializer(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { section, decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (section.sectionKind !== "VAR_EXTERNAL") continue
    if (decl.init === undefined) continue
    // its fix: the initial value removed — an external takes its global's (`qf_c0238_remove`)
    const fix = removeInitializerFix(ctx.source, decl, "Remove the initial value")
    for (const name of decl.names)
      out.push(
        withFixes({ severity: "error", span: name.span, source: SOURCE, code: "external-initializer", message: ctx.messages.noInitForExternal(name.text) }, [fix]),
      )
  }
}
