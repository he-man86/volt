/**
 * A PROGRAM runs moved out of `Programs` while it is called: what a routine touches, and whether it could reach the
 * program it runs in.
 */

import { frameState, type Lowering } from "../core/lowering.js"
import type { IrRoutine, IrStmt, Place } from "../../ir/index.js"
import { type IrNode, isPlace, someNode } from "../../ir/walk.js"
import { routineFacts } from "./facts.js"
import type { InitStep } from "../init/state.js"

/** What `programReentrant` asks of a callee: the PROGRAM instances it touches, and its body (an interface call in it). */
interface Callee {
  readonly touched: ReadonlySet<number> | undefined
  readonly body: readonly IrStmt[]
}

/** A routine as a callee — its `touched` set recorded by key (`touchesOf`). */
export const routineCallee = (lw: Lowering, routine: IrRoutine): Callee => ({ touched: touchesOf(lw).get(routine.key), body: routine.body })

/** Where a call runs among the globals: the global slot it runs on — a PROGRAM's instance, or one inside it (`inside`, a
 *  path into it) — or undefined off the globals. */
export const programTarget = (place: Place): { slot: number; inside: boolean } | undefined =>
  place.root === "global" ? { slot: place.slot, inside: place.path.length > 0 } : undefined

/**
 * Which of the two checks a site makes, and when. THE SITES DIFFER and each keeps its rule (phase 1 is output-neutral):
 * the init step's FB_Init and slot-METHOD calls check both, always (the default); a property getter both, on an instance
 * inside a program (it is only asked there); a METHOD call (`calls/invoke.ts`) the touched set always and an interface
 * call only inside; an FB body called inside a program (`calls/fb-call.ts`) both only inside; a PROGRAM's own body
 * (`calledLayout`) only the touched set — its interface calls are checked where it is called.
 */
interface ReentrancyRule {
  readonly touched: "always" | "inside"
  readonly dispatch: "always" | "inside" | "never"
}

/**
 * THE ONE PROGRAM-REENTRANCY TEST (transpile-restructure 1.7.12). A callee run on an instance inside (or being) a called
 * PROGRAM runs with that program moved out of `Programs`, so it must not reach the program again — directly
 * (`touches`: its touched set holds the program's slot) or through an interface (`dispatch`: the arms are finished only
 * after the POU lowers, so what they reach is not known yet). Undefined when it can do neither (review of the fixture
 * batch: Rust read the `::new()` stand-in).
 */
export function programReentrant(
  lw: Lowering,
  callee: Callee,
  target: { slot: number; inside: boolean } | undefined,
  rule: ReentrancyRule = { touched: "always", dispatch: "always" },
): "touches" | "dispatch" | undefined {
  if (target === undefined) return undefined
  if (callee.touched?.has(target.slot) === true && (rule.touched === "always" || target.inside)) return "touches"
  if (rule.dispatch !== "never" && (rule.dispatch === "always" || target.inside) && reachesDispatch(lw, callee.body)) return "dispatch"
  return undefined
}

/** The PROGRAM instances (global slots) a body reads or calls, and those of every body it calls. In Rust a program
 *  runs moved out of `Programs`, so a program whose run reaches its own instance would read a stand-in: refused. */
export const touchedOf = frameState(() => new Set<number>())

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
 * Whether a body, or any body it calls, calls through an interface. Such a call's arms are finished only after the POU
 * lowers, so the PROGRAM instances they reach are not in `touched` when a call on an instance inside a program is checked
 * — one read the program's `::new()` stand-in (review of the batch). ponytail: refuses every such body; check the finished
 * arms instead if the corpus needs it.
 */
function reachesDispatch(lw: Lowering, body: readonly IrStmt[], seen = new Set<string>()): boolean {
  const visit = (n: IrNode): boolean => {
    if (isPlace(n)) return false
    if (n.kind === "dispatch") return true
    if (n.kind === "invoke" && !seen.has(n.routine)) {
      seen.add(n.routine)
      const called = lw.routines.get(n.routine)
      if (called?.state === "lowered" && someNode(called.routine.body, visit)) return true
    }
    if (n.kind === "call" && !seen.has(`FB:${n.fb}`)) {
      seen.add(`FB:${n.fb}`)
      if (someNode(lw.layouts.get(n.fb.toUpperCase())?.body ?? [], visit)) return true
    }
    return false
  }
  return someNode(body, visit)
}

/** A PROGRAM with METHODs or ACTIONs lowers as its one instance (`rootInstance`): the frame's slot that IS the program —
 *  or a PROGRAM this POU calls: its one instance among the globals. */
export function ownProgram(st: InitStep, place: Place): boolean {
  const { lw, root } = st
  if (place.root === "global") return lw.globals[place.slot]?.section === "program"
  const slot = lw.slots[place.slot]
  return place.root === undefined && root?.kind === "program" && slot?.type.kind === "function_block" && slot.type.name.toUpperCase() === root.name.toUpperCase()
}
