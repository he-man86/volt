/**
 * abstract-instantiation (D.2 · oop/). Declaring an instance of an ABSTRACT FB (`x : FB_Abstract;`) —
 * both vendors reject it. Conservative: only a named-type decl resolving to a project FB symbol whose AST carries
 * `abstract`; pointers/references of an abstract FB and library FBs skip.
 *
 * AN ARRAY'S ELEMENT IS AN INSTANCE (`arr : ARRAY[1..2] OF FB_Abs`, `oopb_abstract_array`) and so is a VAR_INPUT
 * (`oopb_abstract_as_input`); a VAR_IN_OUT binds somebody else's instance and instantiates nothing
 * (`oopb_abstract_assign_inout`, where only the assignment through it is refused) — analysis-conformance 3.7, CODESYS
 * 2026-10-06.
 */
import type { FunctionBlock } from "../../../frontend/syntax/index.js"
import { forEachDecl, lookupLocal } from "../../../frontend/symbols/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkAbstractInstantiation(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { section, decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (section.sectionKind === "VAR_IN_OUT") continue
    let type = decl.type
    while (type.kind === "array_type") type = type.element
    if (type.kind !== "named_type") continue
    const name = type.name.text
    const fbSym = lookupLocal(ctx.project, name).find((s) => s.kind === "function_block")
    if (fbSym === undefined || !(fbSym.ast as FunctionBlock).modifiers.includes("ABSTRACT")) continue
    for (const id of decl.names) {
      out.push({
        severity: "error",
        span: id.span,
        source: SOURCE,
        code: "abstract-instantiation",
        message: ctx.messages.abstractInstantiation(name),
      })
    }
  }
}
