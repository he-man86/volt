/**
 * property-access (C0143 · oop/). A property READ where the property has no GET accessor — a set-only
 * property cannot be used as a value. CODESYS: "The property '<name>' cannot be used in this context
 * because it lacks the get accessor".
 *
 * Read vs. write: the ONLY write position for a property is the direct left-hand side of an assignment
 * (`x.Prop := …`). Every other occurrence — an RHS value, an index/condition/argument sub-expression, even
 * a sub-expression nested inside an assignment target — is a read. So we skip exactly the assignment-target
 * nodes and treat all remaining property references as reads.
 *
 * Zero-FP: fires only when the reference resolves to a KNOWN project property whose `getter` is absent; a
 * library property (accessor info flattens across the wire) or any unresolved reference skips.
 */
import { walkStatements, walkAllExprs, type Expr } from "../../../syntax/index.js"
import { bodies, type Scope, type Symbol } from "../../../symbols/index.js"
import { resolveMemberChain } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { isLibrarySymbol, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkPropertyAccess(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    const writeTargets = new Set<Expr>()
    walkStatements(statements, (s) => {
      if (s.kind === "assign") writeTargets.add(s.target)
    })
    walkAllExprs(statements, (e) => {
      if (writeTargets.has(e)) return // the LHS itself is a write, not a read
      const sym = propertyRef(e, scope, ctx.project)
      if (sym === undefined || sym.ast?.kind !== "property" || sym.ast.getter !== undefined || isLibrarySymbol(sym)) return
      out.push({
        severity: "error",
        span: e.span,
        source: SOURCE,
        code: "property-lacks-getter",
        message: ctx.messages.propertyLacksGetter(sym.name),
      })
    })
  }
}

/** The property symbol a member reference (`obj.Prop`) denotes, else undefined. */
function propertyRef(e: Expr, scope: Scope, project: Scope): Symbol | undefined {
  if (e.kind !== "member") return undefined
  const sym = resolveMemberChain(e, scope, project)
  return sym?.kind === "property" ? sym : undefined
}
