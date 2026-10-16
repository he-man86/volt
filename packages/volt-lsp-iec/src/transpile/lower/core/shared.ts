/**
 * What every lowering of one POU shares — the layouts, bodies and routines its calls reach, the application's globals and
 * the dispatch queue. Model state shared across the POU (pointer targets, interface instances, addresses, …) is kept
 * beside it by reference, in each model's own `state` (`sharedState`).
 */
import type { TopLevel } from "../../../frontend/syntax/index.js"
import type { IrLayout, IrRoutine, IrSlot } from "../../ir/index.js"
import type { Lowering } from "./lowering.js"

/** A unit's, member's or declaration's attribute names, by its AST node — what `project/prepare.ts` reads from every file
 *  (a `Map` there). Declared HERE, where the shared state holds it: `core/` is a leaf below `project/` (rule 4b, design.md
 *  P2; transpile-restructure 6.B.6), and a type `project/` hands in needs no import back. */
interface AttributeLookup {
  get(node: object): ReadonlySet<string> | undefined
}

/** An FB whose storage is laid out and whose body is lowered at its first call, in the lowering that declared its fields. */
export interface PendingBody {
  lowering: Lowering
  unit: Extract<TopLevel, { kind: "function_block" | "program" }>
  /** The FILE the unit was written in — carried so a source-map entry from this body names its own source. */
  uri?: string
  /** `lowering` while its body lowers: reached again then, the body calls itself (through a program, say) — refused */
  state: "pending" | "lowering" | "lowered" | "failed"
}

/** A METHOD, ACTION or FUNCTION lowered once per POU — or the fact that it could not be. */
export type CalledRoutine = { state: "lowering" } | { state: "lowered"; routine: IrRoutine } | { state: "failed" }

/** What every lowering of one POU shares — the frames of the types, bodies and routines its calls reach, and the
 *  application's globals. */
export interface Shared {
  layouts: Map<string, IrLayout>
  bodies: Map<string, PendingBody>
  routines: Map<string, CalledRoutine>
  /** Each routine's lowering, by key — whose `lends` a call of the routine must fill. */
  routineLowerings: Map<string, Lowering>
  /** The `{attribute '…'}` names on each POU (`syntax/unitAttributes`) — the AST keeps no pragmas. */
  attributes: AttributeLookup
  /** GVL variables and called PROGRAMs' instances, by upper-cased name. */
  globals: { slots: IrSlot[]; byName: Map<string, number> }
  /** The POU being lowered: a PROGRAM that names it is the running frame, not a global instance. */
  root: string
  /** Each call through an interface, or METHOD reaching an in-out from outside, finished once the POU has lowered
   *  (`entry/finish.ts`) — true when it reached more. */
  dispatches: ((root: Lowering) => boolean)[]
  /** Every top-level unit that came from a LIBRARY file rather than from project source — what `isBodylessLibrary`
   *  asks, so a signature with no statements is refused instead of lowering to a routine that does nothing. */
  libraryUnits: ReadonlySet<object>
}

export function newShared(
  attributes: AttributeLookup = new Map(),
  root = "",
  libraryUnits: ReadonlySet<object> = new Set(),
): Shared {
  return {
    layouts: new Map(),
    bodies: new Map(),
    routines: new Map(),
    routineLowerings: new Map(),
    attributes,
    globals: { slots: [], byName: new Map() },
    root,
    dispatches: [],
    libraryUnits,
  }
}

/**
 * A model's state per POU lowering, kept beside `Shared` by reference — created empty at its first use, as a field of
 * `Shared` was created empty with it. The model's `state` owns its shape, so `Shared` names no model.
 */
export function sharedState<S>(make: () => S): (lw: { readonly shared: Shared }) => S {
  const states = new WeakMap<Shared, S>()
  return (lw) => {
    let state = states.get(lw.shared)
    if (state === undefined) states.set(lw.shared, (state = make()))
    return state
  }
}
