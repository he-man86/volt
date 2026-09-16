/**
 * call-result-access (calls/ · C0185). CODESYS forbids component access `.`, index access `[]`, or a call `()`
 * directly on the result of a FUNCTION call — the result must be assigned to a helper variable first. Purely
 * structural: a `member`/`index`/`call` node whose base/callee is itself a `call`.
 *
 * Excluded — compiler INTRINSIC operators (a `__`-prefixed callee, e.g. `__VARINFO(x).size`), whose result IS a
 * structured value you access directly (CODESYS accepts it, per the `op_sys_varinfo` conformance fixture). The
 * rule targets user function/method calls. A nested chain fires once — only the access directly on the call.
 *
 * A BIT access on a call result (`F().0`) is NOT this error: the compiler has its own message for it
 * ("Bit access on function call is not allowed", `bit-access-on-call`) and reports only that one — so reporting
 * both made `cc3_bit_access_and_call_result` say this twice where the IDE says it once.
 */
import type { CheckContext } from "../../diagnostics.js"
import { forEachExpr } from "../../../symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkCallResultAccess(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e) => {
    const base =
      e.kind === "member" || e.kind === "index" ? e.base : e.kind === "call" ? e.callee : undefined
    if (base?.kind !== "call") return
    // `__VARINFO(x).size` etc. — an intrinsic operator's result is legitimately accessible; not a function call.
    if (base.callee.kind === "ident_expr" && base.callee.name.startsWith("__")) return
    if (e.kind === "member" && /^\d+$/.test(e.member.name)) return // a bit access — `bit-access-on-call` owns it
    out.push({
      severity: "error",
      span: e.span,
      source: SOURCE,
      code: "call-result-access",
      message: ctx.messages.callResultAccess(),
    })
  })
}
