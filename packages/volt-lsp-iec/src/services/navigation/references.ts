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
import { bareEnumMember, lookup, type Scope, scopeForUnit, sourceBodies, type Symbol } from "../../frontend/symbols/index.js"
import { resolveMemberChain } from "../../frontend/types/index.js"
import { rangeFromSpan } from "../shared/index.js"
import type { Location, Range } from "vscode-languageserver-protocol"
import type { Document } from "../shared/index.js"

export interface Ref {
  uri: string
  range: Range
}

/** The symbols a reference search asks for, and the names they are written by (a name no target has is not resolved). */
interface Targets {
  has(sym: Symbol | undefined): boolean
  named(name: string): boolean
  all: readonly Symbol[]
}

/** One symbol, or several — an override chain, whose members a rename edits together (`override-chain`, B6). */
export function targetsOf(target: Symbol | readonly Symbol[]): Targets {
  const all = Array.isArray(target) ? (target as readonly Symbol[]) : [target as Symbol]
  const set = new Set(all)
  const names = new Set(all.map((s) => s.name.toLowerCase()))
  return { has: (s) => s !== undefined && set.has(s), named: (n) => names.has(n.toLowerCase()), all }
}

/** Every occurrence (declaration + body uses) across `docs` that binds to `target` (or to any of several). */
export function findReferences(docs: Iterable<Document>, project: Scope, target: Symbol | readonly Symbol[]): Ref[] {
  const t = targetsOf(target)
  const out: Ref[] = t.all.map((s) => ({ uri: s.uri, range: rangeFromSpan(s.span) })) // the declarations themselves
  for (const doc of docs) {
    for (const { scope, statements } of sourceBodies(doc.parseResult.units, project)) {
      const memberNames = new Set<IdentExpr>()
      walkAllExprs(statements, (e) => {
        if (e.kind === "member") memberNames.add(e.member)
      })
      walkAllExprs(statements, (e) => {
        if (e.kind === "member") {
          if (t.named(e.member.name) && t.has(resolveMemberChain(e, scope, project))) {
            out.push({ uri: doc.uri, range: rangeFromSpan(e.member.span) })
          }
        } else if (e.kind === "global_expr") {
          // `.g` — the global past every local (rule E33): renaming `g` without it leaves "no global definition for 'g'"
          if (t.named(e.name.name) && t.has(resolveMemberChain(e, scope, project))) out.push({ uri: doc.uri, range: rangeFromSpan(e.name.span) })
        } else if (e.kind === "ident_expr" && !memberNames.has(e) && t.named(e.name)) {
          const s = lookup(scope, e.name)?.symbol ?? bareEnumMember(scope, e.name)
          if (t.has(s)) out.push({ uri: doc.uri, range: rangeFromSpan(e.span) })
        }
      })
    }
    // Type positions — `inst : T`, `EXTENDS T`, `IMPLEMENTS T`, return/field/alias types. Bodies above never
    // see these, so without this a type rename leaves its declaration uses stale (broken project).
    for (const unit of allUnits(doc.parseResult.units)) {
      const uscope = scopeForUnit(project, unit) ?? project
      for (const ref of unitTypeNameRefs(unit)) {
        if (ref.qualified) continue // `NS.T` keys on the last segment; skip to avoid cross-namespace collisions
        if (t.named(ref.name) && t.has(lookup(uscope, ref.name)?.symbol)) out.push({ uri: doc.uri, range: rangeFromSpan(ref.span) })
      }
    }
  }
  return out
}

export function toLocations(refs: readonly Ref[]): Location[] {
  return refs.map((r) => ({ uri: r.uri, range: r.range }))
}
