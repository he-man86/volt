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

/**
 * The names the compiler refuses OUTRIGHT, so that nothing built on one has a type either, however well the LSP
 * resolves it: THIS/SUPER out of context, and a VAR_EXTERNAL the project has no global for (which is dropped).
 */
const REFUSED_OUTRIGHT: ReadonlySet<string> = new Set([
  "this-not-allowed", "super-not-allowed", "unresolved-identifier", "call-recursion",
])

/** The checks whose finding means the expression has NO TYPE, which is the IDE's own reason for a hole. */
const RESOLUTION_FAILURE: ReadonlySet<string> = new Set([
  "unresolved-identifier", "unknown-member", "deref-non-pointer", "indexing-non-array", "this-not-allowed",
  "super-not-allowed", "call-recursion",
])

export function checkUnknownSource(ctx: CheckContext, out: DiagnosticItem[]): void {
  const explained = out.filter((d) => RESOLUTION_FAILURE.has(d.code)).map((d) => d.span)
  /** Only where an earlier check already named the resolution failure — see the header. */
  const isExplained = (e: Expr): boolean => explained.some((s) => s.start >= e.span.start && s.end <= e.span.end)
  /** The type an operation meets at, for the compiler's typed echo of a bare integer literal inside it. */
  const metType = (scope: Parameters<typeof inferExprType>[1]) => (e: Expr): string | undefined => {
    const t = inferExprType(e, scope, ctx.project)
    return t.kind === "elementary" ? t.name : undefined
  }
  const push = (message: string, e: Expr): void => {
    out.push({ severity: "error", span: e.span, source: SOURCE, code: "unknown-source", message })
  }
  // THIS and SUPER where they are not allowed are refused OUTRIGHT, so nothing built on one has a type either —
  // the LSP resolves `THIS^.x` in a PROGRAM to that program's `x`, and the IDE answers `Unknown type: 'THIS^.x'`
  // (conformance `fbcall_this_in_program`). Every other hole is one the inference already sees.
  const refused = out.filter((d) => REFUSED_OUTRIGHT.has(d.code)).map((d) => d.span)
  const hole = (e: Expr, scope: Parameters<typeof inferExprType>[1]): boolean =>
    isExplained(e) &&
    (inferExprType(e, scope, ctx.project).kind === "unknown" ||
      // For a CALL only the CALLEE counts: the result is the callee's declared return type, which the compiler knows
      // however badly an ARGUMENT resolved (`f(undefinedName)` converts fine) — but a callee it refuses outright, as
      // it refuses a function calling itself, leaves the call with no type (conformance `cc2_call_recursion`).
      refused.some((sp) => {
        const within = e.kind === "call" ? e.callee.span : e.span
        return sp.start >= within.start && sp.end <= within.end
      }))

  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind === "assign" && s.op === undefined) {
        const target = inferExprType(s.target, scope, ctx.project)
        // a hole on the LEFT is not a conversion at all — there is nothing to convert INTO, and the IDE says so
        if (hole(s.target, scope)) push(ctx.messages.notAssignmentTarget(compilerExprText(s.target, metType(scope))), s.target)
        else if (target.kind !== "unknown" && hole(s.value, scope))
          push(ctx.messages.cannotConvert(ctx.messages.unknownType(compilerExprText(s.value, metType(scope))), renderType(target)), s.value)
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
