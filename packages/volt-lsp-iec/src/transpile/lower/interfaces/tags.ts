/**
 * INTERFACE variables (design §22, conformance `itf_*`). An interface variable holds the TAG of the FB instance it names —
 * 0 for none, as it starts (`itf_call_dispatches_on_instance`) — and a call through it dispatches on that tag to the
 * METHOD or PROPERTY accessor of each instance it may name. Tags are given per lowered POU, to instance places, so a copy
 * between two interface variables (`itf_extends_assigns_to_base`) is a plain copy of the tag.
 *
 * Which instances a variable may name is recorded as stores lower: an instance's tag, or an edge from the variable it
 * was copied from. The arms of a call are filled in only when the whole POU has lowered (`finishInterfaces`) — a store
 * later in the source reaches a call earlier in it on the next cycle, so source order proves nothing. An arm on an
 * instance of another frame reaches it as a `lent` place: the body is lent a `&mut` of that instance per call, and each
 * caller passes it from its own frame or from what it was lent in turn (design §24) — an FB's interface input is kept
 * like any input (`itf_fb_input_left_out`), so its instances are lent at every call of the FB, not only the one that
 * gave them. The POU itself has no caller to lend it one (`interface-context`).
 *
 * A tag names an instance by its place in a FRAME — for an FB's frame, a field of whichever instance runs — so a tag of
 * an FB frame means something only with the instance that stored it (review of the interface-input batch, 2026-09-15:
 * `x2(shape := x1.mine)` answered for x2's field). It may therefore not cross to another instance: an interface is read
 * and dispatched only through the frame's own variables; a value written through another instance (an in-out, a lent
 * instance, a global) is FOREIGN, and an FB-frame tag arriving foreign is refused (`interface-instance-relative`), as is
 * lending one to a call whose receiver is not the caller's own. A tag of the POU itself names its one instance and moves
 * freely. The shape the corpus uses — a parent handing its own child its own field — stays exact: the child is always
 * called by the instance that wrote it.
 *
 * Not built yet, and refused: an interface bound as an in-out or output, an interface argument of a call made through an
 * interface, a METHOD with a VAR_IN_OUT or VAR_OUTPUT called through one, an instance that is a local, an in-out, a
 * dereference or reached through a runtime index, an instance lent to a call that already holds it, and one FB type given
 * interface inputs from two frames — its instances are lent per TYPE, so every caller would have to lend both frames'
 * (`interface-context`; a limitation, not recorded behaviour).
 */

import { GLOBAL_CONTEXT } from "../core/keys.js"
import type { Type } from "../../../frontend/types/index.js"
import type { FbType, Lowering } from "../core/lowering.js"
import type { Expr, Span, TopLevel } from "../../../frontend/syntax/index.js"
import { lookup } from "../../../frontend/symbols/index.js"
import type { IrExpr, IrStmt, Place } from "../../ir/index.js"
import { sameTarget, staticPath } from "../places/path.js"
import { instanceFieldKey, pointerKey } from "../pointers/state.js"
import { foreignWrite } from "./query.js"
import { lowerPlace } from "../places/places.js"
import { storageOf } from "../storage/layout.js"
import { heldAt } from "./lend.js"
import { interfaceTables } from "./state.js"
import { declaredChain, implementsOf, interfaceChainOf, libraryOnChain } from "../core/chain.js"
import { indexOfTag, NO_TAG, tagOfIndex } from "../core/tags.js"

/** Whether the FB, or a base FB of it, IMPLEMENTS the interface — itself or one that EXTENDS it. */
export function implementsInterface(lw: Lowering, fb: string, itf: string): boolean {
  const wanted = itf.toUpperCase()
  for (const ast of declaredChain(lw, lookup(lw.project, fb)?.symbol.ast as TopLevel | undefined)) {
    if (ast.kind !== "function_block") return false
    if (implementsOf(ast).some((i) => interfaceChainOf(lw, i.text).some((a) => a.name.text.toUpperCase() === wanted))) return true
  }
  return false
}

/** The tag of an FB instance an interface is given — its handle (`instanceHandle`), for an instance an interface can hold. */
function tagOf(lw: Lowering, place: Place, fb: FbType, span: Span): number | undefined {
  const tracked =
    place.guard === undefined &&
    (place.root === undefined || place.root === "this" || place.root === "global") &&
    staticPath(place)
  if (!tracked) return lw.bail("interface-instance", "an interface stored with a local, an in-out, a dereference or an element at a runtime index", span)
  return instanceHandle(lw, place, fb)
}

/**
 * THE INSTANCE HANDLE (transpile-restructure 4.14, design.md §3.3 step 4f): one numbering of the FB instances a POU's
 * values may name — an interface's (`tagOf`) and a pointer's or reference's to a whole instance (`pointers/state.ts`
 * `recordTarget`) alike — given at the first store, 1 and up (`core/tags.ts`). One numbering, so a value means the same
 * instance whichever variable holds it. The instance is named by its place in a context: a GVL's, a routine's locals,
 * or the frame's. A static place, not under a dereference: the caller says so.
 */
export function instanceHandle(lw: Lowering, place: Place, fb: FbType): number {
  const context = place.root === "global" ? GLOBAL_CONTEXT : place.root === "local" ? lw.routineContext : lw.frameContext
  const known = interfaceTables(lw).instances.findIndex((x) => x.context === context && sameTarget({ base: x.place }, { base: place }))
  if (known >= 0) return tagOfIndex(known)
  const index = interfaceTables(lw).instances.length
  interfaceTables(lw).instances.push({ place, context, fb })
  return tagOfIndex(index)
}

