/**
 * Lending an instance to a body that dispatches on it: where the instance is held, whether it is named relative to
 * the frame, the place a caller lends, and one call's lend to its callee (design §24).
 */

import type { Lowering } from "../lowering.js"
import type { IrCall, IrInvoke, Place } from "../../ir/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import { pointerKey } from "../pointers/state.js"
import { elementOfArray, heldBy } from "./tags.js"
import { aliases } from "../calls/binding.js"

/**
 * The instances an interface variable READ holds — one of this frame's own variables (`pointerKey`). Another instance's
 * interface field (`x1.mine`) holds tags of that instance's frame, which would name the reader's own fields: refused.
 */
export function heldAt(lw: Lowering, read: Place, span: Span) {
  const key = pointerKey(lw, elementOfArray(read))
  if (key === undefined) return lw.bail("interface-place", "an interface read somewhere this does not track — another instance's field, an element, an in-out, a dereference", span)
  return { key, held: heldBy(lw, key) }
}

/** A tag naming a place of an FB's frame — a field of whichever instance runs — not of the POU's one instance. */
export const instanceRelative = (root: Lowering, tag: number): boolean => root.shared.instances[tag - 1]!.context !== root.frameContext

/**
 * Where `body` reaches the instance a tag names: its own place, when the instance is of the body's frame — otherwise a
 * `lent` place, a `&mut` its callers lend it, appended the first time it is needed (design §24). The POU has no caller,
 * and a GVL instance is not lent beside the globals every body already holds.
 */
export function lendPlace(root: Lowering, body: Lowering, tag: number, span: Span): Place | undefined {
  const instance = body.shared.instances[tag - 1]!
  if (instance.context === body.frameContext) return instance.place
  if (body === root || instance.context === "GLOBAL")
    return body.bail("interface-context", `an instance of ${instance.fb.name} held where no caller can lend it`, span)
  let at = body.lends.findIndex((l) => l.tag === tag)
  if (at < 0) at = body.lends.push({ tag, type: instance.fb }) - 1
  return { slot: at, path: [], type: instance.fb, span, root: "lent" }
}

/** Calls whose lending was refused, so a later round does not report them again. */
const refusedLends = new WeakSet<object>()

/** One call passes its callee the instances the callee is lent and the call does not pass yet — true when it passed one. */
export function lendToCall(root: Lowering, caller: Lowering, node: IrInvoke | IrCall): boolean {
  let progress = false
  if (refusedLends.has(node)) return false
  const callee = node.kind === "call" ? root.bodies.get(node.fb.toUpperCase())?.lowering : root.shared.routineLowerings.get(node.routine)
  const needs = callee?.lends ?? []
  const lent = ((node as { lent?: Place[] }).lent ??= [])
  const before = caller.diagnostics.length
  // a call on this body's own instance, a child field of it, or no instance at all (a FUNCTION)
  const ownReceiver = node.instance === undefined || node.instance.root === undefined || node.instance.root === "this"
  for (let i = lent.length; i < needs.length && !refusedLends.has(node); i++) {
    // an FB frame's tag lent to another instance (an in-out, a lent one) would name this caller's field for it
    if (!ownReceiver && instanceRelative(root, needs[i]!.tag)) {
      caller.bail("interface-instance-relative", `an instance of ${needs[i]!.type.name} named relative to this FB, lent to a call on another instance`, node.span)
      refusedLends.add(node)
      break
    }
    const place = lendPlace(root, caller, needs[i]!.tag, node.span)
    const held = [...(node.instance === undefined ? [] : [node.instance]), ...node.inouts.filter((b): b is Place => !("kind" in b)), ...lent]
    if (place !== undefined && held.some((p) => aliases(place, p)))
      caller.bail("interface-lend-alias", `an instance of ${needs[i]!.type.name} lent to a call that already holds it`, node.span)
    if (place === undefined || caller.diagnostics.length > before) refusedLends.add(node)
    else {
      lent.push(place)
      progress = true
    }
  }
  if (caller !== root) root.diagnostics.push(...caller.diagnostics.slice(before))
  return progress
}
