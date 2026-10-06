/**
 * loop-exit (D · flow/) — C0266. A `FOR` whose end bound is at/beyond the control variable's TYPE limit can never
 * exit: the counter wraps at the type boundary before the exit test can trip, so the loop is endless. One bound beyond
 * the limit is a conversion into the counter's type instead (`narrowing`) and no endless loop on either vendor: an
 * untyped literal the same-width unsigned type holds over a signed counter (`lt_literal_for_bounds_out_of_range`,
 * 2026-10-03).
 * Classic case `FOR b := 0 TO 255` with `b : BYTE` (max 255) — `b > 255` is unreachable.
 *
 * Conservative (zero-FP): fires only when the control variable is an elementary integer/bit-string with a known
 * range, the step folds to a non-zero integer constant, and the end bound folds to a constant at/beyond the range limit
 * in the step's direction. Unknown types, non-constant bounds/steps, and reals are skipped.
 */
import { walkStatements } from "../../../frontend/syntax/index.js"
import { bodies } from "../../../frontend/symbols/index.js"
import { constEval, inferExprType, literalContextConversion } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { isRefusedCounter } from "../../shared/rules.js"

export function checkLoopExit(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "for" || s.controlVar.kind !== "ident_expr") return
      const ct = inferExprType(s.controlVar, scope, ctx.project)
      // a counter the FOR refuses (`for-control-type`: BOOL, REAL) is no loop to judge — the vendor says only that
      if (ct.kind !== "elementary" || ct.elem.range === undefined || isRefusedCounter(ct.elem.family)) return
      const step = s.by === undefined ? 1n : constEval(s.by, scope)
      const to = constEval(s.to, scope)
      if (typeof step !== "bigint" || step === 0n || typeof to !== "bigint") return
      const { min, max } = ct.elem.range
      // A bound BEYOND the limit that is the measured literal conversion into the counter's type (USINT → SINT for
      // `FOR si := 1 TO 200`, `literalContextConversion`) earns only that warning (`narrowing`;
      // `lt_literal_for_bounds_out_of_range`, both vendors 2026-10-03). Any other bound at or beyond the limit — a wider
      // literal, a typed constant — keeps C0266 until a recording says otherwise.
      if (literalContextConversion(s.to, ct) !== undefined) return
      const cond =
        step > 0n && to >= max ? `${s.controlVar.name} > ${to}` : step < 0n && to <= min ? `${s.controlVar.name} < ${to}` : undefined
      if (cond === undefined) return
      out.push({
        severity: "error",
        span: s.span,
        source: SOURCE,
        code: "loop-exit-constant",
        message: ctx.messages.loopExitConstantFalse(cond),
      })
    })
  }
}
