/**
 * bit-access checks (types/) on dot-bit-access `<base>.<N>` (a numeric member is ALWAYS bit access — a struct
 * field can't be named `17`):
 *   C0003 invalid-bit-number — `N` past the bit width of an integer/bit-string variable (`w.17` on a `WORD`).
 *   C0061 bit-access-on-call — bit access on a function-call RESULT (`Test().2`), which is not allowed.
 *
 * Zero-FP: C0003 fires only on an integer/bit-string base with a known width and `N >= bits`; C0061 on a `call`
 * base. Other bases (REAL, struct, unresolved) are a different error / undecidable → skipped.
 */
import { inferExprType } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { forEachExpr, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkBitNumber(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e, scope) => {
    if (e.kind !== "member" || !/^\d+$/.test(e.member.name)) return
    if (e.base.kind === "call") {
      out.push({ severity: "error", span: e.span, source: SOURCE, code: "bit-access-on-call", message: ctx.messages.bitAccessOnCall() }) // C0061
      return
    }
    const base = inferExprType(e.base, scope, ctx.project)
    if (base.kind !== "elementary" || (base.elem.family !== "int" && base.elem.family !== "bitstring")) return
    if (Number(e.member.name) < base.elem.bits) return // a valid bit index
    out.push({
      severity: "error",
      span: e.member.span,
      source: SOURCE,
      code: "invalid-bit-number",
      message: ctx.messages.invalidBitNumber(e.member.name, ctx.source.slice(e.base.span.start, e.base.span.end)),
    })
  })
}
