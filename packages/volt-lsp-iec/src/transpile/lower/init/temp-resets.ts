/**
 * VAR_TEMP starts over on every run of its body: the reset at the top of each run.
 */

import type { Lowering } from "../core/lowering.js"
import type { Span, VarSection } from "../../../frontend/syntax/index.js"
import type { IrExpr, IrStmt, IrValue, Place } from "../../ir/index.js"
import { laterThan, lowerPendingInit, reads } from "./sequence.js"
import { initFrame, type PendingInit } from "./state.js"

/**
 * THE ONE VAR_TEMP RESET (transpile-restructure 1.7.17), called by every body that runs: the POU's own
 * (`entry/lower-unit.ts`), an FB's at its first call and a base's run by `SUPER^()` (`calls/routines.ts`).
 *
 * A body's VAR_TEMP started over at its initial value — the first statements of every run (conformance
 * `life_fb_var_temp_calls`, `life_program_var_temp_runs`: 1 and 6 after two runs, not 2 and 7). A PROGRAM's kept its value
 * across scans, and an FB's was refused as unmeasured (review 2026-09-15). The variables stay slots of the frame; a
 * composite starts over as an `IrFresh` of its static initial value, its dynamic elements the statements after it.
 */
export function resetTemps(lw: Lowering, unit: { readonly varSections: readonly VarSection[]; readonly span: Span }): IrStmt[] {
  // a reset that is refused has reported why (`bail`); the body still lowers after it, so its own refusals are reported
  // too, and the caller sees the diagnostics — the statements of a refused reset are never run
  return tempResetsOf(lw, unit.varSections, unit.span) ?? []
}

/** The resets of `resetTemps`, or undefined when one is refused (reported). */
function tempResetsOf(lw: Lowering, sections: readonly VarSection[], span: Span): IrStmt[] | undefined {
  const resets: IrStmt[] = []
  for (const decl of sections.filter((s) => s.sectionKind === "VAR_TEMP").flatMap((s) => s.decls))
    for (const name of decl.names) {
      const index = lw.byName.get(name.text.toUpperCase())
      if (index === undefined) continue // refused where it was declared
      const slot = lw.slots[index]!
      // AN INITIALIZER THAT IS NOT A CONSTANT RUNS AGAIN, as the statement it is — `t : INT := g` reads g's value at
      // this call (`var_temp_dynamic_init`: 9 then 10, expr 21). It was queued for the run-once init step and the
      // reset below then wrote the type's zero on every run (transpile-review 24).
      const dynamic = initFrame(lw).tempInits.get(index) ?? []
      const assigned = lowerAll(lw, dynamic)
      if (assigned === undefined) return undefined
      const later = readsLater(assigned, (place) => (lw.slots[place.slot]?.section === "VAR_TEMP" ? laterThan(lw, index)(place) : undefined))
      if (later !== undefined)
        return lw.bail("init-reads-later", `${name.text}'s initial value reads the VAR_TEMP ${later}, whose value at that point of the run is not recorded`, decl.span)
      if (dynamic.some((p) => p.target === undefined)) {
        resets.push(...assigned)
        continue
      }
      // A COMPOSITE RESETS TOO, to a fresh value of its type. Measured: an ARRAY in VAR_TEMP counts 1 after three
      // scans where the same ARRAY in VAR counts 3, and a STRING the same (`decl_temp_array_counts`,
      // `decl_temp_string_counts`) — so a composite behaves exactly as a scalar does and was refused only because
      // an `IrConst` cannot carry an aggregate initializer. `IrFresh` can. Its DYNAMIC elements and fields are the
      // statements after it, in element order (`var_temp_dynamic_aggregate_init`, M5.1.7).
      const value: IrExpr =
        slot.type.kind === "elementary"
          ? { kind: "const", value: slot.init as IrValue, type: slot.type, span }
          : { kind: "fresh", init: slot.init, type: slot.type, span }
      resets.push({ kind: "assign", target: { slot: index, path: [], type: slot.type, span }, value, span }, ...assigned)
    }
  return resets
}

/**
 * A METHOD's or FUNCTION's locals whose initial value RUNS — on every call, after the locals start fresh (the backends
 * instantiate them per call): `t : INT := gLangVtdm` is 9 then 10 (`var_temp_dynamic_init_method`, `_function`; M5.1.6,
 * transpile-restructure 5.5), an aggregate's dynamic elements likewise. In local-slot order, which is declaration order;
 * one reading its own or a later local is refused, as a VAR_TEMP's is. Undefined when one is refused (reported).
 */
export function routineLocalInits(lw: Lowering): IrStmt[] | undefined {
  const out: IrStmt[] = []
  for (const [index, dynamic] of [...initFrame(lw).tempInits].sort(([a], [b]) => a - b)) {
    const assigned = lowerAll(lw, dynamic)
    if (assigned === undefined) return undefined
    const later = readsLater(assigned, (place) => (place.root === "local" && place.slot >= index ? (lw.localSlots[place.slot]?.name ?? "a later local") : undefined))
    if (later !== undefined)
      return lw.bail("init-reads-later", `${dynamic[0]!.name.text}'s initial value reads the local ${later}, whose value at that point of the call is not recorded`, dynamic[0]!.span)
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
