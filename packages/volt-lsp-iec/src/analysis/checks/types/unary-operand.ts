/**
 * unary-operand (types/). A unary operator does not merely fail on a type it cannot use — it CONVERTS the operand
 * first, and reports the conversion. `inferExprType` knows what each one produces (`arith.ts` `checkedNegationType`
 * for `-`, the NOT branch in `frontend/types/infer/expr.ts`); this is the other half, the operand's own trip into that type.
 *
 * Measured one operand type at a time on CODESYS 3.5.21.40, 2026-09-18 — see `fixtures/operators/unary-operand.ts`, whose
 * probes assign into a deliberately wrong destination so the compiler has to name every type it touched:
 *
 *   -aTime    Cannot convert type 'TIME' to type 'DINT'                 (and LTIME -> LINT, DATE/TOD/DT -> DINT)
 *   -aString  Cannot convert type 'STRING' to type 'INT'                (and WSTRING -> INT)
 *   -aBool    Cannot convert type 'BOOL' to type 'INT'
 *   -anInt    nothing — every integer, bit string and real is already fine
 *   NOT aReal Cannot convert type 'REAL' to type 'ANY_BIT'
 *   NOT aStr  Cannot convert type 'STRING' to type 'ANY_BIT'            (and WSTRING)
 *   NOT aTime Cannot convert type 'TIME' to type 'UDINT'                (and LTIME -> ULINT, DATE/TOD/DT -> UDINT)
 *   NOT aBool nothing — `NOT BOOL` is BOOL, which is already the type it computes in
 *
 * <p>TWO OF THOSE ROWS SAID "NOTHING" UNTIL 2026-09-21, and they were the summary's error rather than the
 * recording's: `unary_minus_on_bool` has carried "Cannot convert type 'BOOL' to type 'INT'" all along, and
 * `uop_not_time` has carried the TIME one — both were read as the RESULT conversion and the operand half went
 * unnoticed. Four probes close the family properly: `uop_neg_bool` asks minus-on-a-BOOL into a STRING, where the
 * operand message cannot hide behind the result's, and `uop_not_tod`/`_dt`/`_ltime` extend NOT across the rest of
 * the date types. Every one reports, on both vendors, at the width its operand has.</p>
 *
 * <p>So the rule is ONE rule — a unary operator converts its operand into the type it computes in, and says so —
 * and the only asymmetry left is the TARGET it names: `-` and `NOT` both name the concrete integer, except that
 * `NOT` on a REAL or a STRING names the generic `ANY_BIT`, because there is no integer it could produce.</p>
 */
import { stmtExprs, walkExpr, walkStatements } from "../../../frontend/syntax/index.js"
import { bodies } from "../../../frontend/symbols/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import type { DiagnosticItem } from "../../shared/diagnostic-item.js"
import { unaryOperandError } from "../../shared/unary-operand.js"

export function checkUnaryOperand(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project))
    walkStatements(statements, (s) => {
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => unaryOperandError(x, scope, ctx.project, ctx.messages, out))
    })
}
