/**
 * this-super-context (flow/). `THIS` (C0045) and `SUPER` (C0122) referenced in a POU where they have no
 * meaning — a PROGRAM or a FUNCTION (both are instance-less). They are valid only inside a function-block /
 * method / property body.
 *
 * Zero-FP: fires only in a `program`/`function` unit; FB/method/action/property bodies are never flagged.
 *
 * AND `SUPER` IN A FUNCTION BLOCK THAT EXTENDS NOTHING, which is the same error — "Expression SUPER is not allowed in
 * this context" — and, where it is CALLED, the call position's too: "Program name, function or function block instance
 * expected instead of 'X'", X the callee as written ('SUPER^' for `SUPER^()`, 'SUPER^.Get' for `SUPER^.Get()`;
 * `refuse_super_without_base`, `expr_super_without_base`, both vendors 2026-10-02 — this said the call message was the
 * whole answer, a fixed 'SUPER^' on every SUPER). Gated on the DECLARATION saying nothing about a base, not on the base
 * having resolved: an FB extending a LIBRARY type names one this analysis cannot see, and flagging that would be a
 * false positive.
 */
import { selfRefKind, walkAllExprs, type Expr } from "../../../frontend/syntax/index.js"
import { compilerExprText } from "../../expr-echo.js"
import { bodies, enclosingPou, type Scope } from "../../../frontend/symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

/** `THIS` or `SUPER` itself, not dereferenced. */
const bareSelf = (e: Expr): boolean => e.kind === "ident_expr" && selfRefKind(e.name) !== undefined

/** True when a callee's chain starts at SUPER: `SUPER^`, `SUPER^.Get`. */
function rootedAtSuper(e: Expr): boolean {
  if (e.kind === "ident_expr") return selfRefKind(e.name) === "SUPER"
  return e.kind === "deref" || e.kind === "member" ? rootedAtSuper(e.base) : false
}

/** True when the nearest enclosing POU declares no EXTENDS at all — a method's base is its owner's. */
function baseless(scope: Scope): boolean {
  const pou = enclosingPou(scope)
  return pou !== undefined && pou.extendsName === undefined
}

export function checkThisSuperContext(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { unit, scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    if (unit.kind !== "program" && unit.kind !== "function") {
      // THIS and SUPER WITHOUT their `^` are the pointers themselves (`infer/member` `thisType`), which have no members:
      // `THIS.v` is "'THIS' is no structured variable" — any pointer's sentence, said by `unresolved-identifier` — and
      // `SUPER.Get()` that and no call target as written, each hole then converted as a refused name's
      // (`expr_this_member_without_deref`, `expr_super_without_deref`, both vendors 2026-10-02). Where there is NO base a
      // bare SUPER is not allowed at all, and that is all it is: `SUPER.Get()` there is no structured-variable message
      // (SUPER has no type there), and its call target is said once, below (`expr_super_without_deref_without_base`)
      const noBase = baseless(scope)
      const pointer = (e: Expr): boolean => bareSelf(e) && !(noBase && e.kind === "ident_expr" && selfRefKind(e.name) === "SUPER")
      walkAllExprs(statements, (e) => {
        if (e.kind === "call" && e.callee.kind === "member" && pointer(e.callee.base))
          out.push({ severity: "error", span: e.callee.span, source: SOURCE, code: "invalid-call-target", message: ctx.messages.callTargetExpected(compilerExprText(e.callee)) })
      })
      if (!noBase) continue
      walkAllExprs(statements, (e) => {
        if (e.kind === "ident_expr" && selfRefKind(e.name) === "SUPER")
          out.push({ severity: "error", span: e.span, source: SOURCE, code: "super-not-allowed", message: ctx.messages.superNotAllowed() })
        else if (e.kind === "call" && rootedAtSuper(e.callee))
          out.push({ severity: "error", span: e.callee.span, source: SOURCE, code: "invalid-call-target", message: ctx.messages.callTargetExpected(compilerExprText(e.callee)) })
      })
      continue
    }
    walkAllExprs(statements, (e) => {
      if (e.kind !== "ident_expr") return
      // Case-insensitive, as ST names are: a lower-case `this`/`super` is the same error (conformance `cc_self_this_*`,
      // `cc_self_super_*`). An exact `=== "THIS"` let them through (consolidate-lsp-structure A8).
      const name = selfRefKind(e.name)
      if (name === "THIS")
        out.push({ severity: "error", span: e.span, source: SOURCE, code: "this-not-allowed", message: ctx.messages.thisNotAllowed() })
      else if (name === "SUPER")
        out.push({ severity: "error", span: e.span, source: SOURCE, code: "super-not-allowed", message: ctx.messages.superNotAllowed() })
    })
  }
}
