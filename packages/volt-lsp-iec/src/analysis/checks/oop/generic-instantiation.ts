/**
 * generic-instantiation (oop/). A function block with a VAR_GENERIC CONSTANT section is instanced with its values in
 * angle brackets, `inst : FB_X<6>;` — one per generic constant. An instance with another count is refused (CODESYS SP21,
 * `decl_var_generic_no_argument`, 2026-10-01):
 *
 *   Generic Functionblock 'FB_X' expects exactly '1' number of Generic Constant Definitions
 *
 * Measured with NO values and with TWO against one constant (`decl_var_generic_two_values`): the same message, the count
 * being the FB's; an ARRAY OF the FB is counted by its element the same way (`decl_var_generic_in_array_no_argument`,
 * `_two_values`, CODESYS 2026-10-01). A value list the parser refused (`NamedType.genericRefused`) is not counted — it was not read. TwinCAT has no VAR_GENERIC (`lex/vocabulary` `CODESYS_ONLY_KEYWORDS`), so no FB there has a generic
 * constant and this never fires. Never a VAR_IN_OUT or VAR_EXTERNAL, which bind to somebody else's instance.
 */
import { forEachDecl } from "../../../frontend/symbols/index.js"
import { resolveTypeExpr } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkGenericInstantiation(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { section, decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (section.sectionKind === "VAR_IN_OUT" || section.sectionKind === "VAR_EXTERNAL") continue
    // an ARRAY's element is an instance too, counted alike (`decl_var_generic_in_array_no_argument`, `_two_values`)
    let named = decl.type
    while (named.kind === "array_type") named = named.element
    if (named.kind !== "named_type" || named.genericRefused) continue
    const type = resolveTypeExpr(named, ctx.project, 0, ctx.project, ctx.uri)
    if (type.kind !== "function_block" || type.scope === undefined) continue
    const generics = [...type.scope.symbols.values()].flat().filter((s) => s.owner === type.scope && s.varSection === "VAR_GENERIC").length
    if (generics === 0 || (named.genericArgs?.length ?? 0) === generics) continue
    out.push({
      severity: "error",
      span: named.span,
      source: SOURCE,
      code: "generic-instantiation",
      message: ctx.messages.genericCount(type.name, generics),
    })
  }
}
