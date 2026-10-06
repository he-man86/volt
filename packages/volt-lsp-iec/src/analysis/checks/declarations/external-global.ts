/**
 * external-global (declarations/) — C0237. A `VAR_EXTERNAL` re-declares a global so a POU can reference it; if no list
 * declares a variable of the name that a bare name reaches (`symbols/scope-nav` `externalGlobal`: a `qualified_only`
 * list's is none, rule Y13), the reference is dangling. Wording CODESYS-verified (2026-07-11 live).
 *
 * NOT here: C0236 (VAR_EXTERNAL type ≠ VAR_GLOBAL type) — the live IDE does NOT flag it (builds clean), so an
 * offline check would be a false positive. See the catalog C0236 note.
 *
 * A dangling one binds NOTHING: the compiler answers `Identifier 'g_i' not defined` at every use and carries the hole on
 * from there (conformance `cc2_constant_and_external`, where one dangling name accounts for six of the ten recorded
 * errors). That is the search order's to say, not this check's — `lookup` passes over a VAR_EXTERNAL with no global
 * (frontend-conformance 3.1.3), so `unresolved-identifier` reports each use; a separate walk here reported them twice
 * once it did (`analysis/lost-declaration.ts`, deleted).
 */
import { externalGlobal, forEachDecl } from "../../../frontend/symbols/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkExternalGlobal(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { section, decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (section.sectionKind !== "VAR_EXTERNAL") continue
    for (const name of decl.names) {
      if (externalGlobal(ctx.project, name.text) !== undefined) continue
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
