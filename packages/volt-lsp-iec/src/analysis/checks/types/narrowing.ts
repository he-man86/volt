/**
 * implicit-conversion (D.2 · types/). The WARNINGs both compilers emit that a plain assignment otherwise
 * doesn't: an implicit lossy narrowing ("possible loss of information", e.g. `LREAL`→`REAL`) and a same-width
 * signed↔unsigned crossing ("change of sign", e.g. `WORD`→`INT`). Both derive from the ONE `classifyConversion`
 * relation — this check only maps the returned kind to a severity + per-vendor wording, it does not re-decide.
 * The vendor-specific capitalization ("Possible"/"possible") comes from `messages`, not an `if` here.
 */
import { parseStatements, walkStatements, type Expr } from "../../../syntax/index.js"
import type { Scope } from "../../../symbols/index.js"
import { classifyConversion, elementaryType, inferExprType, type Type } from "../../../types/index.js"
import type { Messages } from "../../messages.js"
import type { CheckContext } from "../../diagnostics.js"
import { findScopeForUnit, getBody, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkNarrowingConversion(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    const body = getBody(unit)
    if (body === undefined) continue
    const scope = findScopeForUnit(ctx.project, unit)
    if (scope === undefined) continue
    const parsed = parseStatements(body)
    if (!parsed.ok) continue

    walkStatements(parsed.statements, (s) => {
      if (s.kind !== "assign" || s.op !== undefined) return
      const diag = narrowingPairError(s.target, s.value, scope, ctx.project, ctx.messages)
      if (diag !== undefined) out.push(diag)
    })
  }
}

/**
 * The implicit-conversion WARNING for one `target := value` pair, or undefined. The ONE home for the rule —
 * the ST assign check and the VG sink check both call it, so wording stays byte-identical per vendor. Emits for
 * `classifyConversion === "narrow"` (loss) and `=== "sign-change"` (sign); the ERROR kinds are the assignment /
 * conversion-source checks' job. Kept as one function so a site yields exactly one diagnostic.
 */
export function narrowingPairError(
  target: Expr,
  value: Expr,
  scope: Scope,
  project: Scope,
  messages: Messages,
): DiagnosticItem | undefined {
  const lhs = inferExprType(target, scope, project)
  const rhs = inferExprType(value, scope, project)
  const kind = classifyConversion(lhs, rhs)
  if (kind === "narrow") {
    return warn(target, "narrowing-conversion", messages.narrowing(name(rhs), name(lhs)))
  }
  if (kind === "sign-change") {
    return warn(target, "sign-change-conversion", messages.signChange(sign(rhs), name(rhs), sign(lhs), name(lhs)))
  }
  return undefined
}

const warn = (target: Expr, code: string, message: string): DiagnosticItem => ({
  severity: "warning",
  span: target.span,
  source: SOURCE,
  code,
  message,
})

function name(t: Type): string {
  return t.kind === "elementary" ? t.name : ""
}
function sign(t: Type): string {
  return t.kind === "elementary" && elementaryType(t.name)?.signed ? "signed" : "unsigned"
}
