/**
 * unknown-source (types/). The IDE's error PROPAGATION: once it cannot type an expression it does not fall silent, it
 * carries the hole along and reports what the hole broke. Two shapes, both measured (conformance `cc_unknown_member`,
 * `cc_vg_undeclared`, `deref_on_array_type`, `cc5_at_address_not_direct`, `cc3_multiple_inheritance`,
 * `cc2_indexing_and_arity`, `cc_self_this_in_program`):
 *
 *   - an assignment whose SOURCE has no type →  Cannot convert type 'Unknown type: 'p.nope'' to type 'INT'
 *   - an OPERAND of an operator that has none →  Unknown type: 'two'
 *
 * Zero-FP: the LSP's "unknown" is not the IDE's. It is unknown for two very different reasons — a name that does not
 * RESOLVE (which is the IDE's reason too) and a type the inference merely does not MEET yet (`si AND un`, `MAX(un,
 * sn)`, an untyped integer literal), which the compiler types without trouble. Only the first counts, so this reports
 * where an earlier check already named the resolution failure INSIDE that expression, with one of the codes below —
 * gating on "any diagnostic" instead produced 30 false positives on the arithmetic fixtures alone. It therefore runs
 * LAST, and adds nothing on its own evidence.
 *
 * Deliberately NOT in the set: `array-index-count` and `pointer-index-arity`. `grid[1]` on a 2-D array is a wrong
 * arity, not a lost type, and the IDE carries no hole out of it (`cc2_indexing_and_arity` records the arity errors
 * with no conversion error beside them, while `plain[1]` — indexing a scalar — gets one).
 *
 * CODESYS-only: TwinCAT is unmeasured, and a guess there would be a new false positive.
 */
import { compilerExprText } from "../../expr-echo.js"
import { stmtExprs, walkExpr, walkStatements, type Expr } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { inferExprType, renderType } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

/** The checks whose finding means the expression has NO TYPE, which is the IDE's own reason for a hole. */
const RESOLUTION_FAILURE: ReadonlySet<string> = new Set([
  "unresolved-identifier", "unknown-member", "deref-non-pointer", "indexing-non-array", "this-not-allowed", "super-not-allowed",
])

export function checkUnknownSource(ctx: CheckContext, out: DiagnosticItem[]): void {
  const explained = out.filter((d) => RESOLUTION_FAILURE.has(d.code)).map((d) => d.span)
  /** Only where an earlier check already named the resolution failure — see the header. */
  const isExplained = (e: Expr): boolean => explained.some((s) => s.start >= e.span.start && s.end <= e.span.end)
  const push = (message: string, e: Expr): void => {
    out.push({ severity: "error", span: e.span, source: SOURCE, code: "unknown-source", message })
  }
  // THIS and SUPER where they are not allowed are refused OUTRIGHT, so nothing built on one has a type either —
  // the LSP resolves `THIS^.x` in a PROGRAM to that program's `x`, and the IDE answers `Unknown type: 'THIS^.x'`
  // (conformance `fbcall_this_in_program`). Every other hole is one the inference already sees.
  const refused = out.filter((d) => d.code === "this-not-allowed" || d.code === "super-not-allowed").map((d) => d.span)
  const hole = (e: Expr, scope: Parameters<typeof inferExprType>[1]): boolean =>
    isExplained(e) &&
    (inferExprType(e, scope, ctx.project).kind === "unknown" || refused.some((s) => s.start >= e.span.start && s.end <= e.span.end))

  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind === "assign" && s.op === undefined) {
        const target = inferExprType(s.target, scope, ctx.project)
        // a hole on the LEFT has no "to type" to name, and the IDE reports it as a bare `Unknown type:` instead
        if (target.kind !== "unknown" && !hole(s.target, scope) && hole(s.value, scope))
          push(ctx.messages.cannotConvert(ctx.messages.unknownType(compilerExprText(s.value)), renderType(target)), s.value)
      }
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          if (x.kind !== "binary") return
          for (const operand of [x.left, x.right]) if (hole(operand, scope)) push(ctx.messages.unknownType(compilerExprText(operand)), operand)
        })
    })
  }
}
