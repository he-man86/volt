/**
 * abstract-output-default (oop/ · C0533). A `VAR_OUTPUT` declared with an initializer in an abstract or
 * interface method is a warning: such methods have no body, so the default can never take effect.
 *
 * Zero-FP subset: only INTERFACE methods and methods carrying the explicit `ABSTRACT` keyword are flagged (a
 * concrete method's VAR_OUTPUT default is legitimately used). The implicit-abstract case — a body-less method
 * inside an ABSTRACT FB with no `ABSTRACT` keyword — is deliberately NOT flagged (needs an empty-body heuristic
 * that would risk false positives). Live /build confirmed the wording on the interface-method form.
 */
import type { VarSection } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkAbstractOutputDefault(ctx: CheckContext, out: DiagnosticItem[]): void {
  if (ctx.config.vendor !== "codesys") return // live /build: TwinCAT silently accepts a VAR_OUTPUT default here
  for (const unit of ctx.parseResult.units) {
    if (unit.kind === "interface") {
      for (const m of unit.methods) flagOutputDefaults(m.varSections, ctx, out)
    } else if (unit.kind === "method" && unit.abstract === true) {
      flagOutputDefaults(unit.varSections, ctx, out)
    }
  }
}

function flagOutputDefaults(sections: readonly VarSection[], ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const s of sections) {
    if (s.sectionKind !== "VAR_OUTPUT") continue
    for (const d of s.decls) {
      if (d.init === undefined) continue // no default → nothing to warn about
      out.push({
        severity: "warning",
        span: d.names[0]!.span,
        source: SOURCE,
        code: "abstract-output-default",
        message: ctx.messages.defaultOutputUnused(),
      })
    }
  }
}
