/**
 * this-super-context (flow/). `THIS` (C0045) and `SUPER` (C0122) referenced in a POU where they have no
 * meaning — a PROGRAM or a FUNCTION (both are instance-less). They are valid only inside a function-block /
 * method / property body.
 *
 * Zero-FP: fires only in a `program`/`function` unit; FB/method/action/property bodies are never flagged.
 */
import { walkAllExprs } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkThisSuperContext(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { unit, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    if (unit.kind !== "program" && unit.kind !== "function") continue
    walkAllExprs(statements, (e) => {
      if (e.kind !== "ident_expr") return
      if (e.name === "THIS")
        out.push({ severity: "error", span: e.span, source: SOURCE, code: "this-not-allowed", message: ctx.messages.thisNotAllowed() })
      else if (e.name === "SUPER")
        out.push({ severity: "error", span: e.span, source: SOURCE, code: "super-not-allowed", message: ctx.messages.superNotAllowed() })
    })
  }
}
