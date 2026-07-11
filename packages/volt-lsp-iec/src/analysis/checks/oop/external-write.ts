/**
 * external-non-input-write (D.2 · oop/). Flags `fb.internalVar := x` — writing an FB instance's
 * member that is not externally writable. Per doc 02-variables, only VAR_INPUT/VAR_OUTPUT are
 * reachable via `fb.x`; a plain VAR (or VAR_STAT/TEMP/INST) is internal. BOTH vendors reject with
 * the identical `'X' is no input of '<FB>'` (verified live 2026-07-05).
 *
 * Conservative: flags only a member write whose base infers to an FB, whose member is project-local
 * (library sections flatten — unreliable), and whose section is neither input nor output. Anything
 * uncertain skips → zero FP.
 */
import { walkStatements, type Expr } from "../../../syntax/index.js"
import { bodies, type Scope } from "../../../symbols/index.js"
import { inferExprType, resolveMemberChain } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { isLibrarySymbol, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkExternalNonInputWrite(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== undefined) return // plain `:=` only
      if (s.target.kind !== "member") return
      if (isInternalBase(s.target.base)) return // writing your own member (THIS/SUPER) is legal
      const baseType = inferExprType(s.target.base, scope, ctx.project)
      if (baseType.kind !== "function_block") return // struct/unknown → skip
      const sym = resolveMemberChain(s.target, scope, ctx.project)
      if (sym === undefined || isLibrarySymbol(sym)) return // library sections are lossy → can't decide
      const section = sym.varSection
      // VAR_INPUT / VAR_OUTPUT are externally writable; no section = not a variable; everything else internal.
      if (section === undefined || section === "VAR_INPUT" || section === "VAR_OUTPUT") return
      // VAR_IN_OUT external access (read OR write) is owned by inout-external-access (C0178) — cede it here.
      if (section === "VAR_IN_OUT") return
      const fbName = baseType.scope?.name ?? baseType.name
      out.push({
        severity: "error",
        span: s.target.span,
        source: SOURCE,
        code: "external-non-input-write",
        message: ctx.messages.noInput(s.target.member.name, fbName),
      })
    })
  }
}

/** True when the member base is the enclosing instance (`THIS`/`SUPER`, optionally deref'd) — internal write. */
function isInternalBase(expr: Expr): boolean {
  let e = expr
  if (e.kind === "paren") e = e.inner
  if (e.kind === "deref") e = e.base
  return e.kind === "ident_expr" && (e.name.toUpperCase() === "THIS" || e.name.toUpperCase() === "SUPER")
}
