/**
 * inout-own-access (D.2 · oop/) — C0371, a WARNING. A method/action/property accessor that touches its
 * enclosing FB's VAR_IN_OUT parameter. Older CODESYS kept VAR_IN_OUT stack-only (this errored); modern CODESYS
 * stores the reference so the access WORKS — but still emits a warning. Real projects do it heavily (lenze-mid:
 * 96 sites; the corpus: 1300+), and CODESYS warns on every one, so this is a standard warning, not an error.
 *
 * NOT the FB's own main body (VAR_IN_OUT lives there — normal), and NOT external instance access (`inst.io`
 * from another POU — that's C0178 `inout-external-access`, an error). Only a member scope of the SAME FB.
 *
 * Sibling `inout-external-access` (C0178) owns the external-instance case; this owns the own-member-scope case.
 * The two never overlap (that check requires a non-THIS FB-typed base; this requires a bare/own reference).
 */
import { walkAllExprs, type IdentExpr } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { resolveMemberChain } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkInoutOwnAccess(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    if (scope.kind !== "method") continue // method/action/accessor scopes only — never the FB's own body
    const context = scope.name
    const memberNames = new Set<IdentExpr>()
    walkAllExprs(statements, (e) => {
      if (e.kind === "member") memberNames.add(e.member)
    })
    walkAllExprs(statements, (e) => {
      if (e.kind !== "ident_expr" || memberNames.has(e)) return
      const sym = resolveMemberChain(e, scope, ctx.project)
      if (sym?.varSection !== "VAR_IN_OUT" || sym.owner.kind !== "pou") return
      out.push({
        severity: "warning",
        span: e.span,
        source: SOURCE,
        code: "inout-own-access",
        message: ctx.messages.inoutOwnAccess(sym.name, sym.owner.name, context),
      })
    })
  }
}
