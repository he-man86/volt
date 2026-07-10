/**
 * input-default (C0525 · declarations/). A composite-typed input parameter (an ARRAY) declared with a default
 * value — CODESYS forbids a default on such a type in the input context. Scalars legitimately take defaults, so
 * only array-typed `VAR_INPUT` decls with an initializer fire. The type name in the message is the declaration's
 * own source text (CODESYS echoes the written form, e.g. `ARRAY [0..1] OF INT`).
 *
 * Zero-FP: an array default on a function/method input never compiles, so a clean corpus never exhibits it.
 */
import { resolveTypeExpr } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkInputDefault(ctx: CheckContext, out: DiagnosticItem[]): void {
  if (ctx.config.vendor !== "codesys") return // live /build: TwinCAT silently accepts an array default on a FUNCTION input
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "function") continue // FB/method inputs legitimately take array defaults; only FUNCTION forbids it
    for (const section of unit.varSections) {
      if (section.sectionKind !== "VAR_INPUT") continue
      for (const decl of section.decls) {
        if (decl.init === undefined) continue
        if (resolveTypeExpr(decl.type, ctx.project).kind !== "array") continue // scalars may take a default
        const typeName = ctx.source.slice(decl.type.span.start, decl.type.span.end).trim()
        for (const name of decl.names)
          out.push({
            severity: "error",
            span: name.span,
            source: SOURCE,
            code: "input-default-composite",
            message: ctx.messages.noDefaultForType(typeName),
          })
      }
    }
  }
}
