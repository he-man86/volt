/**
 * var-section-placement (D.2 · declarations/). Flags a VAR-section kind not allowed for the containing POU:
 *   - VAR_TEMP — rejected in METHOD / ACTION / INTERFACE (C0174); allowed in FUNCTION (live-calibrated),
 *   - VAR_GLOBAL — allowed only in a GVL (C0169),
 *   - VAR_CONFIG — allowed only in a config list, never in a POU (C0168, its own docs-exact message).
 *   - VAR NON_RETAIN — CODESYS has no such section: it reads NON_RETAIN as the first variable's NAME, then wants
 *     `, AT or :` and finds the real one. The section is LOST, so every name in it is undefined at every use and the
 *     holes carry on from there (conformance `var_non_retain`: five errors for one declaration).
 *
 * That last rule was refused once — "the compilers parse-cascade, so a single clean message would false-positive
 * against their error spray". The spray is what the LSP emits now, so the objection is spent.
 */
import type { TopLevel, VarSection } from "../../../syntax/index.js"
import { reportLostUses } from "../../lost-declaration.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

const POU_KINDS = new Set(["program", "function", "function_block", "method", "action"])

export function checkVarSectionPlacement(ctx: CheckContext, out: DiagnosticItem[]): void {
  const lost = new Set<string>()
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
      // CODESYS-only: TwinCAT is unmeasured here, and a guess would be a new false positive.
      if (section.sectionKind === "VAR" && section.nonRetain === true && ctx.config.vendor === "codesys") {
        const first = section.decls[0]?.names[0]
        if (first !== undefined) {
          out.push({
            severity: "error",
            span: first.span,
            source: SOURCE,
            code: "var-section-placement",
            message: ctx.messages.commaAtOrColonExpected(first.text),
          })
          for (const decl of section.decls) for (const name of decl.names) lost.add(name.text.toLowerCase())
        }
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
  reportLostUses(ctx, out, lost)
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
