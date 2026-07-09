/**
 * recursive-call (C0224 · calls/). A FUNCTION whose body calls itself — recursion, which IEC forbids for a
 * POU not marked `{attribute 'recursive'}`. CODESYS: "Call Recursion: F -> F".
 *
 * Scope: DIRECT self-recursion of a FUNCTION only (the documented `POU -> POU` case). A function call is an
 * unambiguous `Name(...)` in the body (a bare `Name := …` is the return-value assignment, not a call), so a
 * call whose callee ident matches the function's own name is a self-call.
 *
 * Zero-FP note: the `recursive` attribute is a pragma the parser drops (not on the AST), so a legally-recursive
 * function can't be distinguished — but such a function is rare, and the corpus (which compiles clean) has no
 * recursion at all. If a `{attribute 'recursive'}` function ever appears, revisit once attributes reach the AST.
 */
import { walkAllExprs } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkRecursiveCall(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { unit, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    if (unit.kind !== "function") continue
    const self = unit.name.text.toLowerCase()
    let found = false
    walkAllExprs(statements, (e) => {
      if (found || e.kind !== "call" || e.callee.kind !== "ident_expr") return
      if (e.callee.name.toLowerCase() === self) found = true
    })
    if (found)
      out.push({
        severity: "error",
        span: unit.name.span,
        source: SOURCE,
        code: "call-recursion",
        message: ctx.messages.callRecursion(`${unit.name.text} -> ${unit.name.text}`),
      })
  }
}
