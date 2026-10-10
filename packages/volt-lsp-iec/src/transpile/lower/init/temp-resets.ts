/**
 * PER-RUN LOCALS start over on every run of their body — a METHOD's, ACTION's or FUNCTION's variables, and an FB's or
 * PROGRAM's VAR_TEMP (transpile-restructure 7.6.4): each starts at its initial value (the backends instantiate it per run),
 * and only an initializer that is not a constant is a statement of the run.
 */

import type { Lowering } from "../core/lowering.js"
import type { IrStmt, Place } from "../../ir/index.js"
import { lowerPendingInit, reads } from "./sequence.js"
import { initFrame, type PendingInit } from "./state.js"

/**
 * THE ONE PER-RUN INITIALIZATION (transpile-restructure 1.7.17, 7.6.4), the first statements of every run of a body that has
 * locals: a METHOD's, ACTION's or FUNCTION's (`calls/routines.ts`), an FB's at its first call, a base's run by `SUPER^()`
 * (`calls/routines.ts`) and the POU's own (`entry/lower-unit.ts`).
 *
 * A local starts over at its initial value on every run — a VAR_TEMP too (conformance `life_fb_var_temp_calls`,
 * `life_program_var_temp_runs`: 1 and 6 after two runs, not 2 and 7; an ARRAY or STRING in VAR_TEMP as a scalar does,
 * `decl_temp_array_counts`, `decl_temp_string_counts`). It was a slot of the frame reset by a statement at the top of the
 * run (`resetTemps`); as a local, its fresh start IS that reset, so no statement is left for it.
 *
 * AN INITIALIZER THAT IS NOT A CONSTANT RUNS AGAIN, as the statement it is: `t : INT := g` reads g's value at this run
 * (`var_temp_dynamic_init`: 9 then 10; `var_temp_dynamic_init_method`, `_function`; M5.1.6, transpile-restructure 5.5), an
 * aggregate's dynamic elements and fields likewise, after its static part (`var_temp_dynamic_aggregate_init`, M5.1.7). In
 * local-slot order, which is declaration order; one reading its own or a later local is refused. Undefined when one is
 * refused (reported).
 */
export function localInits(lw: Lowering): IrStmt[] | undefined {
  const out: IrStmt[] = []
  // a routine's locals start every CALL; a VAR_TEMP every run of its FB's or PROGRAM's body
  const [what, when] = lw.routineMode ? ["local", "call"] : ["VAR_TEMP", "run"]
  for (const [index, dynamic] of [...initFrame(lw).tempInits].sort(([a], [b]) => a - b)) {
    const assigned = lowerAll(lw, dynamic)
    if (assigned === undefined) return undefined
    const later = readsLater(assigned, (place) => (place.root === "local" && place.slot >= index ? (lw.localSlots[place.slot]?.name ?? `a later ${what}`) : undefined))
    if (later !== undefined)
      return lw.bail("init-reads-later", `${dynamic[0]!.name.text}'s initial value reads the ${what} ${later}, whose value at that point of the ${when} is not recorded`, dynamic[0]!.span)
    out.push(...assigned)
  }
  return out
}

/** Each queued initializer lowered, in order — undefined when one cannot be (reported). */
function lowerAll(lw: Lowering, pending: readonly PendingInit[]): IrStmt[] | undefined {
  const out: IrStmt[] = []
  for (const p of pending) {
    const assigned = lowerPendingInit(lw, p)
    if (assigned === undefined) return undefined
    out.push(...assigned)
  }
  return out
}

/** The first place the assigned VALUES read that `later` names — what an initializer may not read yet. */
function readsLater(assigned: readonly IrStmt[], later: (place: Place) => string | undefined): string | undefined {
  return assigned.flatMap((a) => (a.kind === "assign" ? [a.value] : [])).reduce<string | undefined>((f, v) => f ?? reads(v, later), undefined)
}
