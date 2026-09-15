/**
 * An FB's VAR_IN_OUT reached by its METHOD or ACTION called from OUTSIDE the FB's run. CODESYS keeps the in-out's LAST
 * binding in the instance (conformance `callshape_inout_in_method_after_call`: 11, then 110), into later cycles
 * (`callshape_inout_method_in_later_cycle`: 21), and a METHOD run before any call bound it stops the application
 * (`callshape_inout_method_before_binding`). So every call of the FB stores which binding it made — a tag per distinct
 * instance and bound places, in a hidden field of the instance — and the METHOD called from outside dispatches on that
 * tag, each arm lending the places one call bound. Tag 0, never bound, has no arm and faults. The arms fill once the POU
 * has lowered (`finishInterfaces`), as a call that binds can lower after the METHOD's.
 *
 * Exact only where the instance is named ONE way: every call of that FB on a static place — fields and constant indices —
 * of its frame or the globals, not reached through another instance (a holder's or a program's, which another frame names
 * too), bound to places this frame can lend again. Anything else is refused (`call-fb-inout`).
 */
import type { Span } from "../../syntax/index.js"
import { elementaryRef, type Type } from "../../types/index.js"
import { defaultValueOf, holdsCall, type IrBinding, type IrCall, type IrDispatch, type IrInvoke, type IrRoutine, type IrSlot, peelArray, type Place } from "../ir/index.js"
import { aliases } from "./calls.js"
import type { Lowering } from "./lowering.js"

const FIELD = "__inout_binding"
const DINT = elementaryRef("DINT")

/** A place's shape as a key, with the frame it indexes — undefined through a runtime index, a dereference, or a root no
 *  later call can name again (a routine's local, an in-out, a lent instance). */
function placeKey(lw: Lowering, p: Place): string | undefined {
  if (p.guard !== undefined || (p.root !== undefined && p.root !== "global" && p.root !== "this")) return undefined
  const steps: string[] = []
  for (const step of p.path) {
    if (step.kind === "field") steps.push(step.name.toUpperCase())
    else if (step.kind === "index" && step.index.kind === "const") steps.push(`[${String(step.index.value)}]`)
    else return undefined
  }
  return `${p.root === "global" ? "GLOBAL" : lw.frameContext}|${p.root ?? ""}:${p.root === "this" ? "" : p.slot}|${steps.join(".")}`
}

/** Whether the path passes through an FB instance — a holder's field, a program's variable — which its own frame names too. */
function throughInstance(lw: Lowering, p: Place): boolean {
  let t: Type | undefined = p.root === "global" ? lw.shared.globals.slots[p.slot]?.type : lw.slots[p.slot]?.type
  for (const step of p.path) {
    if (t === undefined || t.kind === "function_block") return true
    if (step.kind === "field") t = t.kind === "struct" ? lw.layouts.get(t.name.toUpperCase())?.fields.find((f) => f.name.toUpperCase() === step.name.toUpperCase())?.type : undefined
    else if (step.kind === "index") t = peelArray(t)?.element
    else return true
  }
  return false
}

const instanceKey = (lw: Lowering, p: Place): string | undefined =>
  (p.root === undefined || p.root === "global") && !throughInstance(lw, p) ? placeKey(lw, p) : undefined

/** Every call of an FB with VAR_IN_OUT: the instance it runs on and the places it binds, keyed — for `lastBinding`. */
export function registerBodyCall(lw: Lowering, call: IrCall): void {
  const keys = call.inouts.map((b) => ("kind" in b ? undefined : placeKey(lw, b)))
  lw.shared.bodyCalls.push({ call, instance: instanceKey(lw, call.instance), binding: keys.includes(undefined) ? undefined : keys.join(";"), context: lw.frameContext })
}

