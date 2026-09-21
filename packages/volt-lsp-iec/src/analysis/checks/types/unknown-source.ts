/**
 * unknown-source (types/). The IDE's error PROPAGATION: once it cannot type an expression it does not fall silent, it
 * carries the hole along and reports what the hole broke. Two shapes, both measured (conformance `cc_unknown_member`,
 * `cc_vg_undeclared`, `deref_on_array_type`, `cc5_at_address_not_direct`, `cc3_multiple_inheritance`,
 * `cc2_indexing_and_arity`, `cc_self_this_in_program`):
 *
 *   - an assignment whose SOURCE has no type →  Cannot convert type 'Unknown type: 'p.nope'' to type 'INT'
 *   - an assignment whose TARGET has none    →  'THIS^.x' is no valid assignment target
 *   - a member read off a BASE that has none →  'THIS^' is no structured variable
 *   - an OPERAND of an operator that has none →  Unknown type: 'two'
 *
 * Zero-FP rests entirely on `analysis/hole` — see it for WHY the LSP's "unknown" is not the IDE's. This check runs
 * LAST and adds nothing on its own evidence: every message needs an earlier check to have named the failure.
 *
 * Deliberately not a resolution failure: `array-index-count` and `pointer-index-arity`. `grid[1]` on a 2-D array is a
 * wrong arity, not a lost type, and the IDE carries no hole out of it (`cc2_indexing_and_arity` records the arity
 * errors with no conversion error beside them, while `plain[1]` — indexing a scalar — gets one).
 *
 * Both vendors. It was CODESYS-only on the grounds that "TwinCAT is unmeasured", which the recording then settled:
 * TwinCAT propagates the same way, in its own words. See `targetTypeName` for the one place the two diverge.
 */
import { compilerExprText } from "../../expr-echo.js"
import { isHole, reported } from "../../hole.js"
import { dialectMissingType } from "../../resolution.js"
import { renderTypeExpr, stmtExprs, walkExpr, walkStatements, type Expr } from "../../../syntax/index.js"
import { bodies, forEachDecl, lookup } from "../../../symbols/index.js"
import { inferExprType, renderType } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkUnknownSource(ctx: CheckContext, out: DiagnosticItem[]): void {
  const seen = reported(out)
  /** The type an operation meets at, for the compiler's typed echo of a bare integer literal inside it. */
  const metType = (scope: Parameters<typeof inferExprType>[1]) => (e: Expr): string | undefined => {
    const t = inferExprType(e, scope, ctx.project)
    return t.kind === "elementary" ? t.name : undefined
  }
  const push = (message: string, e: Expr): void => {
    out.push({ severity: "error", span: e.span, source: SOURCE, code: "unknown-source", message })
  }
  const hole = (e: Expr, scope: Parameters<typeof inferExprType>[1]): boolean => isHole(e, scope, ctx.project, seen)

  /**
   * WHAT THE ASSIGNMENT CONVERTS INTO, spelled the way the compiler spells it — or `undefined` when the LSP has no
   * business claiming there is a conversion error at all.
   *
   * <p>This used to be `target.kind !== "unknown"`, and that skip was right for the reason it was written: a type
   * the LSP cannot resolve is usually a library type it cannot SEE, and a message about it would be a guess. It was
   * too coarse by exactly one case. When the vendor cannot resolve the name EITHER, it does not fall silent — it
   * reports the conversion with the unresolved name written out: `out : LDATE` on TwinCAT gives "Cannot convert
   * type 'Unknown type: 'DATE_TO_LDATE(v)'' to type 'LDATE'". Nine `xf_*_to_l*` fixtures had three of their four
   * messages and were missing this one (twincat recording, 2026-09-20; CODESYS resolves LDATE, so it has none).</p>
   *
   * <p>`dialectMissingType` is what keeps the library floor intact: it answers only for ELEMENTARY names the vendor
   * provably lacks, and takes one back the moment the project shims it.</p>
   */
  const targetTypeName = (target: Expr, scope: Parameters<typeof inferExprType>[1]): string | undefined => {
    const t = inferExprType(target, scope, ctx.project)
    if (t.kind !== "unknown") return renderType(t)
    if (target.kind !== "ident_expr") return undefined
    return dialectMissingType(ctx.project, lookup(scope, target.name)?.symbol.typeExpr)
  }

  // A DECLARATION'S INITIALIZER CARRIES A HOLE THE SAME WAY an assignment does — `n : DINT := nope;` is
  // "Identifier 'nope' not defined" AND "Cannot convert type 'Unknown type: 'nope'' to type 'DINT'" on both
  // vendors (`cc_decl_init_unknown_name`, 2026-09-21). There is no TARGET expression to be a hole here: the
  // declared type is written down, so only the source half applies.
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
    const into = renderTypeExpr(decl.type)
    if (hole(decl.init, scope))
      push(ctx.messages.cannotConvert(ctx.messages.unknownType(compilerExprText(decl.init, metType(scope))), into), decl.init)
  }

  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind === "assign" && s.op === undefined) {
        const into = targetTypeName(s.target, scope)
        // a hole on the LEFT is not a conversion at all — there is nothing to convert INTO, and the IDE says so
        if (hole(s.target, scope)) push(ctx.messages.notAssignmentTarget(compilerExprText(s.target, metType(scope))), s.target)
        else if (into !== undefined && hole(s.value, scope))
          push(ctx.messages.cannotConvert(ctx.messages.unknownType(compilerExprText(s.value, metType(scope))), into), s.value)
      }
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          if (x.kind === "member" && hole(x.base, scope)) push(ctx.messages.notStructuredVariable(compilerExprText(x.base, metType(scope))), x.base)
          if (x.kind !== "binary") return
          for (const operand of [x.left, x.right]) if (hole(operand, scope)) push(ctx.messages.unknownType(compilerExprText(operand, metType(scope))), operand)
        })
    })
  }
}
