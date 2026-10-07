/**
 * EXTENDS chains as lowering walks them: an FB unit and its bases, a type's chain by name.
 */

import { baseOf, type Lowering, type PendingBody } from "../lowering.js"
import { extendsChain, lookup } from "../../../frontend/symbols/index.js"
import type { TopLevel } from "../../../frontend/syntax/index.js"
import type { Type } from "../../../frontend/types/index.js"

/** An FB unit and its bases, the root of the EXTENDS chain first — undefined when a base has no body to lower. */
export function chainOf(lw: Lowering, unit: PendingBody["unit"]): PendingBody["unit"][] | undefined {
  const chain = [unit]
  for (let base = baseOf(unit); base !== undefined; ) {
    const pending = lw.bodies.get(base.text.toUpperCase())
    if (pending === undefined || chain.includes(pending.unit)) return undefined
    chain.unshift(pending.unit)
    base = baseOf(pending.unit)
  }
  return chain
}

/** An FB's name and its EXTENDS chain's, upper-cased. */
export function chainNames(lw: Lowering, name: string): Set<string> {
  const names = new Set<string>()
  for (let unit = lookup(lw.project, name)?.symbol.ast as TopLevel | undefined; unit !== undefined && (unit.kind === "function_block" || unit.kind === "program") && !names.has(unit.name.text.toUpperCase()); ) {
    names.add(unit.name.text.toUpperCase())
    const base = unit.kind === "function_block" ? unit.extends : undefined
    unit = base === undefined ? undefined : (lookup(lw.project, base.text)?.symbol.ast as TopLevel | undefined)
  }
  return names
}

/** An FB type's EXTENDS chain by name, BASE FIRST — the order its fields are laid out in, and its FB_Inits run in. The
 *  chain is the front-end's (`symbols` `extendsChain`: the bases the binder linked, a cycle ending it). */
export function chainNamesOf(t: Extract<Type, { kind: "function_block" }>): string[] {
  if (t.scope === undefined) throw new Error(`lowering bug: the FB type ${t.name} carries no scope`)
  return extendsChain(t.scope).map((s) => s.name)
}
