/**
 * method-reference (C0130 · oop/). A METHOD member referenced as a VALUE without a call — `x := fb.Meth`
 * instead of `x := fb.Meth()`. A method must be invoked; naming it bare yields the method, not its result.
 * CODESYS: "METHOD '<name>' referenced without parentheses '()'".
 *
 * Called vs. referenced: the ONLY legitimate bare occurrence of a method member is as the callee of a call
 * (`fb.Meth(…)` — the member is `call.callee`). Every other occurrence is a value reference. So we collect
 * the call-callee nodes and flag any method-resolving member that isn't one of them.
 *
 * Zero-FP: member access only (a bare `Meth` could be the enclosing method's own return variable); fires only
 * when the reference resolves to a KNOWN project method; a library method or unresolved member skips.
 */
import { walkAllExprs, type Expr } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { resolveMemberChain } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { isLibrarySymbol, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkMethodReference(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    const callees = new Set<Expr>()
    walkAllExprs(statements, (e) => {
      if (e.kind === "call") callees.add(e.callee)
    })
    walkAllExprs(statements, (e) => {
      if (e.kind !== "member" || callees.has(e)) return // a called method (`fb.Meth()`) is fine
      const sym = resolveMemberChain(e, scope, ctx.project)
      if (sym?.kind !== "method" || isLibrarySymbol(sym)) return
      out.push({
        severity: "error",
        span: e.span,
        source: SOURCE,
        code: "method-referenced-without-parens",
        message: ctx.messages.methodReferencedWithoutParens(sym.name),
      })
    })
  }
}