/** `inst.M()` reaching the FB's own VAR_IN_OUT from outside its run — a dispatch on the binding `inst` was last called with. */
export function lastBinding(lw: Lowering, routine: IrRoutine, invoke: IrInvoke, span: Span): IrDispatch | undefined {
  const refuse = (why: string): undefined => lw.bail("call-fb-inout", `${routine.name} reaches its FB's VAR_IN_OUT from outside the FB's run, ${why}`, span)
  const instance = invoke.instance
  const key = instance === undefined ? undefined : instanceKey(lw, instance)
  if (instance === undefined || instance.type.kind !== "function_block" || key === undefined)
    return refuse("on an instance not named by fields and constant indices of this frame")
  if (invoke.inouts.some((b) => b !== undefined && "kind" in b)) return refuse("beside an in-out lent as a copy")
  // the tag is read before the arm's inputs run: an input that calls could bind the instance first (review) — not recorded
  if (holdsCall(invoke.inputs)) return refuse("with an input that calls — whether a binding it makes is the one reached is not recorded")
  const fb = instance.type.name.toUpperCase()
  // the FB's layout as it stands when read: its in-outs are set once its body lowers, which can follow this call
  const layoutNow = () => {
    const layout = lw.layouts.get(fb)
    if (layout !== undefined && !layout.fields.some((f) => f.name === FIELD)) (layout.fields as IrSlot[]).push({ name: FIELD, type: DINT, section: "VAR", init: defaultValueOf(DINT) })
    return layout
  }
  if (layoutNow() === undefined) return refuse("on an FB whose layout is not known")
  const tagOf = (p: Place): Place => ({ ...p, path: [...p.path, { kind: "field", name: FIELD }], type: DINT, span })
  const arms: { tag: bigint; call: IrInvoke }[] = []
  const dispatch: IrDispatch = { kind: "dispatch", tag: { kind: "load", place: tagOf(instance), type: DINT, span }, arms, type: invoke.type, span }
  const held = [instance, ...invoke.inouts.filter((b): b is Place => b !== undefined && !("kind" in b))]
  const armed = new Set<bigint>()
  let refused = false
  lw.shared.dispatches.push((root) => {
    if (refused) return false
    const before = lw.diagnostics.length
    const calls = lw.shared.bodyCalls.filter((c) => c.call.instance.type.kind === "function_block" && c.call.instance.type.name.toUpperCase() === fb)
    // one tag per distinct instance and binding, over every call of the FB — the order calls registered keeps them stable
    const bindings = [...new Set(calls.flatMap((c) => (c.instance === undefined || c.binding === undefined ? [] : [`${c.instance}#${c.binding}`])))]
    const tagFor = (c: (typeof calls)[number]) => BigInt(bindings.indexOf(`${c.instance}#${c.binding}`) + 1)
    for (const c of calls) if (c.instance !== undefined && c.binding !== undefined) c.call.bind = { place: tagOf(c.call.instance), tag: tagFor(c) }
    const mine = calls.filter((c) => c.instance === key)
    let fresh = false
    const fail = (why: string) => {
      refuse(why)
      refused = true
    }
    // a frame with ONE instance: the POU's own, or the root PROGRAM lowered as its instance — the only frames whose places a
    // PROGRAM's one binding can name (review: bound from an FB with two instances, the tag lent the running one's field)
    const single = (context: string) => context === `POU:${lw.shared.root.toUpperCase()}` || context === `FB:${lw.shared.root.toUpperCase()}`
    if (calls.some((c) => c.instance === undefined)) fail("while another call of the FB names its instance some other way")
    else if (mine.some((c) => c.binding === undefined)) fail("while a call of the instance binds a place this cannot lend again")
    // SUPER^ binding the in-out to another place, and an instance copied whole, are not recorded (review)
    else if (lw.shared.superRebinds.has(fb)) fail("while its SUPER^ binds the in-out to another place, which is not recorded")
    else if (mine.length === 0 && calls.length > 0) fail("never called on this instance, while it is called on others — a copy's binding is not recorded")
    else if (key.startsWith("GLOBAL") && mine.some((c) => !single(c.context) && (c.call.inouts as readonly Place[]).some((p) => p.root !== "global")))
      fail("bound from a frame of which there can be several instances, which the one binding cannot name")
    else
      for (const c of mine) {
        const tag = tagFor(c)
        if (armed.has(tag)) continue
        const places = c.call.inouts as readonly Place[]
        if (c.context !== lw.frameContext && places.some((p) => p.root !== "global")) {
          fail("bound by a call in another frame")
          break
        }
        const params = layoutNow()?.inouts ?? []
        const lent: (IrBinding | undefined)[] = invoke.inouts.map((b, i) => b ?? places[params.findIndex((s) => s.name.toUpperCase() === routine.inouts[i]!.name.toUpperCase())])
        if (lent.some((b) => b === undefined)) {
          fail("reaching an in-out no call binds")
          break
        }
        if (lent.some((b, i) => invoke.inouts[i] === undefined && held.some((p) => aliases(b as Place, p)))) {
          fail("bound to a variable the call already holds")
          break
        }
        armed.add(tag)
        arms.push({ tag, call: { ...invoke, inouts: lent as IrBinding[] } })
        fresh = true
      }
    if (lw !== root) root.diagnostics.push(...lw.diagnostics.slice(before))
    return fresh
  })
  return dispatch
}
