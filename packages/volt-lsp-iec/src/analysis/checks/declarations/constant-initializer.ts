/**
 * constant-initializer (C0228 · declarations/). A `CONSTANT` variable declared without an initial value —
 * a constant must be given its value inline. CODESYS: "No initial value for constant variable '<name>'".
 *
 * Zero-FP: fires only for a declaration in a LOCAL/GLOBAL `CONSTANT` section (`VAR`/`VAR_GLOBAL`), of an
 * ELEMENTARY type, with no initializer. A `VAR_INPUT CONSTANT` receives its value from the caller (not inline)
 * and a struct/array/FB-typed constant is default-initialized from its members — both legitimately omit the
 * initializer and must NOT fire; only a scalar constant, which has no meaningful implicit value, is required.
 */
import { resolveTypeExpr } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

const INLINE_CONST_SECTIONS = new Set(["VAR", "VAR_GLOBAL"])

export function checkConstantInitializer(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    for (const section of unit.varSections) {
      if (section.constant !== true || !INLINE_CONST_SECTIONS.has(section.sectionKind)) continue
      for (const decl of section.decls) {
        if (decl.init !== undefined) continue
        if (resolveTypeExpr(decl.type, ctx.project).kind !== "elementary") continue // composite → default-initialized
        for (const name of decl.names)
          out.push({
            severity: "error",
            span: name.span,
            source: SOURCE,
            code: "constant-no-initial-value",
            message: ctx.messages.constantNoInitialValue(name.text),
          })
      }
    }
  }
}
