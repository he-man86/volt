/**
 * references (Layer E · E.2). Type-aware: resolve the target symbol at the cursor, then keep only the
 * occurrences that bind to the SAME symbol (by identity) — so `motor.Start` doesn't match every `Start`.
 * This is what makes rename safe. Powers references, highlight, and rename.
 *
 * It walks the bodies AS WRITTEN (`sourceBodies`): a use in a conditional branch not taken, or in a body whose condition
 * the LSP cannot decide, is still text a rename must edit — it compiles again when the condition flips.
 *
 * A member-access chain (and a `.g` through the global namespace) resolves through `types/resolveMemberChain`; a bare
 * ident through scope lookup.
 * The `.member` IdentExpr of a chain is NOT counted as a standalone ident (it's covered by the member node).
 */
import { allUnits, type IdentExpr, walkAllExprs } from "../../frontend/syntax/index.js"
import { unitTypeNameRefs } from "./type-refs.js"
import { lookup, resolveBareEnumMember, type Scope, scopeForUnit, sourceBodies, type Symbol } from "../../frontend/symbols/index.js"
import { resolveMemberChain } from "../../frontend/types/index.js"
import { rangeFromSpan } from "../shared/index.js"
import type { Location, Range } from "vscode-languageserver-protocol"
import type { Document } from "../shared/index.js"

export interface Ref {
  uri: string
  range: Range
}

/** Every occurrence (declaration + body uses) across `docs` that binds to `target`. */
export function findReferences(docs: Iterable<Document>, project: Scope, target: Symbol): Ref[] {
  const out: Ref[] = [{ uri: target.uri, range: rangeFromSpan(target.span) }] // the declaration itself
  for (const doc of docs) {
    for (const { scope, statements } of sourceBodies(doc.parseResult.units, project)) {
      const memberNames = new Set<IdentExpr>()
      walkAllExprs(statements, (e) => {
        if (e.kind === "member") memberNames.add(e.member)
      })
      walkAllExprs(statements, (e) => {
        if (e.kind === "member") {
          if (resolveMemberChain(e, scope, project) === target) {
            out.push({ uri: doc.uri, range: rangeFromSpan(e.member.span) })
          }
        } else if (e.kind === "global_expr") {
          // `.g` — the global past every local (rule E33): renaming `g` without it leaves "no global definition for 'g'"
          if (resolveMemberChain(e, scope, project) === target) out.push({ uri: doc.uri, range: rangeFromSpan(e.name.span) })
        } else if (e.kind === "ident_expr" && !memberNames.has(e)) {
          const s = lookup(scope, e.name)?.symbol ?? resolveBareEnumMember(project, e.name)
          if (s === target) out.push({ uri: doc.uri, range: rangeFromSpan(e.span) })
        }
      })
    }
    // Type positions — `inst : T`, `EXTENDS T`, `IMPLEMENTS T`, return/field/alias types. Bodies above never
    // see these, so without this a type rename leaves its declaration uses stale (broken project).
    for (const unit of allUnits(doc.parseResult.units)) {
      const uscope = scopeForUnit(project, unit) ?? project
      for (const ref of unitTypeNameRefs(unit)) {
        if (ref.qualified) continue // `NS.T` keys on the last segment; skip to avoid cross-namespace collisions
        if (lookup(uscope, ref.name)?.symbol === target) out.push({ uri: doc.uri, range: rangeFromSpan(ref.span) })
      }
    }
  }
  return out
}

export function toLocations(refs: readonly Ref[]): Location[] {
  return refs.map((r) => ({ uri: r.uri, range: r.range }))
}
