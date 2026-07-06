/**
 * narrowing-conversion (D.2 · types/). The one WARNING both compilers emit that the LSP otherwise
 * lacks: an implicit `LREAL`→`REAL` assignment ("possible loss of information"). Oracle-validated on
 * BOTH vendors — only this exact pair is emitted (wider narrowings are added once each is recorded).
 * The vendor-specific capitalization ("Possible"/"possible") comes from `messages`, not an `if` here.
 */
import { parseStatements, walkStatements, type Expr } from "../../../syntax/index.js"
import type { Scope } from "../../../symbols/index.js"
import { inferExprType } from "../../../types/index.js"
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
      const target = elemName(s.target, scope, ctx.project)
      const value = elemName(s.value, scope, ctx.project)
      if (target === "REAL" && value === "LREAL") {
        out.push({
          severity: "warning",
          span: s.target.span,
          source: SOURCE,
          code: "narrowing-conversion",
          message: ctx.messages.narrowing("LREAL", "REAL"),
        })
      }
    })
  }
}

function elemName(expr: Expr, scope: Scope, project: Scope): string | undefined {
  const t = inferExprType(expr, scope, project)
  return t.kind === "elementary" ? t.name : undefined
}
