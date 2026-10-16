/**
 * THE SCOPE A CALLED ROUTINE IS LOWERED IN — one answer for `calledRoutine` and every argument scanner that reads the
 * callee's parameter types before it is lowered (`string-inputs.ts`, `string-inouts.ts`, `pointers/cursor.ts`).
 */
import { childScopesByName, findChildScope, type Scope } from "../../../frontend/symbols/index.js"
import type { Lowering, RoutineSymbol } from "../core/lowering.js"

/**
 * A FUNCTION is found by its SYMBOL — the child scope of its name that its own file declared: a project FUNCTION and a
 * library's element of the same name are two routines (transpile-review 21, `tr_21_namespace_*`). A METHOD or an ACTION
 * is its owner's child. Undefined when the routine did not bind — the caller refuses (`calledRoutine`: call-target) or
 * reads nothing; never the caller's own scope in its place.
 */
export function routineScope(lw: Lowering, sym: RoutineSymbol): Scope | undefined {
  return sym.kind === "function"
    ? childScopesByName(lw.project, sym.name).find((s) => s.defUri === sym.uri)
    : findChildScope(sym.owner, sym.name)
}
