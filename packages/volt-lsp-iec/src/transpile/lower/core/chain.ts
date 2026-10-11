/**
 * EXTENDS CHAINS — the one home of every walk down an EXTENDS in `lower/` (transpile-restructure 1.7.3, lean 10.1).
 *
 * Three MECHANISMS reach a base, and each answers its own question, so they stay three (6.B.3: no site keeps a parameter;
 * `implementsInterface`'s 32-unit cap went — the cycle guard below ends every walk):
 *
 * - the BINDER'S LINK is the TYPE's chain: the order the fields lie in and the FB_Inits run in, the members a type has.
 * - the QUEUED BODIES are what lowering can RUN: a base with no queued body (a library FB, one that did not prepare) is
 *   a refusal (`brokenAtLibrary`), not a shorter chain — the binder's link does not say whether lowering holds a body.
 * - NAME LOOKUP reads the DECLARATION — the AST a scope does not carry: a field's FB_Init arguments (`declaredArgs`, a
 *   STRUCT's too), a unit's IMPLEMENTS list, an interface's EXTENDS list.
 *
 * The sites:
 *
 * - BY THE BINDER'S LINK (`symbols.extendsChain`, a scope's `baseScope`): `chainNamesOf` (the field layout order and the
 *   FB_Init order) and `scopeChain` (`init/attributes.initMethod`).
 * - BY THE BODIES lowering queued (`lw.bodies`, by the base's upper-cased name): `bodyChain` — `chainOf` (a body's in-outs,
 *   `calls/routines.ts`), `init/attributes.pathFields`, `storage/addresses.addressSharedByInstances`. A base with no
 *   queued body ends it.
 * - BY NAME LOOKUP in the project (`lookup(project, base.text)`): `declaredChain` — `chainNames` and `pouChain`
 *   (`calls/routines.calledRoutine`'s in-outs), `init/fb-init.declaredArgs`, `interfaces/tags.implementsInterface`;
 *   `declaredTypeChain`, which a STRUCT's EXTENDS continues too (`init/initial-values.fieldWritten`, the declaration a
 *   field is written with); and `interfaceChainOf` for an interface's EXTENDS list.
 *
 * Each walk visits a unit once: a cycle ends it where it closes. Three of the hand-written walks had no guard
 * (`pathFields`, `addressSharedByInstances`, `declaredArgs`) and `initMethod` neither — on a cycle they did not end, so no
 * answer depended on it; `implementsInterface` stopped after 32 steps, a cap the guard made redundant (6.B.3).
 */

import type { Lowering } from "./lowering.js"
import type { PendingBody } from "./shared.js"
import { extendsChain, lookup, scopeForUnit, type Scope } from "../../../frontend/symbols/index.js"
import type { Interface, TopLevel } from "../../../frontend/syntax/index.js"
import type { Type } from "../../../frontend/types/index.js"
import { libraryOf } from "../../../frontend/library/index.js"

type Unit = PendingBody["unit"]

/** An FB's base, if it EXTENDS one — a PROGRAM never does. */
export const baseOf = (unit: Unit) => (unit.kind === "function_block" ? unit.extends : undefined)

/** The interfaces a unit's own IMPLEMENTS list names, in source order — a PROGRAM implements none, and a base FB's list
 *  is not included (walk the EXTENDS chain for those). */
export const implementsOf = (unit: Unit | TopLevel) => (unit.kind === "function_block" ? (unit.implements ?? []) : [])

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
 * WHY `bodyChain` STOPPED SHORT (openspec transpile-refusal-classification 2.1): true when at a base the BINDER linked to an
 * FB that lowering holds no body for — a library FB (`unit_fb_extends_qualified`, `rk_super_base_library`: CODESYS builds
 * both), refused `call-library`, valid ST not built. False at a base no FB declaration resolves (nothing, an interface, a
 * STRUCT), or an EXTENDS that comes back to a unit already on the chain — `base-unresolved`, which both vendors refuse ("No
 * definition found for base class", "Recursion in base function block list": `inh_unresolved_base`,
 * `oopa_extends_interface`, `oopa_extends_struct`, `inh_extends_cycle`).
 */
export function brokenAtLibrary(lw: Lowering, unit: Unit): boolean {
  const { units } = bodyChain(lw, unit)
  const last = units[units.length - 1]!
  const base = baseOf(last)
  if (base === undefined || lw.bodies.has(base.text.toUpperCase())) return false
  return scopeForUnit(lw.project, last)?.baseScope?.kind === "pou"
}

/**
 * BY NAME LOOKUP: `start` and what it EXTENDS, NEAREST FIRST — each base the declaration `lookup` finds for an FB's
 * `EXTENDS` name, whatever kind it is; a unit reached again ends it.
 */
export function declaredChain(lw: Lowering, start: TopLevel | undefined): TopLevel[] {
  const units: TopLevel[] = []
  for (let unit = start; unit !== undefined && !units.includes(unit); ) {
    units.push(unit)
    const base = unit.kind === "function_block" ? unit.extends : undefined
    unit = base === undefined ? undefined : (lookup(lw.project, base.text)?.symbol.ast as TopLevel | undefined)
  }
  return units
}

/**
 * BY NAME LOOKUP, A TYPE'S DECLARATIONS: the FB, PROGRAM or STRUCT named `name` and what it EXTENDS — an FB's base, or a
 * STRUCT's — NEAREST FIRST, while each name finds a declaration; a name reached again ends it.
 */
export function declaredTypeChain(lw: Lowering, name: string): TopLevel[] {
  const units: TopLevel[] = []
  const names = new Set<string>()
  for (let at: string | undefined = name; at !== undefined && !names.has(at.toUpperCase()); ) {
    names.add(at.toUpperCase())
    const unit = lookup(lw.project, at)?.symbol.ast as TopLevel | undefined
    if (unit === undefined) break
    units.push(unit)
    at = unit.kind === "function_block" ? unit.extends?.text : unit.kind === "type_decl" && unit.body.kind === "struct" ? unit.body.extends?.text : undefined
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

/**
 * WHETHER A LIBRARY'S DECLARATION IS ON A CHAIN — the FB `fb` or any base it EXTENDS, or the interface `itf` or any it
 * EXTENDS, materialized from a compiled library (`libraryOf`). Such a declaration can lack what CODESYS knows of the element:
 * an FB's IMPLEMENTS list (awa-palletizer `L_IMHP_MODULEHANDLER.pou`), an interface's METHODs, written after its
 * END_INTERFACE (pro2193 `IADDLOG.itf`). A refusal that rests on what such a chain DOES NOT declare is
 * `library-declaration`, not the `invalid` the same absence means in the project (transpile-refusal-classification 2.1).
 */
export function libraryOnChain(lw: Lowering, of: { fb: string } | { itf: string }): boolean {
  const units: { name: { text: string } }[] =
    "fb" in of ? declaredChain(lw, lookup(lw.project, of.fb)?.symbol.ast as TopLevel | undefined).filter((u) => "name" in u) as { name: { text: string } }[] : interfaceChainOf(lw, of.itf)
  return units.some((u) => {
    const sym = lookup(lw.project, u.name.text)?.symbol
    return sym !== undefined && libraryOf(sym) !== undefined
  })
}
