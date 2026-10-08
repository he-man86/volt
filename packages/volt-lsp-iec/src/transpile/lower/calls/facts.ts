/**
 * Facts about a lowered routine, recorded once per lowering and read by every call of it.
 */

import type { Lowering } from "../core/lowering.js"
import { sharedState } from "../core/shared.js"

/**
 * A FACT ABOUT EACH LOWERED ROUTINE, by its key (`once`'s name, upper-cased), kept per POU lowering (`lw.shared`). The
 * call site needs what the callee's own lowering worked out, and that lowering is gone by the time an argument binds.
 * Lowering's, not the IR's: nothing a backend reads.
 */
export function routineFacts<T>(): (lw: Lowering) => Map<string, T> {
  return sharedState(() => new Map<string, T>())
}
