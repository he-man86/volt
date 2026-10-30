/**
 * NESTED LOWERINGS — a lowering made to lower one part (a scratch frame for declarations, a GVL's variables, a body run
 * later) and what it reports, carried to the lowering that asked (transpile-restructure 1.7.6).
 */
import { type Scope, scopeUri } from "../../../frontend/symbols/index.js"
import { Lowering } from "./lowering.js"

/**
 * THE ONE DIAGNOSTIC DRAIN: what `from` reported since `since` (all of it by default), reported by `into` too — COPIED,
 * not moved: a routine's or a body's own lowering is kept (`routineLowerings`, `bodies`) and asked again later, so what
 * it reported stays its own. True when there was anything to carry.
 */
export function drain(into: Lowering, from: Lowering, since = 0): boolean {
  const carried = from.diagnostics.slice(since)
  into.diagnostics.push(...carried)
  return carried.length > 0
}

/** The modes a scratch lowering is made in. */
interface NestedMode {
  readonly routineMode?: boolean
  readonly globalMode?: boolean
  readonly globalPrefix?: string
  /** The file the scratch lowering lowers, where its scope names none (the project's: a GVL, a METHOD's VAR_STAT). */
  readonly uri?: string
}

/**
 * A SCRATCH LOWERING in `scope`, sharing `lw`'s POU-wide state, in `mode`: `fn` lowers into it, and what it reports is
 * drained into `lw` — exactly once. `drained` says whether there was anything.
 */
export function nested<T>(lw: Lowering, scope: Scope, mode: NestedMode, fn: (scratch: Lowering) => T): { value: T; drained: boolean } {
  const scratch = new Lowering(scope, lw.project, lw.shared, mode.uri ?? scopeUri(scope))
  if (mode.routineMode !== undefined) scratch.routineMode = mode.routineMode
  if (mode.globalMode !== undefined) scratch.globalMode = mode.globalMode
  if (mode.globalPrefix !== undefined) scratch.globalPrefix = mode.globalPrefix
  const value = fn(scratch)
  return { value, drained: drain(lw, scratch) }
}
