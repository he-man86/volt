/**
 * input-default (C0525 · declarations/). A composite-typed input parameter (an ARRAY or a STRUCT) of a FUNCTION or a METHOD
 * declared with a default value — CODESYS forbids a default on such a type in the input context (`cc6_function_input_array_
 * default`, `indf_function_input_struct_default`, `indf_method_input_array_default`, 2026-10-06). Scalars legitimately take
 * defaults, and an FB's inputs take composite ones, so only those `VAR_INPUT` decls fire. The type name in the message is the declaration's
 * own source text (CODESYS echoes the written form, e.g. `ARRAY [0..1] OF INT`).
 *
 * Zero-FP: an array default on a function/method input never compiles, so a clean corpus never exhibits it.
 */
import { renderType, resolveTypeExpr } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkInputDefault(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    // an FB's inputs legitimately take composite defaults; a FUNCTION's and a METHOD's do not (`indf_method_input_array_default`)
    if (unit.kind !== "function" && unit.kind !== "method") continue
    for (const section of unit.varSections) {
      if (section.sectionKind !== "VAR_INPUT") continue
      for (const decl of section.decls) {
        if (decl.init === undefined) continue
        const type = resolveTypeExpr(decl.type, ctx.project, 0, ctx.project, ctx.uri)
        if (type.kind !== "array" && type.kind !== "struct") continue // scalars may take a default
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
