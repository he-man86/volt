/**
 * fb-instantiation (calls/). A function block (C0080) or interface (C0199) invoked by its TYPE name (`FB()`,
 * `ITF()`) instead of through a declared instance — both must be instantiated to be accessed.
 *
 * Zero-FP: fires only when the callee is a bare identifier that resolves to a PROJECT symbol of kind
 * `function_block` / `interface` (the type itself). An instance variable resolves to a `var`/`gvl_var`
 * (skipped), functions/programs to their own kinds (skipped), and a LIBRARY symbol is skipped — a library name
 * can collide with a standard function (e.g. `DELETE`), where the call is the function, not a type invocation.
 */
import { lookup } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { forEachExpr, isLibrarySymbol, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkFbInstantiation(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e, scope) => {
    if (e.kind !== "call" || e.callee.kind !== "ident_expr") return
    const sym = lookup(scope, e.callee.name)?.symbol
    if (sym === undefined || isLibrarySymbol(sym)) return
    if (sym.kind === "function_block")
      out.push({ severity: "error", span: e.callee.span, source: SOURCE, code: "fb-not-instantiated", message: ctx.messages.fbMustBeInstantiated(e.callee.name) }) // C0080
    else if (sym.kind === "interface")
      out.push({ severity: "error", span: e.callee.span, source: SOURCE, code: "interface-not-instantiated", message: ctx.messages.interfaceMustBeInstantiated(e.callee.name) }) // C0199
  })
}
