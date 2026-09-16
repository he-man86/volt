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
 * The reference may be a MEMBER (`obj.Prop`) or a BARE name, which is how the owning FB's own body names its own
 * property (conformance `cc2_property_lacks_getter`: `readBack := Level;` inside the FB that declares `Level`).
 * NOT inside that property's OWN accessor, where the bare name is the accessor's value — the incoming one in a SET,
 * the returned one in a GET — and not a read at all (conformance `use_fb_property_write`, which the IDE builds clean).
 *
 * Zero-FP: fires only when the reference resolves to a KNOWN project property whose `getter` is absent; a
 * library property (accessor info flattens across the wire) or any unresolved reference skips.
 */
import { walkStatements, walkAllExprs, type Expr } from "../../../syntax/index.js"
import { bodies, isLibrarySymbol, lookup, type Scope, type Symbol } from "../../../symbols/index.js"
import { resolveMemberChain } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkPropertyAccess(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { unit, scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    const ownAccessorOf = unit.kind === "property" ? unit.name.text.toLowerCase() : undefined
    const writeTargets = new Set<Expr>()
    walkStatements(statements, (s) => {
      if (s.kind === "assign") writeTargets.add(s.target)
    })
    walkAllExprs(statements, (e) => {
      if (writeTargets.has(e)) return // the LHS itself is a write, not a read
      if (e.kind === "ident_expr" && e.name.toLowerCase() === ownAccessorOf) return // the accessor's own value
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

/** The property symbol a reference denotes — `obj.Prop`, or a bare `Prop` inside the FB that declares it. */
function propertyRef(e: Expr, scope: Scope, project: Scope): Symbol | undefined {
  if (e.kind === "ident_expr") {
    const sym = lookup(scope, e.name)?.symbol
    return sym?.kind === "property" ? sym : undefined
  }
  if (e.kind !== "member") return undefined
  const sym = resolveMemberChain(e, scope, project)
  return sym?.kind === "property" ? sym : undefined
}
