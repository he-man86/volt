/**
 * var-section-placement (D.2 · declarations/). Flags a VAR-section kind not allowed for the
 * containing POU:
 *   - VAR_TEMP — rejected in METHOD / ACTION / INTERFACE,
 *   - VAR_GLOBAL — allowed only in a GVL.
 * (The legacy NON_RETAIN heuristic is deliberately NOT ported — the compilers parse-cascade on bare
 * `VAR NON_RETAIN`, so a single clean message would false-positive against their error spray.)
 */
import type { TopLevel, VarSection } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkVarSectionPlacement(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    for (const section of unit.varSections) {
      const bad = misplacedSection(unit, section)
      if (bad === undefined) continue
      out.push({
        severity: "error",
        span: section.span,
        source: SOURCE,
        code: "var-section-placement",
        message: ctx.messages.sectionNotAllowed(bad),
      })
    }
  }
}

function misplacedSection(unit: TopLevel, section: VarSection): string | undefined {
  if (
    section.sectionKind === "VAR_TEMP" &&
    (unit.kind === "method" || unit.kind === "action" || unit.kind === "interface")
  ) {
    return "VAR_TEMP"
  }
  if (section.sectionKind === "VAR_GLOBAL" && unit.kind !== "global_var_list") return "VAR_GLOBAL"
  return undefined
}
