/**
 * inout-initializer (C0441 · declarations/). A VAR_IN_OUT parameter is a reference with no compile-time
 * storage, so referencing one in ANOTHER declaration's initializer (`b : BOOL := a[i]` where `a` is
 * VAR_IN_OUT) accesses it before it is bound. CODESYS: "Access to uninitialized VAR_IN_OUT variable".
 *
 * It fires where an initializer READS a name declared VAR_IN_OUT in the SAME unit — a plain expression's, and an ARRAY
 * or STRUCT initializer's values, which are compiled into FB_INIT like any other (`ioinit_array_initializer`,
 * `ioinit_struct_initializer`, both vendors 2026-10-06; CODESYS records the warning twice there, TwinCAT once — said
 * once). A field's NAME is not a read. A VAR_IN_OUT used in a statement body — its legitimate use — is never touched
 * (only declaration initializers are scanned). And where an FB INSTANCE is initialized through that FB's own
 * VAR_IN_OUT (`w : B := (target := x)`, `ioinit_fb_instance_literal`, `cc5_fb_init_inout`).
 *
 * The reverse shape too: a VAR_IN_OUT given an initializer OF ITS OWN (`seeded : INT := 3`). There is nothing to
 * initialize — the parameter is bound at the call — so CODESYS reads the `:=` as that binding and answers about
 * what is on the right of it: "'3' is no valid assignment target" (conformance `cc4_inout_in_initializer`).
 */
import { walkExpr, type Span } from "../../../frontend/syntax/index.js"
import { initializerFields, initializerValues } from "../../shared/initializer.js"
import { forEachDecl, lookupLocal } from "../../../frontend/symbols/index.js"
import { resolveTypeExpr } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkInoutInitializer(ctx: CheckContext, out: DiagnosticItem[]): void {
  const uninitialized = (span: Span) =>
    out.push({ severity: "error", span, source: SOURCE, code: "inout-in-initializer", message: ctx.messages.inoutInInitializer() })
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    const inout = new Set<string>()
    for (const s of unit.varSections)
      if (s.sectionKind === "VAR_IN_OUT") for (const d of s.decls) for (const n of d.names) inout.add(n.text.toLowerCase())
    if (inout.size === 0) continue
    for (const s of unit.varSections)
      for (const d of s.decls) {
        if (d.init === undefined) continue
        if (s.sectionKind === "VAR_IN_OUT" && d.init.kind !== "aggregate_init")
          out.push({
            severity: "error",
            span: d.init.span,
            source: SOURCE,
            // `not-assignment-target`, not this file's code: that is the rule being reported, and this code's
            // configured severity is a warning, which silently downgraded the error.
            code: "not-assignment-target",
            message: ctx.messages.notAssignmentTarget(ctx.source.slice(d.init.span.start, d.init.span.end)),
          })
        // every VALUE the initializer reads — an aggregate's too (it is compiled into FB_INIT like any other), never a
        // field's NAME (`(a := 1)` names the struct's member `a`, not the parameter)
        for (const value of initializerValues(d.init))
          walkExpr(value, (e) => {
            if (e.kind === "ident_expr" && inout.has(e.name.toLowerCase())) uninitialized(e.span)
          })
      }
  }
  // An FB INSTANCE initialized through that FB's own VAR_IN_OUT (`w : B := (target := x)`): besides "is no input"
  // (fb-init-inout), the access is to a VAR_IN_OUT nothing has bound yet (`ioinit_fb_instance_literal`,
  // `cc5_fb_init_inout`, both vendors). Only a PROJECT function block's scope is known; a library FB's is skipped.
  // Measured in a FUNCTION_BLOCK's declarations only, as inout-access's `initializerAccess`: a PROGRAM's, a FUNCTION's, a
  // METHOD's or a list's instance is not asked.
  for (const { unit, decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (unit.kind !== "function_block" || decl.init === undefined) continue
    const fields = initializerFields(decl.init)
    if (fields.length === 0) continue
    const type = resolveTypeExpr(decl.type, ctx.project, 0, ctx.project, ctx.uri)
    if (type.kind !== "function_block" || type.scope === undefined) continue
    const scope = type.scope
    for (const f of fields) if (lookupLocal(scope, f.name).some((sym) => sym.varSection === "VAR_IN_OUT")) uninitialized(f.span)
  }
}
