/**
 * narrowing-conversion (D.2 · types/). The one WARNING both compilers emit that the LSP otherwise
 * lacks: an implicit `LREAL`→`REAL` assignment ("possible loss of information"). Oracle-validated on
 * BOTH vendors — only this exact pair is emitted (wider narrowings are added once each is recorded).
 * The vendor-specific capitalization ("Possible"/"possible") comes from `messages`, not an `if` here.
 */
import { parseStatements, walkStatements, type Expr } from "../../../syntax/index.js"
import type { Scope } from "../../../symbols/index.js"
import { inferExprType } from "../../../types/index.js"
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
 * The narrowing-conversion WARNING for one `target := value` pair, or undefined. The ONE home for the rule
 * — the ST assign check and the VG sink check both call it, so the wording stays byte-identical per vendor.
 * Only the oracle-validated `LREAL`→`REAL` pair fires (wider narrowings await their own recording).
 */
export function narrowingPairError(
  target: Expr,
  value: Expr,
  scope: Scope,
  project: Scope,
  messages: Messages,
): DiagnosticItem | undefined {
  if (elemName(target, scope, project) !== "REAL" || elemName(value, scope, project) !== "LREAL") return undefined
  return {
    severity: "warning",
    span: target.span,
    source: SOURCE,
    code: "narrowing-conversion",
    message: messages.narrowing("LREAL", "REAL"),
  }
}

function elemName(expr: Expr, scope: Scope, project: Scope): string | undefined {
  const t = inferExprType(expr, scope, project)
  return t.kind === "elementary" ? t.name : undefined
}
