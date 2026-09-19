/**
 * this-super-context (flow/). `THIS` (C0045) and `SUPER` (C0122) referenced in a POU where they have no
 * meaning — a PROGRAM or a FUNCTION (both are instance-less). They are valid only inside a function-block /
 * method / property body.
 *
 * Zero-FP: fires only in a `program`/`function` unit; FB/method/action/property bodies are never flagged.
 *
 * AND `SUPER` IN A FUNCTION BLOCK THAT EXTENDS NOTHING, which is a different error with a different message:
 * "Program name, function or function block instance expected instead of 'SUPER^'" (`refuse_super_without_base`,
 * measured). The compiler does not say "there is no base" — with nothing to extend, `SUPER^` names nothing, so what
 * it complains about is the call position. Gated on the DECLARATION saying nothing about a base, not on the base
 * having resolved: an FB extending a LIBRARY type names one this analysis cannot see, and flagging that would be a
 * false positive.
 */
import { walkAllExprs } from "../../../syntax/index.js"
import { bodies, type Scope } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

/** True when the nearest enclosing POU declares no EXTENDS at all — a method's base is its owner's. */
function baseless(scope: Scope): boolean {
  for (let s: Scope | undefined = scope; s !== undefined; s = s.parent)
    if (s.kind === "pou") return s.extendsName === undefined
  return false
}

export function checkThisSuperContext(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { unit, scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    if (unit.kind !== "program" && unit.kind !== "function") {
      if (!baseless(scope)) continue
      walkAllExprs(statements, (e) => {
        if (e.kind !== "ident_expr" || e.name.toUpperCase() !== "SUPER") return
        out.push({ severity: "error", span: e.span, source: SOURCE, code: "super-without-base", message: ctx.messages.superWithoutBase() })
      })
      continue
    }
    walkAllExprs(statements, (e) => {
      if (e.kind !== "ident_expr") return
      // Case-insensitive, as ST names are: a lower-case `this`/`super` is the same error (conformance `cc_self_this_*`,
      // `cc_self_super_*`). An exact `=== "THIS"` let them through (consolidate-lsp-structure A8).
      const name = e.name.toUpperCase()
      if (name === "THIS")
        out.push({ severity: "error", span: e.span, source: SOURCE, code: "this-not-allowed", message: ctx.messages.thisNotAllowed() })
      else if (name === "SUPER")
        out.push({ severity: "error", span: e.span, source: SOURCE, code: "super-not-allowed", message: ctx.messages.superNotAllowed() })
    })
  }
}
