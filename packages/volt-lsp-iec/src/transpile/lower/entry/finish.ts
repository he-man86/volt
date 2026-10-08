/**
 * The post-POU fix-point: every dispatch arm (interfaces and in-out bindings) given the instances its variables may
 * hold, and every body's calls passing their callees what they are lent — repeated until nothing new is reached. Here and
 * not in `core/`, because it drives `interfaces/` and `calls/`.
 */

import type { Lowering } from "../core/lowering.js"
import type { IrStmt } from "../../ir/index.js"
import { tagsOf } from "../interfaces/tags.js"
import { callsIn } from "../../ir/walk.js"
import { lendToCall } from "../interfaces/lend.js"
import { drain } from "../core/nested.js"

/**
 * Every call through an interface, and every __QUERYINTERFACE, given the instances its variables may hold — run once the
 * POU has lowered. Finishing one can lower a routine that stores more, so it repeats until nothing new is reached.
 */
export function finishInterfaces(root: Lowering, rootBody: readonly IrStmt[]): void {
  for (let progress = true; progress; ) {
    progress = false
    for (const finish of [...root.shared.dispatches]) if (finish(root)) progress = true
    // a dispatch may have made its body need a lent instance: every call of that body passes it, and so on up
    for (const [body, lowering] of bodiesOf(root, rootBody)) if (lendToCallees(root, lowering, body)) progress = true
  }
}

/**
 * A finisher: run for each tag the variable may hold that it has not seen, reporting into the root lowering.
 *
 * A tag is revisited when its `foreign` flag ESCALATES. `seen` was a set of tags alone, so a tag first reached
 * through a local store was never looked at again — and `foreign` is exactly what `dispatch` refuses on
 * (`interface-instance-relative`). A foreign store lowered later could not re-open the question, so the refusal was
 * silently skipped and the code it guards against was emitted. Both callers build one arm per tag and now say so,
 * because a revisit must be able to refuse without adding a second arm for the same tag.
 */
export function onEachTag(lw: Lowering, key: string, each: (tag: number, root: Lowering, foreign: boolean) => void): void {
  const seen = new Map<number, boolean>()
  lw.shared.dispatches.push((root) => {
    const before = lw.diagnostics.length
    const fresh = [...tagsOf(lw, key)].filter(([tag, foreign]) => !seen.has(tag) || (foreign && seen.get(tag) === false))
    for (const [tag, foreign] of fresh) {
      seen.set(tag, foreign || (seen.get(tag) ?? false))
      each(tag, root, foreign)
    }
    if (lw !== root) drain(root, lw, before)
    return fresh.length > 0
  })
}

/** Every lowered body with the lowering it was lowered in: the POU's, each FB body's, each routine's. */
function bodiesOf(root: Lowering, rootBody: readonly IrStmt[]): [readonly IrStmt[], Lowering][] {
  const out: [readonly IrStmt[], Lowering][] = [[rootBody, root]]
  for (const [key, layout] of root.layouts) {
    const pending = root.bodies.get(key)
    if (layout.body !== undefined && pending !== undefined) out.push([layout.body, pending.lowering])
  }
  for (const [key, entry] of root.routines) {
    const lowering = root.shared.routineLowerings.get(key)
    if (entry.state === "lowered" && lowering !== undefined) out.push([entry.routine.body, lowering])
  }
  return out
}

/** Each call in `body` passes its callee the instances the callee is lent — from the caller's frame, or lent on. */
function lendToCallees(root: Lowering, caller: Lowering, body: readonly IrStmt[]): boolean {
  let progress = false
  for (const node of callsIn(body)) if (lendToCall(root, caller, node)) progress = true
  return progress
}
