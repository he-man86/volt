/**
 * inout-access (D.2 · oop/) — the two checks of an FB's VAR_IN_OUT parameter, one home for their codes
 * (analysis-conformance 1.12): C0178 `inout-no-external-access` (with its C0371 companion) for an access from OUTSIDE
 * the FB, and C0371 `inout-own-access` for one from the FB's own member scopes. Two registry entries, adjacent in the
 * run order, as they were when they were two files. The two never overlap on WHICH access they describe: the external
 * one requires a non-THIS FB-typed base, the own one a bare/own reference.
 */
import { isSelfRef, walkAllExprs, walkExpr, type IdentExpr } from "../../../frontend/syntax/index.js"
import { bodies, forEachDecl, isLibrarySymbol, lookupLocal } from "../../../frontend/symbols/index.js"
import { bodyContext, MAIN_BODY } from "../../shared/body-context.js"
import { inferExprType, resolveMemberChain, resolveTypeExpr } from "../../../frontend/types/index.js"
import { initializerFields, initializerValues, isListInitializer } from "../../shared/initializer.js"
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
  initializerAccess(ctx, out)
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

/**
 * AN INITIALIZER IS AN ACCESS TOO (both vendors, recorded 2026-10-06, analysis-conformance 3.6), of an FB's own unit:
 *   - an FB INSTANCE initialized through its FB's VAR_IN_OUT, `w : B := (target := x)`, is an access from the POU that
 *     declares it — "… declared in 'B' from external context '<that FB>'" (`ioinit_fb_instance_literal`,
 *     `oopa_fb_init_inout_other_type`, `cc5_fb_init_inout`);
 *   - an ARRAY or STRUCT initializer reading the FB's OWN VAR_IN_OUT is compiled into FB_INIT, and accesses it from there —
 *     "… from external context 'FB_INIT'" (`ioinit_array_initializer`, `ioinit_struct_initializer`). A plain initializer
 *     reading it draws no such warning (`cc4_inout_in_initializer`, only the uninitialized access).
 * Measured in a FUNCTION_BLOCK's declarations only; a PROGRAM's or a METHOD's are not asked.
 */
function initializerAccess(ctx: CheckContext, out: DiagnosticItem[]): void {
  const warn = (span: DiagnosticItem["span"], param: string, fb: string, context: string) =>
    out.push({ severity: "warning", span, source: SOURCE, code: "inout-own-access", message: ctx.messages.inoutOwnAccess(param, fb, context) })
  for (const { unit, section, decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (unit.kind !== "function_block" || decl.init === undefined || section.sectionKind === "VAR_IN_OUT") continue
    const type = resolveTypeExpr(decl.type, ctx.project, 0, ctx.project, ctx.uri)
    if (type.kind === "function_block" && type.scope !== undefined) {
      const fbScope = type.scope
      for (const f of initializerFields(decl.init)) {
        const param = lookupLocal(fbScope, f.name).find((s) => s.varSection === "VAR_IN_OUT")
        if (param !== undefined) warn(f.span, param.name, fbScope.name, unit.name.text)
      }
      continue
    }
    if (!isListInitializer(decl.init)) continue
    const own = new Map<string, string>()
    for (const s of unit.varSections) if (s.sectionKind === "VAR_IN_OUT") for (const d of s.decls) for (const n of d.names) own.set(n.text.toLowerCase(), n.text)
    if (own.size === 0) continue
    for (const value of initializerValues(decl.init))
      walkExpr(value, (e) => {
        const name = e.kind === "ident_expr" ? own.get(e.name.toLowerCase()) : undefined
        if (name !== undefined) warn(e.span, name, unit.name.text, FB_INIT)
      })
  }
}

/** The body an FB's initializers are compiled into, as the vendors name it. */
const FB_INIT = "FB_INIT"

