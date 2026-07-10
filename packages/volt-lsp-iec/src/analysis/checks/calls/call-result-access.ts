/**
 * call-result-access (calls/ · C0185). CODESYS forbids component access `.`, index access `[]`, or a call `()`
 * directly on the result of a FUNCTION call — the result must be assigned to a helper variable first. Purely
 * structural: a `member`/`index`/`call` node whose base/callee is itself a `call`.
 *
 * Excluded — compiler INTRINSIC operators (a `__`-prefixed callee, e.g. `__VARINFO(x).size`), whose result IS a
 * structured value you access directly (CODESYS accepts it, per the `op_sys_varinfo` conformance fixture). The
 * rule targets user function/method calls. A nested chain fires once — only the access directly on the call.
 */
import type { CheckContext } from "../../diagnostics.js"
import { forEachExpr, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkCallResultAccess(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e) => {
    const base =
      e.kind === "member" || e.kind === "index" ? e.base : e.kind === "call" ? e.callee : undefined
    if (base?.kind !== "call") return
    // `__VARINFO(x).size` etc. — an intrinsic operator's result is legitimately accessible; not a function call.
    if (base.callee.kind === "ident_expr" && base.callee.name.startsWith("__")) return
    out.push({
      severity: "error",
      span: e.span,
      source: SOURCE,
      code: "call-result-access",
      message: ctx.messages.callResultAccess(),
    })
  })
}
