/**
 * output-rules (C0222 · declarations/). A `VAR_OUTPUT` variable declared as `REFERENCE TO <t>` — outputs may
 * not be references.
 *
 * Zero-FP: a pure declaration-shape decision (section kind + declared type kind).
 */
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, forEachDecl, type DiagnosticItem } from "../_shared.js"

export function checkOutputRules(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { section, decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (section.sectionKind !== "VAR_OUTPUT") continue
    if (decl.type.kind === "reference_type")
      out.push({
        severity: "error",
        span: decl.type.span,
        source: SOURCE,
        code: "output-reference-type",
        message: ctx.messages.outputCantBeReference(),
      })
  }
}
