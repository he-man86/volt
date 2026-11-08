/**
 * bit-access checks (types/) on dot-bit-access `<base>.<N>` (a numeric member is ALWAYS bit access — a struct
 * field can't be named `17`):
 *   C0003 invalid-bit-number — `N` past the bit width of an integer/bit-string variable (`w.17` on a `WORD`).
 *   C0061 bit-access-on-call — bit access on a function-call RESULT (`Test().2`), which is not allowed.
 *   bit-access-non-integer — bit access on an elementary value that is no integer (`r.0`, `r : REAL`): "Biaccess is only
 *         possible on integer types" (`smem_*_bit`, CODESYS 3.5.21.40), beside "'r' is no structured variable".
 *
 * Each reads its base through a REFERENCE TO (`r.17` past a WORD, `smem_reference_word_bit_past`). Zero-FP: C0003 fires
 * only on an integer/bit-string base with a known width and `N >= bits`; C0061 on a `call` base. A struct or an
 * unresolved base is a different error → skipped.
 */
import { inTypeGroup, memberBaseType } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { forEachExpr } from "../../../frontend/symbols/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkBitNumber(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e, scope) => {
    if (e.kind !== "member" || !/^\d+$/.test(e.member.name)) return
    if (e.base.kind === "call") {
      emit(out, e.span, "bit-access-on-call", ctx.messages.bitAccessOnCall()) // C0061
      return
    }
    const base = memberBaseType(e, scope, ctx.project)
    if (base.kind !== "elementary") return
    if (base.elem.family !== "int" && base.elem.family !== "bitstring") {
      emit(out, e.span, "bit-access-non-integer", ctx.messages.bitAccessNonInteger())
      return
    }
    if (!inTypeGroup("ANY_INT", base.elem)) return
    if (Number(e.member.name) < base.elem.bits) return // a valid bit index
    emit(
      out,
      e.member.span,
      "invalid-bit-number",
      ctx.messages.invalidBitNumber(e.member.name, ctx.source.slice(e.base.span.start, e.base.span.end)),
    )
  })
}
