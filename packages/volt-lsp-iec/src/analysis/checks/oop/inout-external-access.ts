/**
 * inout-external-access (D.2 · oop/) — C0178. An FB's VAR_IN_OUT parameter is a call-bound reference with no
 * storage on the instance, so `inst.in_out` from OUTSIDE the FB is meaningless — CODESYS rejects any external
 * access (read OR write). This owns the whole VAR_IN_OUT case; `external-write` cedes it (its generic "is no
 * input" is for VAR/VAR_STAT/… members). Wording PROVISIONAL until a live recording.
 *
 * Conservative (zero-FP): fires only when the base infers to a project-local FB (library sections flatten →
 * unreliable) and the member resolves to a VAR_IN_OUT; a THIS/SUPER base (the FB's own params) is legal.
 */
import { walkAllExprs, type Expr } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { inferExprType, resolveMemberChain } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { isLibrarySymbol, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkInoutExternalAccess(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkAllExprs(statements, (e) => {
      if (e.kind !== "member" || isInternalBase(e.base)) return
      const baseType = inferExprType(e.base, scope, ctx.project)
      if (baseType.kind !== "function_block") return
      const sym = resolveMemberChain(e, scope, ctx.project)
      if (sym === undefined || isLibrarySymbol(sym) || sym.varSection !== "VAR_IN_OUT") return
      const fbName = baseType.scope?.name ?? baseType.name
      out.push({
        severity: "error",
        span: e.span,
        source: SOURCE,
        code: "inout-no-external-access",
        message: ctx.messages.inoutNoExternalAccess(e.member.name, fbName),
      })
    })
  }
}

/** True when the member base is the enclosing instance (`THIS`/`SUPER`, optionally deref'd) — internal access. */
function isInternalBase(expr: Expr): boolean {
  let e = expr
  if (e.kind === "paren") e = e.inner
  if (e.kind === "deref") e = e.base
  return e.kind === "ident_expr" && (e.name.toUpperCase() === "THIS" || e.name.toUpperCase() === "SUPER")
}
