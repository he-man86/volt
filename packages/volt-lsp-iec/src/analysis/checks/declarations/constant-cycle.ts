/**
 * constant-cycle (rule CE5 · declarations/). A CONSTANT whose initializer reaches itself — directly (`cs : INT := cs + 1`)
 * or through another constant (`ca := cb + 1; cb := ca + 1`) — is refused once per constant of the cycle: "Recursive
 * definition of constant value" (CODESYS, `ce_cycle` twice, `ce_cycle_self` once, 2026-10-03). The walk is the fold's
 * (`types/const/fold` `isRecursiveConstant`), which stops at the cycle.
 *
 * CODESYS only (`diagnostics` `CODESYS_ONLY`): TwinCAT has no recorded answer — its XAE exits building a recursive constant (`ce_cycle`, `ce_cycle_self`
 * `vendorRefuses.twincat`) — and the CODESYS sentence said there would be an LSP-only message (step 4d review).
 */
import { forEachDecl, lookupLocal } from "../../../frontend/symbols/index.js"
import { isRecursiveConstant } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkConstantCycle(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { section, decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (section.constant !== true || decl.init === undefined) continue
    for (const name of decl.names) {
      const symbol = lookupLocal(scope, name.text).find((s) => s.ast === decl)
      if (symbol === undefined || !isRecursiveConstant(symbol)) continue
      out.push({ severity: "error", span: name.span, source: SOURCE, code: "constant-cycle", message: ctx.messages.recursiveConstant() })
    }
  }
}
