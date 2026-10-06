/**
 * obsolete-usage (C0357 · declarations/). Use of a POU marked `{attribute 'obsolete' := 'msg'}` — "POU '<name>' has been
 * marked as obsolete: <msg>", ONCE PER USE, byte-identical on both vendors (frontend-conformance 2.7.2, recorded
 * 2026-10-02): a variable declared with an obsolete FB/PROGRAM/INTERFACE as its type (at the type), each call of such an
 * instance, each call of an obsolete FUNCTION, and each call of an obsolete METHOD or ACTION by its name
 * (`cp_obsolete_pou`, `prag_attribute_obsolete_fb_declared`, `_fb_called_twice`, `_function`, `_on_method`,
 * `_method_called_twice`), a STRUCT marked obsolete used as a variable's type, and an FB marked obsolete named in an
 * EXTENDS (`obs_struct_as_type`, `obs_fb_extended`, both vendors 2026-10-06). A PROPERTY marked obsolete and read says
 * nothing (`prag_attribute_on_property`).
 *
 * The attribute is the POU's AST node's (`syntax/pragmas/attributes`), reached through the symbol a name resolves to.
 * It used to come from a raw-text scan of the workspace (`workspace-refs`), which the conformance replay never ran — so
 * the check was never measured, and the recorder's dropped pragmas (fixed in 2.7.2) could not show it was right.
 */
import type { Attribute, Span } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { forEachDecl, forEachExpr, lookup, lookupUnit, type Scope, type Symbol } from "../../../frontend/symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

const INSTANCE_KINDS = new Set(["function_block", "program", "interface"])
const CALLED_KINDS = new Set(["function", "method", "action"])

/** A STRUCT type — the one DUT measured marked obsolete (an enum, an alias, a union were not asked). */
function isStruct(sym: Symbol): boolean {
  return sym.kind === "type" && "body" in sym.ast && sym.ast.body.kind === "struct"
}

/** The `obsolete` attribute's text on `sym`'s declaration, when it carries one with a value. */
function obsoleteText(sym: Symbol | undefined): string | undefined {
  if (sym === undefined || !("attributes" in sym.ast)) return undefined
  const attributes: readonly Attribute[] = sym.ast.attributes ?? []
  return attributes.find((a) => a.name.toLowerCase() === "obsolete")?.value
}

export function checkObsoleteUsage(ctx: CheckContext, out: DiagnosticItem[]): void {
  const flag = (span: Span, sym: Symbol, text: string) =>
    out.push({ severity: "warning", span, source: SOURCE, code: "obsolete-usage", message: ctx.messages.pouObsolete(sym.name, text) })
  /** The obsolete FB/PROGRAM/INTERFACE `typeName` names in `scope`, with its text. */
  const obsoleteType = (scope: Scope, typeName: string): { sym: Symbol; text: string } | undefined => {
    const sym = lookupUnit(scope, typeName)?.symbol
    const named = sym !== undefined && (INSTANCE_KINDS.has(sym.kind) || isStruct(sym))
    const text = named ? obsoleteText(sym) : undefined
    return text === undefined ? undefined : { sym: sym!, text }
  }

  // A variable declared with an obsolete POU as its type.
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.type.kind !== "named_type" || decl.type.qualifiers !== undefined) continue
    const hit = obsoleteType(scope, decl.type.name.text)
    if (hit !== undefined) flag(decl.type.span, hit.sym, hit.text)
  }
  // An FB that EXTENDS an obsolete FB names it there.
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "function_block" || unit.extends === undefined) continue
    const sym = lookupUnit(ctx.project, unit.extends.text)?.symbol
    const text = sym?.kind === "function_block" ? obsoleteText(sym) : undefined
    if (text !== undefined) flag(unit.extends.span, sym!, text)
  }
  // A call by name: of an obsolete FUNCTION, METHOD or ACTION, or of an instance of an obsolete FB.
  forEachExpr(ctx.parseResult, ctx.project, (e, scope) => {
    if (e.kind !== "call" || e.callee.kind !== "ident_expr") return
    const sym = lookup(scope, e.callee.name)?.symbol
    if (sym === undefined) return
    if (CALLED_KINDS.has(sym.kind)) {
      const text = obsoleteText(sym)
      if (text !== undefined) flag(e.callee.span, sym, text)
      return
    }
    const type = sym.typeExpr
    if (type?.kind !== "named_type" || type.qualifiers !== undefined) return
    const hit = obsoleteType(sym.owner, type.name.text)
    if (hit !== undefined) flag(e.callee.span, hit.sym, hit.text)
  })
}
