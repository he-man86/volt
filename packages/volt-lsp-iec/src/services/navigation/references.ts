/**
 * references (Layer E · E.2). Type-aware: resolve the target symbol at the cursor, then keep only the
 * occurrences that bind to the SAME symbol (by identity) — so `motor.Start` doesn't match every `Start`.
 * This is what makes rename safe. Powers references, highlight, and rename.
 *
 * A member-access chain resolves through `types/resolveMemberChain`; a bare ident through scope lookup.
 * The `.member` IdentExpr of a chain is NOT counted as a standalone ident (it's covered by the member node).
 */
import { walkAllExprs, type IdentExpr } from "../../syntax/index.js"
import { lookup, resolveBareEnumMember, type Scope, type Symbol } from "../../symbols/index.js"
import { resolveMemberChain } from "../../types/index.js"
import { rangeFromSpan, stBodies, type Document } from "../shared/index.js"
import type { Location, Range } from "vscode-languageserver-protocol"

export interface Ref {
  uri: string
  range: Range
}

/** Every occurrence (declaration + body uses) across `docs` that binds to `target`. */
export function findReferences(docs: Iterable<Document>, project: Scope, target: Symbol): Ref[] {
  const out: Ref[] = [{ uri: target.uri, range: rangeFromSpan(target.span) }] // the declaration itself
  for (const doc of docs) {
    for (const { scope, statements } of stBodies(doc, project)) {
      const memberNames = new Set<IdentExpr>()
      walkAllExprs(statements, (e) => {
        if (e.kind === "member") memberNames.add(e.member)
      })
      walkAllExprs(statements, (e) => {
        if (e.kind === "member") {
          if (resolveMemberChain(e, scope, project) === target) {
            out.push({ uri: doc.uri, range: rangeFromSpan(e.member.span) })
          }
        } else if (e.kind === "ident_expr" && !memberNames.has(e)) {
          const s = lookup(scope, e.name)?.symbol ?? resolveBareEnumMember(project, e.name)
          if (s === target) out.push({ uri: doc.uri, range: rangeFromSpan(e.span) })
        }
      })
    }
  }
  return out
}

export function toLocations(refs: readonly Ref[]): Location[] {
  return refs.map((r) => ({ uri: r.uri, range: r.range }))
}
