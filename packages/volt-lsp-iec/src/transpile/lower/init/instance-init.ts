/**
 * An FB type's implicit initializer routine (`__INIT`): its non-constant field initializers, run on an instance.
 */

import type { Lowering } from "../core/lowering.js"
import { buildInitSequence } from "./sequence.js"
import { initFrame } from "./state.js"
import { drain } from "../core/nested.js"
import { once } from "../calls/routines.js"
import { ZERO_SPAN } from "../core/build.js"

/**
 * The implicit routine that runs ONE FB type's non-constant field initializers on an instance — those of the fields at
 * slots `from` up to (not including) `to` — its key, or `undefined` when there are none, or `null` when one of them
 * cannot lower.
 *
 * Built once per type and cached in `lw.routines` beside the real METHODs, because that is exactly what it is: a
 * body that runs on an instance. `IrInvoke` binds the instance, so nothing has to rewrite places per instance. A PART
 * of them is a routine of its own, keyed by the slots it covers: an instance field running FB_Init splits the sequence
 * there (transpile-review 23).
 */
export function instanceInitRoutine(lw: Lowering, fb: string, from = 0, to = Number.POSITIVE_INFINITY): string | undefined | null {
  const entry = lw.bodies.get(fb.toUpperCase())
  const nested = entry?.lowering
  if (nested === undefined || initFrame(nested).pendingInits.length === 0) return undefined
  const inRange = initFrame(nested).pendingInits.filter((p) => p.slot >= from && p.slot < to)
  if (inRange.length === 0) return undefined
  const whole = inRange.length === initFrame(nested).pendingInits.length
  const key = `${fb.toUpperCase()}.__INIT${whole ? "" : `@${inRange[0]!.slot}..${inRange.at(-1)!.slot}`}`
  const routine = once(lw, key, ZERO_SPAN, () => {
    // `nested`'s diagnostics were drained into `lw` when the layout was built, so only what THIS lowering adds is new
    const before = nested.diagnostics.length
    const built = buildInitSequence(nested)
    drain(lw, nested, before)
    if (built === undefined) return undefined
    const body = whole ? built : (initFrame(nested).initSequence?.bySlot ?? []).filter((b) => b.slot >= from && b.slot < to).flatMap((b) => b.statements)
    // no per-call storage: a temp one of these needs is a field of the instance, as every FB body's temps are
    // its spans index the file the TYPE is declared in, which need not be the main source (a GVL's FB)
    return { name: `${fb}.__init`, key, kind: "method", fb, ...(entry?.uri === undefined ? {} : { uri: entry.uri }), locals: [], inputs: [], inouts: [], body }
  }, { quiet: true })
  return routine === undefined ? null : key
}
