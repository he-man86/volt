/**
 * fb-instantiation (calls/). A function block (C0080) or interface (C0199) reached through its TYPE name instead of
 * through a declared instance — both must be instantiated to be accessed. Invoked directly (`FB()`, `ITF()`) or
 * reached into for a member (`FB.Method()` — conformance `cc2_fb_not_instantiated`).
 *
 * Zero-FP: fires only when the callee is a bare identifier that resolves to a PROJECT symbol of kind
 * `function_block` / `interface` (the type itself). An instance variable resolves to a `var`/`gvl_var`
 * (skipped), functions/programs to their own kinds (skipped), and a LIBRARY symbol is skipped — a library name
 * can collide with a standard function (e.g. `DELETE`), where the call is the function, not a type invocation.
 */
import { forEachExpr, isLibrarySymbol, lookup } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkFbInstantiation(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e, scope) => {
    // the type NAME, whether it is called or merely reached into for a member
    const name = e.kind === "call" && e.callee.kind === "ident_expr" ? e.callee : e.kind === "member" && e.base.kind === "ident_expr" ? e.base : undefined
    if (name === undefined) return
    const sym = lookup(scope, name.name)?.symbol
    if (sym === undefined || isLibrarySymbol(sym)) return
    if (sym.kind === "function_block")
      out.push({ severity: "error", span: name.span, source: SOURCE, code: "fb-not-instantiated", message: ctx.messages.fbMustBeInstantiated(name.name) }) // C0080
    else if (sym.kind === "interface") {
      out.push({ severity: "error", span: name.span, source: SOURCE, code: "interface-not-instantiated", message: ctx.messages.interfaceMustBeInstantiated(name.name) }) // C0199
      // CALLING one says so twice: it must be instantiated, and an interface is not a thing you call at all
      // (conformance `cc5_type_invoked_directly`). Reaching into one for a member says only the first.
      if (e.kind === "call")
        out.push({ severity: "error", span: name.span, source: SOURCE, code: "invalid-call-target", message: ctx.messages.cannotCallObjectOfType("INTERFACE") })
    }
  })
}
