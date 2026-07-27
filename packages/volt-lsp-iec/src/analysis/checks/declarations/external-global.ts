/**
 * external-global (declarations/) — C0237. A `VAR_EXTERNAL` re-declares a global so a POU can reference it; if no
 * matching `VAR_GLOBAL` exists anywhere (project OR library), the reference is dangling. Fires only when NO
 * `gvl_var` of the name exists at all. Wording CODESYS-verified (2026-07-11 live).
 *
 * NOT here: C0236 (VAR_EXTERNAL type ≠ VAR_GLOBAL type) — the live IDE does NOT flag it (builds clean), so an
 * offline check would be a false positive. See the catalog C0236 note.
 */
import { lookupLocal } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, forEachDecl, type DiagnosticItem } from "../_shared.js"

export function checkExternalGlobal(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { section, decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (section.sectionKind !== "VAR_EXTERNAL") continue
    for (const name of decl.names) {
      if (lookupLocal(ctx.project, name.text).some((s) => s.kind === "gvl_var")) continue
      out.push({
        severity: "error",
        span: name.span,
        source: SOURCE,
        code: "external-no-global",
        message: ctx.messages.externalNoGlobal(name.text),
      })
    }
  }
}
