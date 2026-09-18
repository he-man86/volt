/**
 * unary-operand (types/). A unary operator does not merely fail on a type it cannot use — it CONVERTS the operand
 * first, and reports the conversion. `inferExprType` knows what each one produces (`arith.ts` `checkedNegationType`
 * for `-`, the NOT branch in `infer.ts`); this is the other half, the operand's own trip into that type.
 *
 * Measured one operand type at a time on CODESYS 3.5.21.40, 2026-09-18 — see `fixtures/unary-operand.ts`, whose
 * probes assign into a deliberately wrong destination so the compiler has to name every type it touched:
 *
 *   -aTime    Cannot convert type 'TIME' to type 'DINT'                 (and LTIME -> LINT, DATE/TOD/DT -> DINT)
 *   -aString  Cannot convert type 'STRING' to type 'INT'                (and WSTRING -> INT)
 *   -aBool    nothing — a BOOL converts to INT silently
 *   -anInt    nothing — every integer, bit string and real is already fine
 *   NOT aReal Cannot convert type 'REAL' to type 'ANY_BIT'
 *   NOT aStr  Cannot convert type 'STRING' to type 'ANY_BIT'            (and WSTRING)
 *   NOT aTime nothing beyond the UDINT it produces — a duration IS a bit pattern to this operator
 *
 * The asymmetry is the measurement's, not a simplification: `-` names the concrete type it wanted and `NOT` names the
 * generic `ANY_BIT`, and a TIME is acceptable to one and not the other. CODESYS-only; TwinCAT is unmeasured.
 */
import { stmtExprs, walkExpr, walkStatements } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { elemOf, inferExprType } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { compilerTypeName } from "../../messages.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

/** Families `-` will not convert silently. BOOL is absent on purpose: it is measured to convert without a word. */
const MINUS_REJECTS: ReadonlySet<string> = new Set(["time", "date", "string"])
/** Families `NOT` will not take. A duration is absent: `NOT aTime` is a UDINT and no complaint. */
const NOT_REJECTS: ReadonlySet<string> = new Set(["real", "string"])

export function checkUnaryOperand(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project))
    walkStatements(statements, (s) => {
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          if (x.kind !== "unary" || (x.op !== "-" && x.op !== "NOT")) return
          const operand = inferExprType(x.operand, scope, ctx.project)
          const elem = elemOf(operand)
          if (elem === undefined) return // unresolved or composite → skip (zero-FP)
          const rejects = x.op === "-" ? MINUS_REJECTS : NOT_REJECTS
          if (!rejects.has(elem.family)) return
          // `-` names what it wanted, which is whatever the expression's own type came out as; `NOT` names ANY_BIT.
          const target = x.op === "NOT" ? "ANY_BIT" : compilerTypeName(inferExprType(x, scope, ctx.project))
          out.push({
            severity: "error",
            span: x.span,
            source: SOURCE,
            code: "unary-operand-type",
            message: ctx.messages.cannotConvert(compilerTypeName(operand), target),
          })
        })
    })
}
