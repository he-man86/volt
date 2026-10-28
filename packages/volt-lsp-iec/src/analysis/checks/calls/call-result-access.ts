/**
 * call-result-access (calls/ · C0185). CODESYS forbids component access `.`, index access `[]`, or a call `()`
 * directly on the result of a FUNCTION call — the result must be assigned to a helper variable first. Purely
 * structural: a `member`/`index`/`call` node whose base/callee is itself a `call`.
 *
 * A compiler INTRINSIC operator (a `__`-prefixed callee) is refused DIFFERENTLY, and by the PARSER: `__VARINFO(x).size`
 * ends the expression at the `.`, and `.size;` is then left over as a statement of its own (`parse/expression`
 * `isIntrinsicCall`, `op_sys_varinfo`; frontend-conformance 2.8.3 moved it there from here). The rule targets user
 * function/method calls. A nested chain fires once — only the access directly on the call.
 *
 * A BIT access on a call result (`F().0`) is NOT this error: the compiler has its own message for it
 * ("Bit access on function call is not allowed", `bit-access-on-call`) and reports only that one — so reporting
 * both made `cc3_bit_access_and_call_result` say this twice where the IDE says it once.
 */
import type { CheckContext } from "../../pipeline/context.js"
import { forEachExpr } from "../../../frontend/symbols/index.js"
import { boxMember } from "../../../frontend/types/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkCallResultAccess(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e, scope) => {
    const base =
      e.kind === "member" || e.kind === "index" ? e.base : e.kind === "call" ? e.callee : undefined
    if (base?.kind !== "call") return
    // the member closing a network box's call (`<box>.ENO`, `<box>.Q`): the output the box hands on, no access
    if (e.kind === "member" && boxMember(e, scope, ctx.project) !== undefined) return
    // an intrinsic's result: the parser ends the expression at its `.` — an index or a call on it is unmeasured
    if (base.callee.kind === "ident_expr" && base.callee.name.startsWith("__")) return
    if (e.kind === "member" && /^\d+$/.test(e.member.name)) return // a bit access — `bit-access-on-call` owns it
    emit(out, e.span, "call-result-access", ctx.messages.callResultAccess())
  })
}
