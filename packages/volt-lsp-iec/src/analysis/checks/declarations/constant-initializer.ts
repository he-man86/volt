/**
 * constant-initializer (C0228 · declarations/). A `CONSTANT` variable declared without an initial value —
 * a constant should be given its value inline. CODESYS: "No initial value for constant variable '<name>'".
 * A WARNING, not an error (live-confirmed on the bakon-nano build) — the constant defaults, so it compiles.
 *
 * Zero-FP: fires for a declaration in a LOCAL/GLOBAL `CONSTANT` section (`VAR`/`VAR_GLOBAL`) with no
 * initializer — of ANY resolvable value type (elementary OR struct/array/enum/union: live-confirmed on
 * bakon-nano, CODESYS warns on `defaultXYA : XYA_Target` too). A `VAR_INPUT CONSTANT` takes its value from the
 * caller and is skipped; an unresolvable/library type is skipped (zero-FP — can't know its shape); an
 * FB-typed "constant" is skipped (not a value type).
 */
import { resolveTypeExpr } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, forEachDecl, type DiagnosticItem } from "../_shared.js"

const INLINE_CONST_SECTIONS = new Set(["VAR", "VAR_GLOBAL"])

export function checkConstantInitializer(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { section, decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (section.constant !== true || !INLINE_CONST_SECTIONS.has(section.sectionKind)) continue
    if (decl.init !== undefined) continue
    const t = resolveTypeExpr(decl.type, ctx.project).kind
    if (t === "unknown" || t === "function_block" || t === "interface") continue // unresolvable/non-value → skip (zero-FP)
    for (const name of decl.names)
      out.push({
        severity: "warning",
        span: name.span,
        source: SOURCE,
        code: "constant-no-initial-value",
        message: ctx.messages.constantNoInitialValue(name.text),
      })
  }
}
