/**
 * obsolete-usage (C0357 · declarations/). Use of a POU marked `{attribute 'obsolete' := 'msg'}` — CODESYS warns
 * "POU '<name>' has been marked as obsolete: <msg>" at each use. Verified live against CODESYS 3.5.21.
 *
 * The obsolete set comes from the workspace scan (`ctx.references.obsoletePous`) — the attribute is parser trivia,
 * so it's collected from raw file text, not the AST. Two use sites fire:
 *   - a variable whose declared TYPE is an obsolete FB/PROGRAM/INTERFACE (`inst : OldFB`), at the type span;
 *   - a direct call to an obsolete FUNCTION (`OldFn()`), at the callee span.
 *
 * Zero-FP: fires only on an exact name match against a POU carrying the explicit attribute, and PLC item names are
 * unique project-wide (the protocol invariant), so a name in the obsolete set is that POU. Empty set ⇒ nothing.
 */
import type { Span } from "../../../syntax/span.js"
import type { CheckContext } from "../../diagnostics.js"
import { forEachDecl, forEachExpr, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkObsoleteUsage(ctx: CheckContext, out: DiagnosticItem[]): void {
  const obsolete = ctx.references.obsoletePous
  if (obsolete.size === 0) return
  const flag = (span: Span, entry: { name: string; message: string }) =>
    out.push({
      severity: "warning",
      span,
      source: SOURCE,
      code: "obsolete-usage",
      message: ctx.messages.pouObsolete(entry.name, entry.message),
    })

  // A variable declared with an obsolete POU as its type.
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (decl.type.kind !== "named_type") continue
    const entry = obsolete.get(decl.type.name.text.toLowerCase())
    if (entry !== undefined) flag(decl.type.span, entry)
  }
  // A direct call to an obsolete FUNCTION.
  forEachExpr(ctx.parseResult, ctx.project, (e) => {
    if (e.kind !== "call" || e.callee.kind !== "ident_expr") return
    const entry = obsolete.get(e.callee.name.toLowerCase())
    if (entry !== undefined) flag(e.callee.span, entry)
  })
}
