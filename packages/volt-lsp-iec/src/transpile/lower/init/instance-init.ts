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
 * AN `__INIT` PART'S ROUTINE KEY — `T.__INIT` (the whole sequence on an instance of `on`), `T.__INIT[BASE]` (a base's,
 * run on the derived type `T`), `T.__INIT@from..to` (the part of the slots it covers) — and the one test that a key is
 * one (`isInitPartKey`, which `bindings.ts` asks), side by side so the format has one home.
 */
const initPartKey = (on: string, fb: string, part: readonly [number, number] | undefined): string =>
  `${on.toUpperCase()}.__INIT${on.toUpperCase() === fb.toUpperCase() ? "" : `[${fb.toUpperCase()}]`}${part === undefined ? "" : `@${part[0]}..${part[1]}`}`
const INIT_PART_KEY = /\.__INIT(?:\[[^\]]*\])?(?:@\d+\.\.\d+)?$/

/** Whether a routine key names an `__init` part (`initPartKey`). */
export const isInitPartKey = (key: string): boolean => INIT_PART_KEY.test(key)

/**
 * The implicit routine that runs ONE FB type's non-constant field initializers on an instance — those of the fields at
 * slots `from` up to (not including) `to` — its key, or `undefined` when there are none, or `null` when one of them
 * cannot lower.
 *
 * Built once per type and cached in `lw.routines` beside the real METHODs, because that is exactly what it is: a
 * body that runs on an instance. `IrInvoke` binds the instance, so nothing has to rewrite places per instance. A PART
 * of them is a routine of its own, keyed by the slots it covers: an instance field running FB_Init splits the sequence
 * there (transpile-review 23). `on`: the FB type of the instance it runs on — a BASE's initializers run on a derived
 * instance as a routine OF THE DERIVED TYPE (the base's fields sit at the same indices there, `inherit`), as a base's
 * METHOD is lowered per frame (`calledRoutine`): filed under the base, the emitted Rust called a method the derived struct
 * does not have, or the derived type's own `__init` of the same name (transpile-restructure 5.6).
 */
export function instanceInitRoutine(lw: Lowering, fb: string, from = 0, to = Number.POSITIVE_INFINITY, on = fb): string | undefined | null {
  const entry = lw.bodies.get(fb.toUpperCase())
  const nested = entry?.lowering
  if (nested === undefined || initFrame(nested).pendingInits.length === 0) return undefined
  const inRange = initFrame(nested).pendingInits.filter((p) => p.slot >= from && p.slot < to)
  if (inRange.length === 0) return undefined
  const whole = inRange.length === initFrame(nested).pendingInits.length
  const key = initPartKey(on, fb, whole ? undefined : [inRange[0]!.slot, inRange.at(-1)!.slot])
  const routine = once(lw, key, ZERO_SPAN, () => {
    // `nested`'s diagnostics were drained into `lw` when the layout was built, so only what THIS lowering adds is new
    const before = nested.diagnostics.length
    const built = buildInitSequence(nested)
    drain(lw, nested, before)
    if (built === undefined) return undefined
    const body = whole ? built : (initFrame(nested).initSequence?.bySlot ?? []).filter((b) => b.slot >= from && b.slot < to).flatMap((b) => b.statements)
    // no per-call storage: a temp one of these needs is a field of the instance, as every FB body's temps are
    // its spans index the file the TYPE is declared in, which need not be the main source (a GVL's FB)
    return { name: `${on}.__init`, key, kind: "method", fb: on, ...(entry?.uri === undefined ? {} : { uri: entry.uri }), locals: [], inputs: [], inouts: [], body }
  }, { quiet: true })
  return routine === undefined ? null : key
}
