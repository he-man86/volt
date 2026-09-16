/**
 * external-global (declarations/) — C0237. A `VAR_EXTERNAL` re-declares a global so a POU can reference it; if no
 * matching `VAR_GLOBAL` exists anywhere (project OR library), the reference is dangling. Fires only when NO
 * `gvl_var` of the name exists at all. Wording CODESYS-verified (2026-07-11 live).
 *
 * NOT here: C0236 (VAR_EXTERNAL type ≠ VAR_GLOBAL type) — the live IDE does NOT flag it (builds clean), so an
 * offline check would be a false positive. See the catalog C0236 note.
 *
 * A dangling one is DROPPED, not kept: the compiler then answers `Identifier 'g_i' not defined` at every use, and
 * carries the hole on from there (conformance `cc2_constant_and_external`, where one dangling name accounts for six
 * of the ten recorded errors).
 */
import { stmtExprs, walkExpr, walkStatements } from "../../../syntax/index.js"
import { bodies, forEachDecl, lookupLocal } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkExternalGlobal(ctx: CheckContext, out: DiagnosticItem[]): void {
  const dangling = new Set<string>()
  for (const { section, decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (section.sectionKind !== "VAR_EXTERNAL") continue
    for (const name of decl.names) {
      if (lookupLocal(ctx.project, name.text).some((s) => s.kind === "gvl_var")) continue
      dangling.add(name.text.toLowerCase())
      out.push({
        severity: "error",
        span: name.span,
        source: SOURCE,
        code: "external-no-global",
        message: ctx.messages.externalNoGlobal(name.text),
      })
    }
  }
  if (dangling.size === 0) return
  for (const { statements } of bodies(ctx.parseResult.units, ctx.project))
    walkStatements(statements, (s) => {
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          if (x.kind !== "ident_expr" || !dangling.has(x.name.toLowerCase())) return
          out.push({
            severity: "error",
            span: x.span,
            source: SOURCE,
            code: "unresolved-identifier",
            message: ctx.messages.undefinedIdentifier(x.name),
          })
        })
    })
}
