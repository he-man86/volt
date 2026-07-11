/**
 * inout-own-access (D.2 · oop/) — C0371, an OPT-IN WARNING (`lints.inoutOwnAccess`, off by default). A
 * method/action/property accessor that touches its enclosing FB's VAR_IN_OUT parameter. CODESYS warns on
 * this — but ONLY when a per-project compiler option is set: lenze-mid emits 96 of these, pro2193 (same
 * CODESYS version, same access pattern) emits 0. That option is not in the materialized ST, so an always-on
 * check false-positives on an option-off project (175 FPs on pro2193). Hence opt-in; when enabled it matches
 * the compiler exactly (lenze-mid: byte-identical, 0 gaps).
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
  if (!ctx.config.lints.inoutOwnAccess) return // opt-in: per-project option-gated, invisible offline (see header + LintConfig)
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
