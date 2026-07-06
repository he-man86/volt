/**
 * abstract-instantiation (D.2 · oop/). Declaring an instance of an ABSTRACT FB (`x : FB_Abstract;`) —
 * both vendors reject it. Conservative: only a DIRECT named-type decl resolving to a project FB
 * symbol whose AST carries `abstract`; arrays/pointers of an abstract FB and library FBs skip.
 */
import type { FunctionBlock } from "../../../syntax/index.js"
import { lookupLocal } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkAbstractInstantiation(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    for (const section of unit.varSections) {
      for (const decl of section.decls) {
        if (decl.type.kind !== "named_type") continue
        const name = decl.type.name.text
        const fbSym = lookupLocal(ctx.project, name).find((s) => s.kind === "function_block")
        if (fbSym === undefined || (fbSym.ast as FunctionBlock).abstract !== true) continue
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
  }
}
