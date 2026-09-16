/**
 * call-result-access (calls/ · C0185). CODESYS forbids component access `.`, index access `[]`, or a call `()`
 * directly on the result of a FUNCTION call — the result must be assigned to a helper variable first. Purely
 * structural: a `member`/`index`/`call` node whose base/callee is itself a `call`.
 *
 * A compiler INTRINSIC operator (a `__`-prefixed callee) is refused DIFFERENTLY, not accepted: `__VARINFO(x).size`
 * ends the expression at the `.`, and `.size;` is then left over as a statement of its own, which does nothing
 * (conformance `op_sys_varinfo` — the note here used to say CODESYS accepted it, which its own recording disproves).
 * The rest of the rule targets user function/method calls. A nested chain fires once — only the access directly on
 * the call.
 *
 * A BIT access on a call result (`F().0`) is NOT this error: the compiler has its own message for it
 * ("Bit access on function call is not allowed", `bit-access-on-call`) and reports only that one — so reporting
 * both made `cc3_bit_access_and_call_result` say this twice where the IDE says it once.
 */
import type { CheckContext } from "../../diagnostics.js"
import { forEachExpr } from "../../../symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"
import { leftoverStatement } from "../../resync.js"

export function checkCallResultAccess(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e) => {
    const base =
      e.kind === "member" || e.kind === "index" ? e.base : e.kind === "call" ? e.callee : undefined
    if (base?.kind !== "call") return
    if (base.callee.kind === "ident_expr" && base.callee.name.startsWith("__")) {
      if (e.kind !== "member") return
      out.push({
        severity: "error",
        span: e.span,
        source: SOURCE,
        code: "call-result-access",
        message: ctx.messages.semicolonExpectedInsteadOf("."),
      })
      const statement = leftoverStatement(ctx.source, base.span.end)
      if (statement !== undefined)
        out.push({ severity: "warning", span: e.span, source: SOURCE, code: "call-result-access", message: ctx.messages.codeHasNoEffect(statement) })
      return
    }
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
