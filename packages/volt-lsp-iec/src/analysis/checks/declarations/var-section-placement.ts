/**
 * var-section-placement (D.2 · declarations/). Flags a VAR-section kind not allowed for the containing POU:
 *   - VAR_TEMP — rejected in METHOD / ACTION / INTERFACE (C0174); allowed in FUNCTION (live-calibrated),
 *   - VAR_GLOBAL — allowed only in a GVL (C0169),
 *   - VAR_CONFIG — allowed only in a config list, never in a POU (C0168, its own docs-exact message).
 * (The legacy NON_RETAIN heuristic is deliberately NOT ported — the compilers parse-cascade on bare
 * `VAR NON_RETAIN`, so a single clean message would false-positive against their error spray.)
 */
import type { TopLevel, VarSection } from "../../../syntax/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

const POU_KINDS = new Set(["program", "function", "function_block", "method", "action"])

export function checkVarSectionPlacement(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    for (const section of unit.varSections) {
      if (section.sectionKind === "VAR_CONFIG" && POU_KINDS.has(unit.kind)) {
        out.push({
          severity: "error",
          span: section.span,
          source: SOURCE,
          code: "misplaced-var-config",
          message: ctx.messages.varConfigOnlyInList(), // C0168
        })
        continue
      }
      if ((section.retain === true || section.persistent === true) && (unit.kind === "function" || unit.kind === "method")) {
        out.push({
          severity: "error",
          span: section.span,
          source: SOURCE,
          code: "retain-not-allowed",
          message: ctx.messages.retainNotAllowedHere(), // C0175
        })
        continue
      }
      const bad = misplacedSection(unit, section)
      if (bad === undefined) continue
      out.push({
        severity: "error",
        span: section.span,
        source: SOURCE,
        code: "var-section-placement",
        message: ctx.messages.sectionNotAllowed(bad), // C0169 / C0174
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
