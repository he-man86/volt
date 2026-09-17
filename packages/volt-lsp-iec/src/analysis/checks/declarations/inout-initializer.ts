/**
 * inout-initializer (C0441 · declarations/). A VAR_IN_OUT parameter is a reference with no compile-time
 * storage, so referencing one in ANOTHER declaration's initializer (`b : BOOL := a[i]` where `a` is
 * VAR_IN_OUT) accesses it before it is bound. CODESYS: "Access to uninitialized VAR_IN_OUT variable".
 *
 * Zero-FP: fires only when a scalar-`Expr` initializer references a name declared VAR_IN_OUT in the SAME unit
 * (aggregate initializers are skipped conservatively). A VAR_IN_OUT used in a statement body — its legitimate
 * use — is never touched (only declaration initializers are scanned).
 *
 * The reverse shape too: a VAR_IN_OUT given an initializer OF ITS OWN (`seeded : INT := 3`). There is nothing to
 * initialize — the parameter is bound at the call — so CODESYS reads the `:=` as that binding and answers about
 * what is on the right of it: "'3' is no valid assignment target" (conformance `cc4_inout_in_initializer`).
 */
import { walkExpr } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkInoutInitializer(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    const inout = new Set<string>()
    for (const s of unit.varSections)
      if (s.sectionKind === "VAR_IN_OUT") for (const d of s.decls) for (const n of d.names) inout.add(n.text.toLowerCase())
    if (inout.size === 0) continue
    for (const s of unit.varSections)
      for (const d of s.decls) {
        if (d.init === undefined || d.init.kind === "aggregate_init") continue
        if (s.sectionKind === "VAR_IN_OUT")
          out.push({
            severity: "error",
            span: d.init.span,
            source: SOURCE,
            // `not-assignment-target`, not this file's code: that is the rule being reported, and this code's
            // configured severity is a warning, which silently downgraded the error.
            code: "not-assignment-target",
            message: ctx.messages.notAssignmentTarget(ctx.source.slice(d.init.span.start, d.init.span.end)),
          })
        walkExpr(d.init, (e) => {
          if (e.kind === "ident_expr" && inout.has(e.name.toLowerCase()))
            out.push({
              severity: "error",
              span: e.span,
              source: SOURCE,
              code: "inout-in-initializer",
              message: ctx.messages.inoutInInitializer(),
            })
        })
      }
  }
}
