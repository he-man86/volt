/**
 * loop-exit (D · flow/) — C0266. A `FOR` whose end bound is at/beyond the control variable's TYPE limit can
 * never exit: the counter wraps at the type boundary before the exit test can trip, so the loop is endless.
 * Classic case `FOR b := 0 TO 255` with `b : BYTE` (max 255) — `b > 255` is unreachable.
 *
 * Conservative (zero-FP): fires only when the control variable is an elementary integer/bit-string with a known
 * range, the step folds to a non-zero integer constant, and the end bound folds to a constant at/beyond the
 * range limit in the step's direction. Unknown types, non-constant bounds/steps, and reals are skipped.
 * Wording is PROVISIONAL (harvested from the doc example, no live recording yet).
 */
import { walkStatements } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { constEval, inferExprType } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkLoopExit(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "for" || s.controlVar.kind !== "ident_expr") return
      const ct = inferExprType(s.controlVar, scope, ctx.project)
      if (ct.kind !== "elementary" || ct.elem.range === undefined) return
      const step = s.by === undefined ? 1n : constEval(s.by, scope)
      const to = constEval(s.to, scope)
      if (typeof step !== "bigint" || step === 0n || typeof to !== "bigint") return
      const { min, max } = ct.elem.range
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
