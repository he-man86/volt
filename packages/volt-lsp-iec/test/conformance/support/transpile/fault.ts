/**
 * THE REPLAY OF A VENDOR STOP (transpile-restructure 2.3). A recording that carries an `error` says the simulator
 * stopped the application; the transpiler must stop too — by throwing in the scan. Its error text does not say WHY it
 * stopped: a runaway gets the same done-flag text as a fault (`arithedge_uint_div_by_zero`, a divide by zero, carries
 * it), so the replay itself bounds every loop. A run past the guard is the harness giving up, not the program
 * faulting: it fails the case by name, never a hang and never a fault match. Only a runtime fault (a `RangeError`)
 * matches; an interpreter crash (a `TypeError` on IR it cannot run) is rethrown.
 */
import { LoopGuardError, run, type IrPou } from "../../../../src/transpile/index.js"

/** Throws unless `cycles` scans of `pou` fault; throws by name when a loop runs past `guard` body entries. */
export function replayFault(pou: IrPou, cycles: number, guard: number): void {
  try {
    const runner = run(pou, { loopGuard: guard })
    for (let i = 0; i < cycles; i++) runner.scan()
  } catch (error) {
    if (error instanceof LoopGuardError) throw new Error(`runs past the harness guard (${guard} body entries): ${error.message}`, { cause: error })
    // a runtime fault is a `RangeError` (`semantics/faults.ts`: an `IecFault`, an index or character out of range);
    // anything else is the interpreter failing, not the program — never a match for the vendor's stop
    if (!(error instanceof RangeError)) throw error
    return
  }
  throw new Error(`completed ${cycles} scan(s) where the vendor stopped`)
}
