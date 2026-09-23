/**
 * input-default (C0525 · declarations/). A composite-typed input parameter (an ARRAY) declared with a default
 * value — CODESYS forbids a default on such a type in the input context. Scalars legitimately take defaults, so
 * only array-typed `VAR_INPUT` decls with an initializer fire. The type name in the message is the declaration's
 * own source text (CODESYS echoes the written form, e.g. `ARRAY [0..1] OF INT`).
 *
 * Zero-FP: an array default on a function/method input never compiles, so a clean corpus never exhibits it.
 */
import { renderType, resolveTypeExpr } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkInputDefault(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "function") continue // FB/method inputs legitimately take array defaults; only FUNCTION forbids it
    for (const section of unit.varSections) {
      if (section.sectionKind !== "VAR_INPUT") continue
      for (const decl of section.decls) {
        if (decl.init === undefined) continue
        const type = resolveTypeExpr(decl.type, ctx.project, 0, ctx.project, ctx.uri)
        if (type.kind !== "array") continue // scalars may take a default
        // The IDE does NOT echo the written form, as this read: a declaration spelled `ARRAY[1..3] OF INT` comes back
        // as "ARRAY [1..3] OF INT", with the space `renderType` now writes (conformance
        // `cc6_function_input_array_default`). It is a WARNING there too, not an error.
        for (const name of decl.names)
          out.push({
            severity: "warning",
            span: name.span,
            source: SOURCE,
            code: "input-default-composite",
            message: ctx.messages.noDefaultForType(renderType(type)),
          })
      }
    }
  }
}
