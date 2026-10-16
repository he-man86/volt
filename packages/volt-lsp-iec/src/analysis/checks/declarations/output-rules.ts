/**
 * output-rules (C0222 · declarations/). A `VAR_OUTPUT` variable declared as `REFERENCE TO <t>` — outputs may
 * not be references.
 *
 * Zero-FP: a pure declaration-shape decision (section kind + declared type kind).
 */
import type { CheckContext } from "../../pipeline/context.js"
import { forEachDecl } from "../../../frontend/symbols/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkOutputRules(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { section, decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (section.sectionKind !== "VAR_OUTPUT") continue
    if (decl.type.kind === "reference_type")
      emit(out, decl.type.span, "output-reference-type", ctx.messages.outputCantBeReference())
  }
}
