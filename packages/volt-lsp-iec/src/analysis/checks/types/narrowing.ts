/**
 * implicit-conversion (D.2 · types/). The WARNINGs both compilers emit that a plain assignment otherwise
 * doesn't: an implicit lossy narrowing ("possible loss of information", e.g. `LREAL`→`REAL`) and a same-width
 * signed↔unsigned crossing ("change of sign", e.g. `WORD`→`INT`). Both derive from the ONE `classifyConversion`
 * relation, through the shared rules in `analysis/rules` — this check only walks the places they apply.
 */
import { stmtExprs, walkExpr, walkStatements, type Expr } from "../../../syntax/index.js"
import { bodies, forEachDecl, type Scope } from "../../../symbols/index.js"
import { inferExprType, literalCheckType, resolveTypeExpr } from "../../../types/index.js"
import type { Messages } from "../../messages.js"
import type { CheckContext } from "../../diagnostics.js"
import type { DiagnosticItem } from "../../diagnostic-item.js"
import { conversionArgError, conversionWarning, narrowingPairError } from "../../rules.js"

export function checkNarrowingConversion(ctx: CheckContext, out: DiagnosticItem[]): void {
  // A declaration's untyped integer literal the target cannot hold warns like an assignment (gap 13): `value : INT :=
  // 40000` is "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT'" (conformance `overflow_int_above_max`).
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
    const lhs = resolveTypeExpr(decl.type, ctx.project)
    const literal = literalCheckType(decl.init, lhs)
    const diag = literal === undefined ? undefined : conversionWarning(lhs, literal, decl.init, ctx.messages)
    if (diag !== undefined) out.push(diag)
  }
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind === "assign" && s.op === undefined) {
        const diag = narrowingPairError(s.target, s.value, scope, ctx.project, ctx.messages)
        if (diag !== undefined) out.push(diag)
      }
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          const diag = conversionArgError(x, scope, ctx.project, ctx.messages) ?? negationOperandWarning(x, scope, ctx.project, ctx.messages)
          if (diag !== undefined) out.push(diag)
        })
    })
  }
}

/**
 * The "change of sign" a unary minus puts on an UNSIGNED operand: it negates the value as the signed type of its
 * width, so `-uint` converts UINT → INT first. Measured live (conformance `cc_neg_uint_into_int`, `cc_neg_word_*`,
 * `cc_neg_udint_*`): CODESYS warns "Implicit conversion from unsigned Type 'UINT' to signed Type 'INT' : Possible
 * change of sign" on the operand. An 8-bit unsigned operand widens into INT and stays silent, as recorded — the same
 * `classifyConversion` answer, so no special case.
 */
function negationOperandWarning(x: Expr, scope: Scope, project: Scope, messages: Messages): DiagnosticItem | undefined {
  if (x.kind !== "unary" || x.op !== "-") return undefined
  return conversionWarning(inferExprType(x, scope, project), inferExprType(x.operand, scope, project), x.operand, messages)
}
