/**
 * inout-external-access (D.2 · oop/) — C0178. An FB's VAR_IN_OUT parameter is a call-bound reference with no
 * storage on the instance, so `inst.in_out` from OUTSIDE the FB (read or write) is meaningless — CODESYS
 * rejects it. This owns the whole VAR_IN_OUT-member case; `external-write` cedes it (its generic "is no input"
 * is for VAR/VAR_STAT/… members).
 *
 * NOT here: C0371 (a method accessing its OWN FB's VAR_IN_OUT) — that is `inout-own-access`, a toggleable
 * warning (default on), which owns the own-member-scope case. The two never overlap.
 *
 * Conservative (zero-FP): fires only when the base infers to a project-local FB (library sections flatten →
 * unreliable) and the member resolves to a VAR_IN_OUT; a THIS/SUPER base (the FB's own params) is legal.
 */
import { isSelfRef, walkAllExprs } from "../../../syntax/index.js"
import { bodies, isLibrarySymbol } from "../../../symbols/index.js"
import { inferExprType, resolveMemberChain } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkInoutExternalAccess(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkAllExprs(statements, (e) => {
      if (e.kind !== "member" || isSelfRef(e.base)) return
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
        // the IDE prints the FB UPPER-cased here, whatever the declaration wrote (conformance
        // `cc5_inout_external_access`: "… parameter 'shared' of 'FB_C5_HOLDER'.")
        message: ctx.messages.inoutNoExternalAccess(e.member.name, fbName.toUpperCase()),
      })
    })
  }
}