/**
 * An ARRAY of interfaces is keyed by the ARRAY, not the element (conformance `xo_interface_array_dispatch`: two
 * implementations stored into `ops[1]` and `ops[2]`, then called as `ops[i].Apply(…)` in a FOR loop). Every element
 * shares one held-set, which is exact: the dispatch is on the TAG the element holds at runtime, and the key only decides
 * which arms exist — an arm no element ever holds is dead, never wrong. A runtime index has no key of its own anyway.
 */
export const elementOfArray = (place: Place): Place => {
  let path = place.path
  while (path.at(-1)?.kind === "index") path = path.slice(0, -1)
  return path === place.path ? place : { ...place, path }
}

/**
 * Where an interface variable's instances are recorded: its own frame's key (`pointerKey`) — or, for a field of an FB
 * instance reached by fields and constant indices, `FB:<type>.<field>`, the key the FB's own body uses, so what every
 * caller stores into `inst.shape` is what the body dispatches on.
 */
function interfaceKey(lw: Lowering, written: Place): string | undefined {
  const place = elementOfArray(written)
  const own = pointerKey(lw, place)
  if (own !== undefined) return own
  return place.root === "inout" || place.root === "lent" ? undefined : instanceFieldKey(lw, place, true)
}

/** The instances recorded under a key — created at its first use. */
export function heldBy(lw: Lowering, key: string) {
  let held = interfaceTables(lw).interfaces.get(key)
  if (held === undefined) interfaceTables(lw).interfaces.set(key, (held = { tags: new Map(), from: [] }))
  return held
}

/** Every tag the variable may hold — its own stores, and what each variable it was copied from may hold — each with
 *  whether it arrived through a foreign write anywhere on the way. */
export function tagsOf(lw: Lowering, key: string, seen: ReadonlySet<string> = new Set()): Map<number, boolean> {
  const held = interfaceTables(lw).interfaces.get(key)
  if (held === undefined || seen.has(key)) return new Map()
  const tags = new Map(held.tags)
  for (const edge of held.from)
    for (const [tag, foreign] of tagsOf(lw, edge.key, new Set([...seen, key])))
      if (edge.only === undefined || implementsInterface(lw, interfaceTables(lw).instances[indexOfTag(tag)]!.fb.name, edge.only))
        tags.set(tag, (tags.get(tag) ?? false) || foreign || edge.foreign)
  return tags
}

/** `ref := inst`, `ref := other`, `ref := 0` — the tag stored, and what the variable may hold recorded. */
export function storeInterface(lw: Lowering, target: Place, value: Expr, span: Span): IrStmt | undefined {
  const key = interfaceKey(lw, target)
  if (key === undefined) return lw.bail("interface-place", "an interface held somewhere this does not track — an element, an in-out, a dereference", span)
  const tag = interfaceArgument(lw, key, target.type, value, span, foreignWrite(lw, key, target))
  return tag && { kind: "assign", target, value: tag, span }
}

/**
 * The tag an interface of type `itf` is given — `0`, an FB instance's tag, or another interface's value — with what it may
 * name recorded under `key`: a variable's (`storeInterface`), an FB's input field, a routine's input local. `foreign`: the
 * write reaches the key through another instance than this body's own.
 */
export function interfaceArgument(lw: Lowering, key: string, itf: Type, value: Expr, span: Span, foreign: boolean): IrExpr | undefined {
  const held = heldBy(lw, key)
  if (value.kind === "literal" && value.value === 0n) return { kind: "const", value: BigInt(NO_TAG), type: itf, span }
  const source = lowerPlace(lw, value)
  if (source === undefined) return undefined
  if (source.type.kind === "function_block") {
    const name = (itf as { name: string }).name
    // not implemented: refused in the project (`rk_interface_given_fb_not_implementing`); an FB of a library's, whose
    // materialized declaration holds no IMPLEMENTS list, is not modelled (`libraryOnChain`: the 175 corpus hits)
    if (!implementsInterface(lw, source.type.name, name))
      return lw.bail(libraryOnChain(lw, { fb: source.type.name }) ? "library-declaration" : "interface-type", `${source.type.name} does not implement ${name}`, span)
    const tag = tagOf(lw, source, source.type, span)
    if (tag === undefined) return undefined
    held.tags.set(tag, (held.tags.get(tag) ?? false) || foreign)
    return { kind: "const", value: BigInt(tag), type: itf, span }
  }
  if (source.type.kind === "interface") {
    const from = heldAt(lw, source, span)
    if (from === undefined) return undefined
    held.from.push({ key: from.key, foreign })
    return { kind: "load", place: source, type: itf, span }
  }
  // A REFERENCE TO a project FB is read through: one that does not implement the interface is refused as the FB itself is
  // (`rk_interface_given_fb_not_implementing`) — the same ST behind a REFERENCE (transpile-refusal-classification gate 2).
  if (source.type.kind === "reference") {
    const referred = storageOf(lw, source.type.target, span)
    const name = (itf as { name: string }).name
    if (referred.kind === "function_block" && !implementsInterface(lw, referred.name, name) && !libraryOnChain(lw, { fb: referred.name }))
      return lw.bail("interface-type", `${referred.name} does not implement ${name}`, span)
  }
  // An elementary value is refused by both vendors: "Cannot convert type 'INT' to type 'ITF…'" (`rk_interface_given_integer`).
  // Anything else — a REFERENCE TO an FB that implements it, read through implicitly — is valid ST no recording refuses: not
  // modelled (transpile-refusal-classification 2.x).
  const scalar = source.type.kind === "elementary"
  return lw.bail(scalar ? "interface-given-value" : "interface-value", "an interface given something that is neither an FB instance nor an interface", span)
}
