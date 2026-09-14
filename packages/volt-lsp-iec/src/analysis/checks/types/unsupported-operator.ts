/**
 * unsupported-operator (types/). Two operators the LSP's grammar accepts are not operators in CODESYS at all — each is
 * a parse error there, `';' expected instead of '<op>'` then `Unexpected token '<op>' found` (recorded live):
 *   - `**` — `x := 2.0 ** 3.0` (conformance `cc_power_operator`); EXPT is the only power;
 *   - `&`  — `c := a & b` (conformance `cc_fp_op_ampersand`); AND is the boolean/bitwise and.
 *
 * Why nothing caught them: both entered the expression grammar from the IEC 61131-3 standard, never from a compiler,
 * and no fixture used either — the zero-false-positive gate cannot see a MISS, and no real project contains them.
 * `**` surfaced through the transpiler's execution oracle; `&` through the operator-coverage test
 * (`test/conformance/coverage.test.ts`) the moment every grammar operator was required to have a fixture.
 *
 * CODESYS-only: TwinCAT is unmeasured and may accept either — a guess there would be a new false positive.
 */
import { stmtExprs, walkExpr, walkStatements } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

const UNSUPPORTED: ReadonlySet<string> = new Set(["**", "&"])

export function checkUnsupportedOperator(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { statements } of bodies(ctx.parseResult.units, ctx.project))
    walkStatements(statements, (s) => {
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          if (x.kind !== "binary" || !UNSUPPORTED.has(x.op)) return
          for (const message of [ctx.messages.semicolonExpectedInsteadOf(x.op), ctx.messages.unexpectedToken(x.op)])
            out.push({ severity: "error", span: x.span, source: SOURCE, code: "unsupported-operator", message })
        })
    })
}
