/**
 * inout-own-access (D.2 · oop/) — C0371, a WARNING. A method/action/property accessor that touches its
 * enclosing FB's VAR_IN_OUT parameter. It's one of CODESYS's toggleable compiler warnings (ENABLED by default,
 * and hardly any project disables it — lenze-mid: on, 96 warnings; pro2193 is the rare one that turned it off).
 * So it runs by default; a project that disabled the C0371 warning turns it off via the warning toggle. When on
 * it matches the compiler exactly — verified byte-identical against pro2193's own build with the warning enabled
 * (0 gaps, property accessors included).
 *
 * NOT the FB's own main body (VAR_IN_OUT lives there — normal), and NOT external instance access (`inst.io`
 * from another POU — that's C0178 `inout-external-access`, an error). Only a member scope of the SAME FB.
 *
 * Sibling `inout-external-access` (C0178) owns the external-instance case; this owns the own-member-scope case.
 * The two never overlap (that check requires a non-THIS FB-typed base; this requires a bare/own reference).
 */
import { walkAllExprs, type IdentExpr } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { bodyContext, MAIN_BODY } from "./body-context.js"
import { resolveMemberChain } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkInoutOwnAccess(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { unit, body, scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    const context = bodyContext(scope, unit, body)
    if (context === MAIN_BODY) continue // the FB's own body — VAR_IN_OUT lives there, which is normal
    // A member name and a call argument's PARAMETER name are not references to anything in this scope. The parameter
    // was counted, so `F(book := book)` warned TWICE for one access (conformance `xo3_inout_chain_four_deep`).
    const notReferences = new Set<IdentExpr>()
    walkAllExprs(statements, (e) => {
      if (e.kind === "member") notReferences.add(e.member)
      if (e.kind === "call") for (const a of e.args) if (a.param !== undefined) notReferences.add(a.param)
    })
    walkAllExprs(statements, (e) => {
      if (e.kind !== "ident_expr" || notReferences.has(e)) return
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
