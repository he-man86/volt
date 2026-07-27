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
import type { Initializer, Span } from "../../../syntax/index.js"
import { lookupLocal } from "../../../symbols/index.js"
import { resolveTypeExpr } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, forEachDecl, type DiagnosticItem } from "../_shared.js"

export function checkFbInitInout(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.init === undefined) continue
    const type = resolveTypeExpr(decl.type, ctx.project)
    if (type.kind !== "function_block" || type.scope === undefined) continue
    for (const { name, span } of initFields(decl.init)) {
      const isInout = lookupLocal(type.scope, name).some((s) => s.varSection === "VAR_IN_OUT")
      if (!isInout) continue
      out.push({
        severity: "error",
        span,
        source: SOURCE,
        code: "fb-init-inout",
        message: ctx.messages.fbInitNoOutput(name, type.name),
      })
    }
  }
}

/** Named fields of a struct/FB literal initializer: single `(f := v)` (paren+assign) or multi `(f := v, …)` (aggregate). */
function* initFields(init: Initializer): Generator<{ name: string; span: Span }> {
  if (init.kind === "paren" && init.inner.kind === "assign_expr" && init.inner.target.kind === "ident_expr") {
    yield { name: init.inner.target.name, span: init.inner.target.span }
    return
  }
  if (init.kind === "aggregate_init" && init.form === "struct") {
    for (const el of init.elements) if (el.kind === "field") yield { name: el.name, span: el.span }
  }
}
