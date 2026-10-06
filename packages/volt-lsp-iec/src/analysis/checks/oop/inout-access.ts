/**
 * inout-access (D.2 · oop/) — the two checks of an FB's VAR_IN_OUT parameter, one home for their codes
 * (analysis-conformance 1.12): C0178 `inout-no-external-access` (with its C0371 companion) for an access from OUTSIDE
 * the FB, and C0371 `inout-own-access` for one from the FB's own member scopes. Two registry entries, adjacent in the
 * run order, as they were when they were two files. The two never overlap on WHICH access they describe: the external
 * one requires a non-THIS FB-typed base, the own one a bare/own reference.
 */
import { isSelfRef, walkAllExprs, type IdentExpr } from "../../../frontend/syntax/index.js"
import { bodies, isLibrarySymbol } from "../../../frontend/symbols/index.js"
import { bodyContext, MAIN_BODY } from "../../shared/body-context.js"
import { inferExprType, resolveMemberChain } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

/**
 * inout-external-access — C0178. An FB's VAR_IN_OUT parameter is a call-bound reference with no
 * storage on the instance, so `inst.in_out` from OUTSIDE the FB (read or write) is meaningless — CODESYS
 * rejects it. This owns the whole VAR_IN_OUT-member case; `external-write` cedes it (its generic "is no input"
 * is for VAR/VAR_STAT/… members).
 *
 * The compiler reports the C0371 WARNING here too, naming the body that reached in (`__MAIN` for an FB's own body):
 * an external instance access is two diagnostics, not one (conformance `cc5_inout_external_access`). C0371's
 * own-member-scope case stays with `inout-own-access`; the two never overlap on WHICH access they describe.
 *
 * Conservative (zero-FP): fires only when the base infers to a project-local FB (library sections flatten →
 * unreliable) and the member resolves to a VAR_IN_OUT; a THIS/SUPER base (the FB's own params) is legal.
 */
export function checkInoutExternalAccess(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { unit, body, scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    const context = bodyContext(scope, unit, body)
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
      out.push({
        severity: "warning",
        span: e.span,
        source: SOURCE,
        code: "inout-own-access",
        message: ctx.messages.inoutOwnAccess(e.member.name, fbName, context),
      })
    })
  }
}

/**
 * inout-own-access — C0371, a WARNING. A method/action/property accessor that touches its
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
