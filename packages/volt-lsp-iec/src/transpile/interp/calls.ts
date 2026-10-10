/**
 * THE CALLS: a METHOD, ACTION or FUNCTION invoked, and an FB called — both through ONE frame builder (`enter`): the bound
 * VAR_IN_OUT cells, the lent instances, the instance record and its field keys, the body run, the copies written back.
 */
import type { IrBinding, IrCall, IrInvoke, IrSlot, IrStmt, Place } from "../ir/index.js"
import { instantiate, storeAs, type Val } from "../semantics/index.js"
import type { Cell, Frame } from "./frame.js"

/** What a call needs of the frame it is made from: the frame, plus a body run on a fresh frame of its own. */
export interface Caller extends Frame {
  /** `body` run on a new frame over `root` (keys `keys`), with `inouts` and `lent` bound and `locals` as its locals. */
  enterFrame(root: Record<string | number, Val>, keys: readonly (string | number)[], inouts: readonly Cell[], locals: Val[], lent: readonly Cell[], body: readonly IrStmt[]): void
}

/** The record a place holds — an FB instance, which a body runs on. */
function instanceAt(m: Caller, place: Place): Record<string | number, Val> {
  const at = m.locate(place)
  return (at.container as Record<string | number, Val>)[at.key] as Record<string | number, Val>
}

/**
 * THE frame builder, for a routine invoke and an FB call alike: the lent instances bound on the caller's frame, `body`
 * run on `root` — an instance of `fb`, keyed by its fields' upper-cased names, or (no `fb`) nothing — and the copies
 * the in-out cells `bound` hold written back. Each caller binds its in-outs itself, at the point its own evaluation
 * order puts them (an invoke before it locates its instance, an FB call after).
 */
function enter(m: Caller, root: Record<string | number, Val>, fb: string | undefined, inouts: readonly IrBinding[], bound: readonly Cell[], lent: readonly Place[], locals: Val[], body: readonly IrStmt[]): void {
  const lentCells = lent.map((p) => m.bind(p))
  const keys = fb === undefined ? [] : m.layouts.get(fb.toUpperCase())!.fields.map((f) => f.name.toUpperCase())
  m.enterFrame(root, keys, bound, locals, lentCells, body)
  m.writeBack(inouts, bound)
}

/** A METHOD, ACTION or FUNCTION: fresh locals, the inputs stored into them, the body run on the instance (or on nothing),
 *  and the result slot's value — FALSE stands in for a routine without one, which only an `eval` calls. */
export function invoke(m: Caller, e: IrInvoke): Val {
  const routine = m.routines.get(e.routine)!
  // the inputs in the order they are written — a call inside one runs there (`callshape_argument_order`)
  const inputs: Val[] = new Array(e.inputs.length)
  for (const k of e.order ?? e.inputs.keys()) {
    if (typeof k === "number") inputs[k] = m.expr(e.inputs[k]!)
    // an in-out's index, taken where the in-out is written (`IrFreeze`)
    else m.write(k.temp, m.expr(k.value))
  }
  const bound = e.inouts.map((b) => m.bind(b))
  const locals = fresh(m, routine.locals)
  routine.inputs.forEach((index, k) => {
    locals[index] = storeAs(inputs[k]!, routine.locals[index]!.type)
  })
  if (e.instance !== undefined) enter(m, instanceAt(m, e.instance), routine.fb!, e.inouts, bound, e.lent ?? [], locals, routine.body)
  else enter(m, {}, undefined, e.inouts, bound, e.lent ?? [], locals, routine.body)
  return routine.result === undefined ? false : locals[routine.result]!
}

/** An FB call: the FB's body runs on the instance itself — its fields are the frame, the bound places its VAR_IN_OUT, and
 *  its VAR_TEMP fresh locals of this run (`IrLayout.locals`). */
export function call(m: Caller, s: IrCall): void {
  const instance = instanceAt(m, s.instance)
  // the binding this call makes, which the FB's METHODs called from outside dispatch on (`lower/calls/last-binding.ts`)
  if (s.bind !== undefined) m.write(s.bind.place, s.bind.tag)
  const bound = s.inouts.map((b) => m.bind(b))
  const layout = m.layouts.get(s.fb.toUpperCase())!
  enter(m, instance, s.fb, s.inouts, bound, s.lent ?? [], fresh(m, layout.locals ?? []), layout.body!)
}

/** Per-run locals at their initial values — what every run of a body starts with. */
export function fresh(m: Pick<Caller, "layouts">, locals: readonly IrSlot[]): Val[] {
  return locals.map((s) => instantiate(s.type, s.init, m.layouts))
}
