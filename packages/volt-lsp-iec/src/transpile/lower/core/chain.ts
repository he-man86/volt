/**
 * EXTENDS CHAINS — the one home of every walk down an EXTENDS in `lower/` (transpile-restructure 1.7.3, lean 10.1).
 *
 * Three MECHANISMS reach a base today, and each site keeps the one it used (phase 1 is output-neutral; whether they can
 * be one is task 6.B.3's question, and this list is its input):
 *
 * - BY THE BINDER'S LINK (`symbols.extendsChain`, a scope's `baseScope`): `chainNamesOf` (the field layout order and the
 *   FB_Init order) and `scopeChain` (`init/attributes.initMethod`).
 * - BY THE BODIES lowering queued (`lw.bodies`, by the base's upper-cased name): `bodyChain` — `chainOf` (a body's in-outs,
 *   `calls/routines.ts`), `init/attributes.pathFields`, `storage/addresses.addressSharedByInstances`. A base with no
 *   queued body ends it.
 * - BY NAME LOOKUP in the project (`lookup(project, base.text)`): `declaredChain` — `chainNames` and `pouChain`
 *   (`calls/routines.calledRoutine`'s in-outs), `init/fb-init.declaredArgs`, `interfaces/tags.implementsInterface`; and
 *   `interfaceChainOf` for an interface's EXTENDS list.
 *
 * Each walk visits a unit once: a cycle ends it where it closes. Three of the hand-written walks had no guard
 * (`pathFields`, `addressSharedByInstances`, `declaredArgs`) and `initMethod` neither — on a cycle they did not end, so no
 * answer depended on it; `implementsInterface` stopped after 32 steps, which `limit` keeps.
 */

import type { Lowering } from "./lowering.js"
import type { PendingBody } from "./shared.js"
import { extendsChain, lookup, type Scope } from "../../../frontend/symbols/index.js"
import type { Interface, TopLevel } from "../../../frontend/syntax/index.js"
import type { Type } from "../../../frontend/types/index.js"

type Unit = PendingBody["unit"]

/** An FB's base, if it EXTENDS one — a PROGRAM never does. */
export const baseOf = (unit: Unit) => (unit.kind === "function_block" ? unit.extends : undefined)

/**
 * BY THE BODIES: `unit` and its bases, NEAREST FIRST, each reached through the body lowering queued for it (`lw.bodies`).
 * `complete` is false when a base has no queued body or the chain comes back to a unit it holds.
 */
export function bodyChain(lw: Lowering, unit: Unit): { units: Unit[]; complete: boolean } {
  const units = [unit]
  for (let base = baseOf(unit); base !== undefined; ) {
    const pending = lw.bodies.get(base.text.toUpperCase())
    if (pending === undefined || units.includes(pending.unit)) return { units, complete: false }
    units.push(pending.unit)
    base = baseOf(pending.unit)
  }
  return { units, complete: true }
}

/** An FB unit and its bases, the root of the EXTENDS chain first — undefined when a base has no body to lower. */
export function chainOf(lw: Lowering, unit: Unit): Unit[] | undefined {
  const { units, complete } = bodyChain(lw, unit)
  return complete ? units.reverse() : undefined
}

/**
 * BY NAME LOOKUP: `start` and what it EXTENDS, NEAREST FIRST — each base the declaration `lookup` finds for an FB's
 * `EXTENDS` name, whatever kind it is; a unit reached again ends it, and so does `limit` units (`implementsInterface`'s
 * 32).
 */
export function declaredChain(lw: Lowering, start: TopLevel | undefined, limit = Infinity): TopLevel[] {
  const units: TopLevel[] = []
  for (let unit = start; unit !== undefined && units.length < limit && !units.includes(unit); ) {
    units.push(unit)
    const base = unit.kind === "function_block" ? unit.extends : undefined
    unit = base === undefined ? undefined : (lookup(lw.project, base.text)?.symbol.ast as TopLevel | undefined)
  }
  return units
}

/** The FB or PROGRAM named `name` and its bases by name lookup, NEAREST FIRST, while each is an FB or a PROGRAM and its
 *  NAME is new (two units of one name end it, as the name is what a caller compares). */
export function pouChain(lw: Lowering, name: string): Unit[] {
  const units: Unit[] = []
  const names = new Set<string>()
  for (const unit of declaredChain(lw, lookup(lw.project, name)?.symbol.ast as TopLevel | undefined)) {
    if ((unit.kind !== "function_block" && unit.kind !== "program") || names.has(unit.name.text.toUpperCase())) break
    names.add(unit.name.text.toUpperCase())
    units.push(unit)
  }
  return units
}

/** An FB's name and its EXTENDS chain's, upper-cased. */
export function chainNames(lw: Lowering, name: string): Set<string> {
  return new Set(pouChain(lw, name).map((unit) => unit.name.text.toUpperCase()))
}

/** An interface's declaration and every one it EXTENDS (by name lookup), itself first, depth first through each list. */
export function interfaceChainOf(lw: Lowering, name: string): Interface[] {
  const chain: Interface[] = []
  const visit = (n: string): void => {
    const ast = lookup(lw.project, n)?.symbol.ast
    if (ast?.kind !== "interface" || chain.includes(ast)) return
    chain.push(ast)
    for (const base of ast.extends ?? []) visit(base.text)
  }
  visit(name)
  return chain
}

/** BY THE BINDER'S LINK: a scope and the scopes it EXTENDS, NEAREST FIRST (`symbols.extendsChain` reversed). */
export function scopeChain(scope: Scope | undefined): Scope[] {
  return scope === undefined ? [] : extendsChain(scope).reverse()
}

/** An FB type's EXTENDS chain by name, BASE FIRST — the order its fields are laid out in, and its FB_Inits run in. The
 *  chain is the front-end's (`symbols` `extendsChain`: the bases the binder linked, a cycle ending it). */
export function chainNamesOf(t: Extract<Type, { kind: "function_block" }>): string[] {
  if (t.scope === undefined) throw new Error(`lowering bug: the FB type ${t.name} carries no scope`)
  return extendsChain(t.scope).map((s) => s.name)
}
