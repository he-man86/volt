/**
 * non-callable-call (D.2 · calls/) — C0036. `X(...)` where X is not callable: a GVL, or a plain variable of a
 * scalar/struct/array/pointer type. The load-bearing part is CONSERVATIVE callable detection: an offline
 * resolver can't see library FB types, so a var typed as a library FB infers to `unknown`, NOT `function_block`
 * — a naive "not an FB ⇒ not callable" fires on every library-FB instance call (18 corpus FPs, scouted). So we
 * fire ONLY when the target is a GVL block or its type is a KNOWN non-callable kind; an unknown/library type is
 * treated as possibly-callable and skipped. Corpus-verified zero-FP. Wording PROVISIONAL until a live recording.
 */
import { walkAllExprs } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { inferExprType, renderType, resolveMemberChain } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

const CALLABLE_KINDS = new Set(["function_block", "function", "method", "program", "action", "interface_method"])
const NON_CALLABLE_TYPE = new Set(["elementary", "enum", "struct", "array", "pointer", "reference"])

export function checkNonCallableCall(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkAllExprs(statements, (e) => {
      if (e.kind !== "call") return
      const sym = resolveMemberChain(e.callee, scope, ctx.project)
      if (sym === undefined || CALLABLE_KINDS.has(sym.kind)) return // unresolved or a real callable → skip
      // A GVL block, or a value whose type is a KNOWN non-callable kind. An unknown/library/FB type → skip.
      const type =
        sym.kind === "gvl_block"
          ? "VAR_GLOBAL"
          : (() => {
              const t = inferExprType(e.callee, scope, ctx.project)
              return NON_CALLABLE_TYPE.has(t.kind) ? renderType(t) : undefined
            })()
      if (type === undefined) return
      out.push({ severity: "error", span: e.callee.span, source: SOURCE, code: "non-callable-call", message: ctx.messages.cannotCallType(type) })
    })
  }
}
