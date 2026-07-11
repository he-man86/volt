/**
 * inout-own-access (D.2 · oop/) — C0371, a WARNING (`lints.inoutOwnAccess`, ON by default). A
 * method/action/property accessor that touches its enclosing FB's VAR_IN_OUT parameter. CODESYS controls this
 * with a per-project compiler-warning toggle that isn't in the materialized ST — but it's ENABLED by default
 * and hardly any project disables it (lenze-mid: on, 96 warnings; pro2193 is the rare one that turned it off).
 * So default ON to match the common case; a project that disabled the warning sets the lint false. When on it
 * matches the compiler exactly — verified byte-identical against pro2193's own build with the warning enabled
 * (0 gaps, property accessors included).
 *
 * NOT the FB's own main body (VAR_IN_OUT lives there — normal), and NOT external instance access (`inst.io`
 * from another POU — that's C0178 `inout-external-access`, an error). Only a member scope of the SAME FB.
 *
 * Sibling `inout-external-access` (C0178) owns the external-instance case; this owns the own-member-scope case.
 * The two never overlap (that check requires a non-THIS FB-typed base; this requires a bare/own reference).
 */
import { walkAllExprs, type BodySpan, type Property, type TopLevel, type IdentExpr } from "../../../syntax/index.js"
import { bodies, type Scope } from "../../../symbols/index.js"
import { resolveMemberChain } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkInoutOwnAccess(ctx: CheckContext, out: DiagnosticItem[]): void {
  if (!ctx.config.lints.inoutOwnAccess) return // default ON; off only for a project that disabled the CODESYS warning (see header + LintConfig)
  for (const { unit, body, scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    const context = externalContext(scope, unit, body) // method/action/property-accessor scope; undefined = the FB's own body
    if (context === undefined) continue
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

/** The "external context" name CODESYS uses for a member-scope body — a method/action is its own name; a
 *  property accessor is `__get<Prop>` / `__set<Prop>` (matching the compiler). Undefined for the FB's own body. */
function externalContext(scope: Scope, unit: TopLevel, body: BodySpan): string | undefined {
  if (scope.kind === "method") return scope.name // method or action
  if (scope.kind === "accessor" && unit.kind === "property") {
    const p = unit as Property
    if (p.getter !== undefined && p.getter.body.span.start === body.span.start) return `__get${p.name.text}`
    if (p.setter !== undefined && p.setter.body.span.start === body.span.start) return `__set${p.name.text}`
  }
  return undefined
}
