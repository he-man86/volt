/**
 * A PROGRAM runs moved out of `Programs` while it is called: what a routine touches, and whether it could reach the
 * program it runs in.
 */

import type { Lowering } from "../lowering.js"
import type { IrRoutine, IrStmt, Place } from "../../ir/index.js"
import { routineFacts } from "./facts.js"
import type { InitStep } from "../init/state.js"

/** A routine run on an instance inside (or being) a called PROGRAM runs with that program moved out of `Programs`, so it
 *  must not reach the program again — directly or through an interface. `lowerInvoke` checks a body's call; the init step
 *  checks its FB_Init and slot-METHOD calls here (review of the fixture batch: Rust read the `::new()` stand-in). */
export function programReentrant(lw: Lowering, routine: IrRoutine, instance: Place): boolean {
  return instance.root === "global" && (touchesOf(lw).get(routine.key)?.has(instance.slot) === true || reachesDispatch(lw, routine.body))
}

/** Each routine's `touched` set — so the routine's callers can take it on. */
export const touchesOf = routineFacts<ReadonlySet<number>>()

/**
 * An FB instance held in the GVL storage. Every body is handed that storage as one `&mut g`, so calling the instance —
 * `g.inst.call(g)` — borrows it twice (E0499; transpiler review 2026-09-15). A PROGRAM's instance lives apart, in `prg`.
 */
export function inGlobals(lw: Lowering, place: Place): boolean {
  return place.root === "global" && lw.shared.globals.slots[place.slot]!.section !== "program"
}

/**
 * A callee that touches nothing but its own locals, inputs and in-outs, and calls nothing — no METHOD, FB body, FUNCTION or
 * interface call, no dereference. The only way from it to a variable of its caller is then an in-out it was bound.
 */
export function touchesOnlyItsOwn(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(touchesOnlyItsOwn)
  if (node === null || typeof node !== "object") return true
  const n = node as { kind?: string; slot?: unknown; path?: unknown; root?: string; guard?: unknown }
  if (n.kind === "invoke" || n.kind === "dispatch" || n.kind === "call") return false
  if (typeof n.slot === "number" && Array.isArray(n.path) && (n.guard !== undefined || (n.root !== "local" && n.root !== "inout"))) return false
  return Object.entries(node).every(([key, child]) => key === "type" || key === "of" || key === "span" || touchesOnlyItsOwn(child))
}

/** A body that writes nothing but its own locals and calls nothing (IR walked whole; a type's scope graph is skipped). */
export function writesOnlyLocals(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(writesOnlyLocals)
  if (node === null || typeof node !== "object") return true
  const n = node as { kind?: string; target?: Place }
  if (n.kind === "invoke" || n.kind === "dispatch" || n.kind === "call") return false
  if (n.kind === "assign" && n.target?.root !== "local") return false
  return Object.entries(node).every(([key, child]) => key === "type" || key === "of" || key === "span" || writesOnlyLocals(child))
}

/**
 * Whether a body, or any body it calls, calls through an interface. Such a call's arms are finished only after the POU
 * lowers, so the PROGRAM instances they reach are not in `touched` when a call on an instance inside a program is checked
 * — one read the program's `::new()` stand-in (review of the batch). ponytail: refuses every such body; check the finished
 * arms instead if the corpus needs it.
 */
export function reachesDispatch(lw: Lowering, body: readonly IrStmt[], seen = new Set<string>()): boolean {
  let found = false
  const walk = (node: unknown): void => {
    if (found || node === null || typeof node !== "object") return
    if (Array.isArray(node)) return node.forEach(walk)
    const n = node as { kind?: string; routine?: string; fb?: string }
    if (n.kind === "dispatch") return void (found = true)
    if (n.kind === "invoke" && n.routine !== undefined && !seen.has(n.routine)) {
      seen.add(n.routine)
      const called = lw.routines.get(n.routine)
      if (called?.state === "lowered") walk(called.routine.body)
    }
    if (n.kind === "call" && n.fb !== undefined && !seen.has(`FB:${n.fb}`)) {
      seen.add(`FB:${n.fb}`)
      walk(lw.layouts.get(n.fb.toUpperCase())?.body)
    }
    for (const [key, child] of Object.entries(node)) if (key !== "span" && key !== "type") walk(child)
  }
  walk(body)
  return found
}

/** A PROGRAM with METHODs or ACTIONs lowers as its one instance (`rootInstance`): the frame's slot that IS the program —
 *  or a PROGRAM this POU calls: its one instance among the globals. */
export function ownProgram(st: InitStep, place: Place): boolean {
  const { lw, root } = st
  if (place.root === "global") return lw.globals[place.slot]?.section === "program"
  const slot = lw.frame[place.slot]
  return place.root === undefined && root?.kind === "program" && slot?.type.kind === "function_block" && slot.type.name.toUpperCase() === root.name.toUpperCase()
}
