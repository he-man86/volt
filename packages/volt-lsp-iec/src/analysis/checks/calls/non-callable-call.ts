/**
 * non-callable-call (D.2 · calls/) — `X(...)` where X is not callable. Two CODESYS codes, split by target
 * (verified live 2026-07-11):
 *   - C0036 (a GVL block)      → "Cannot call object of type 'VAR_GLOBAL'"
 *   - C0035 (a plain variable) → "Program name, function or function block instance expected instead of '<x>'"
 *
 * The load-bearing part is CONSERVATIVE callable detection: an offline resolver can't see library FB types, so
 * a var typed as a library FB infers to `unknown`, NOT `function_block` — a naive "not an FB ⇒ not callable"
 * fires on every library-FB instance call (18 corpus FPs, scouted). So we fire ONLY when the target is a GVL
 * block or its type is a KNOWN non-callable kind; an unknown/library type is possibly-callable → skipped.
 * Corpus-verified zero-FP.
 */
import { walkAllExprs, type Expr } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { inferExprType, resolveMemberChain } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

// `interface` is here so C0035 cedes the INTERFACE case to `fb-instantiation`, which has the IDE's own two messages
// for it — "Cannot call object of type 'INTERFACE'" and "Interface '…' must be instantiated to be accessed"
// (conformance `cc5_type_invoked_directly`). C0035's generic sentence fired beside them as a false positive.
const CALLABLE_KINDS = new Set(["function_block", "function", "method", "program", "action", "interface_method", "interface"])
const NON_CALLABLE_TYPE = new Set(["elementary", "enum", "struct", "array", "pointer", "reference"])

/** The invoked name for the C0035 message (`i` in `i()`, the member in `a.b()`). */
function calleeName(e: Expr): string {
  return e.kind === "ident_expr" ? e.name : e.kind === "member" ? e.member.name : e.kind === "paren" ? calleeName(e.inner) : "?"
}

export function checkNonCallableCall(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkAllExprs(statements, (e) => {
      if (e.kind !== "call") return
      const sym = resolveMemberChain(e.callee, scope, ctx.project)
      if (sym === undefined || CALLABLE_KINDS.has(sym.kind)) return // unresolved or a real callable → skip
      if (sym.kind === "gvl_block") {
        out.push({ severity: "error", span: e.callee.span, source: SOURCE, code: "non-callable-call", message: ctx.messages.cannotCallType("VAR_GLOBAL") })
        return
      }
      // A value whose type is a KNOWN non-callable kind → C0035. An unknown/library/FB type → skip (zero-FP).
      // A REFERENCE TO an FB IS callable — `chosen REF= inst; chosen(throttle := 7)` builds and runs (conformance
      // `xo_reference_to_fb_call`) — so a reference or a pointer is judged by what it points AT, not by being one.
      // *Why missed:* no fixture ever called through one; every REFERENCE TO case pinned a declaration or a read.
      const type = inferExprType(e.callee, scope, ctx.project)
      const target = type.kind === "pointer" || type.kind === "reference" ? type.target : type
      if (NON_CALLABLE_TYPE.has(target.kind))
        out.push({ severity: "error", span: e.callee.span, source: SOURCE, code: "invalid-call-target", message: ctx.messages.callTargetExpected(calleeName(e.callee)) })
    })
  }
}
