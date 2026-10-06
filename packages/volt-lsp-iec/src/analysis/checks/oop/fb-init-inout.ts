/**
 * fb-init-inout (D.2 · oop/) — C0179. An inline FB-instance initializer (`fb : MyFB := (inOut := x)`) may only
 * assign the FB's INPUTS. A VAR_IN_OUT is a call-bound reference with no instance storage, so binding it at
 * declaration is meaningless — CODESYS rejects the field. Sibling of C0178 (inout-external-access); this owns the
 * VAR_IN_OUT-in-initializer case.
 *
 * Conservative (zero-FP): fires only when the declared type resolves to a PROJECT function block (library FB
 * scopes are absent → skipped) and an initializer field resolves to one of its VAR_IN_OUT members. Fields
 * targeting inputs/outputs/unknown members are left alone.
 */
import { forEachDecl, lookupLocal } from "../../../frontend/symbols/index.js"
import { resolveTypeExpr, type Type } from "../../../frontend/types/index.js"
import { literalBind, variableBind } from "../../shared/reference-bind.js"
import { initializerFields } from "../../shared/initializer.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkFbInitInout(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.init === undefined) continue
    const type = resolveTypeExpr(decl.type, ctx.project, 0, ctx.project, ctx.uri)
    if (type.kind !== "function_block" || type.scope === undefined) continue
    for (const { name, span, value } of initializerFields(decl.init)) {
      const param = lookupLocal(type.scope, name).find((s) => s.varSection === "VAR_IN_OUT")
      if (param === undefined) continue
      out.push({
        severity: "error",
        span,
        source: SOURCE,
        code: "fb-init-inout",
        message: ctx.messages.noInput(name, type.name),
      })
      // …and the value BINDS the parameter's reference, so it must be of the parameter's type: a literal or a variable of
      // another is "Cannot convert type 'BOOL' to type 'REFERENCE TO INT'" (TwinCAT naming the pair the other way round, as
      // for a REF= statement — `ioinit_fb_instance_literal`, `oopa_fb_init_inout_other_type`, both vendors 2026-10-06)
      if (value === undefined || param.typeExpr === undefined) continue
      const referenced = resolveTypeExpr(param.typeExpr, ctx.project, 0, param.owner, param.uri)
      if (referenced.kind === "unknown") continue
      const reference: Type & { kind: "reference" } = { kind: "reference", target: referenced }
      const bind = value.kind === "literal" ? literalBind(value, reference) : value.kind === "ident_expr" ? variableBind(value, reference, scope, ctx.project) : undefined
      if (bind === undefined || bind === "exact") continue
      out.push({ severity: "error", span: value.span, source: SOURCE, code: "assignment-type-mismatch", message: ctx.messages.refAssignCannotConvert(bind.from, bind.to) })
    }
  }
}
