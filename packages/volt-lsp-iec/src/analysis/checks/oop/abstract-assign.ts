/**
 * abstract-assign (D.2 · oop/) — C0511. A value assignment (`a := b`, implicit-deref copy) whose target is an
 * abstract function block — directly, or through a `REFERENCE TO` (which copies the referent) — is illegal: an
 * abstract FB has no concrete body to copy. A `REF=` rebind copies only the reference, so it is left alone.
 *
 * Conservative (zero-FP): fires only for a plain `:=` whose target is a simple identifier resolving to (a
 * reference to) a PROJECT FB whose AST carries `abstract`. Pointer targets copy the address, not the FB, so
 * they're excluded; library FBs (no `abstract` visible) are skipped. Wording is CODESYS-verified (the message
 * names the TARGET variable, not the FB type). PROVISIONAL on TwinCAT.
 */
import type { FunctionBlock } from "../../../syntax/index.js"
import { walkStatements } from "../../../syntax/index.js"
import { bodies, lookupLocal } from "../../../symbols/index.js"
import { inferExprType } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkAbstractAssign(ctx: CheckContext, out: DiagnosticItem[]): void {
  if (ctx.config.vendor !== "codesys") return // live /build (2026-07-11 :8555): TwinCAT accepts this — no such rule
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== undefined || s.target.kind !== "ident_expr") return
      const t = inferExprType(s.target, scope, ctx.project)
      const fb = t.kind === "reference" ? t.target : t
      if (fb.kind !== "function_block") return
      const sym = lookupLocal(ctx.project, fb.name).find((x) => x.kind === "function_block")
      if (sym === undefined || (sym.ast as FunctionBlock).abstract !== true) return
      out.push({
        severity: "error",
        span: s.target.span,
        source: SOURCE,
        code: "abstract-assign",
        message: ctx.messages.abstractAssignTarget(fb.name),
      })
    })
  }
}
