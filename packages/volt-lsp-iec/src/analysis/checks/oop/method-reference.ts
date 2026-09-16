/**
 * method-reference (oop/). A METHOD member referenced as a VALUE without a call — `x := fb.Meth` instead of
 * `x := fb.Meth()`. CODESYS does not describe the missing parentheses: it treats the bare name as a TYPE, spelled
 * in upper case, and reports what it could not convert — `Cannot convert type 'VALUE' to type 'INT'` (conformance
 * `cc2_type_name_and_method_without_parens`, recorded 2026-09-16). The LSP said "METHOD 'Value' referenced without
 * parentheses '()'", a sentence neither compiler emits in any recording.
 *
 * Only an ASSIGNMENT's source is checked, because that is the shape measured — and the destination type is half of
 * what the message says.
 *
 * Called vs. referenced: the ONLY legitimate bare occurrence of a method member is as the callee of a call
 * (`fb.Meth(…)` — the member is `call.callee`). Every other occurrence is a value reference. So we collect
 * the call-callee nodes and flag any method-resolving member that isn't one of them.
 *
 * Zero-FP: member access only (a bare `Meth` could be the enclosing method's own return variable); fires only
 * when the reference resolves to a KNOWN project method; a library method or unresolved member skips.
 */
import { walkStatements } from "../../../syntax/index.js"
import { bodies, isLibrarySymbol } from "../../../symbols/index.js"
import { inferExprType, renderType, resolveMemberChain } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkMethodReference(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project))
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== undefined || s.value.kind !== "member") return
      const sym = resolveMemberChain(s.value, scope, ctx.project)
      if (sym?.kind !== "method" || isLibrarySymbol(sym)) return
      const target = inferExprType(s.target, scope, ctx.project)
      if (target.kind === "unknown") return
      out.push({
        severity: "error",
        span: s.value.span,
        source: SOURCE,
        code: "method-referenced-without-parens",
        message: ctx.messages.cannotConvert(sym.name.toUpperCase(), renderType(target)),
      })
    })
}
