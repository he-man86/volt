/**
 * The init step's attributes: `call_after_global_init_slot` METHODs, called once before the first scan, and
 * `instance-path` fields, given the instance's path from the project tree.
 */

import type { Lowering } from "../core/lowering.js"
import type { Fb, InitStep } from "./state.js"
import { lookupMember, type Symbol } from "../../../frontend/symbols/index.js"
import type { TopLevel } from "../../../frontend/syntax/index.js"
import type { IrRoutine, Place } from "../../ir/index.js"
import { ownProgram, programReentrant, programTarget, routineCallee } from "../calls/reentrancy.js"
import { stored } from "../values/convert.js"
import { calledRoutine } from "../calls/routines.js"
import { UNKNOWN } from "../../../frontend/types/index.js"
import { bodyChain, scopeChain } from "../core/chain.js"
import { fieldOf } from "../places/path.js"

export const INIT_ATTRIBUTE = "call_after_global_init_slot"

/** An FB type's `call_after_global_init_slot` METHOD, its own or a base's, resolved by the type. */
export function initMethod(lw: Lowering, fb: Fb): Symbol | undefined {
  for (const s of scopeChain(fb.scope))
    for (const list of s.symbols.values())
      for (const sym of list)
        if (sym.kind === "method" && lw.attributes.get(sym.ast as TopLevel)?.has(INIT_ATTRIBUTE)) return lookupMember(fb.scope!, sym.name)
  return undefined
}

/** The fields of an FB type (its own and its bases') that carry `{attribute 'instance-path'}`. */
export function pathFields(lw: Lowering, fb: Fb): string[] {
  const names: string[] = []
  const unit = lw.bodies.get(fb.name.toUpperCase())?.unit
  for (const own of unit === undefined ? [] : bodyChain(lw, unit).units)
    for (const section of own.varSections)
      for (const decl of section.decls) if (lw.attributes.get(decl)?.has("instance-path")) names.push(...decl.names.map((n) => n.text))
  return names
}

/** The instance's `instance-path` fields, each assigned its path from the project tree (`st.out`). */
export function instancePaths(st: InitStep, place: Place, t: Fb): boolean {
  const { lw, span, root, application } = st
  const paths = pathFields(lw, t)
  if (paths.length === 0) return true
  if (application === undefined) return lw.bail("attr-instance-path", `${t.name}'s instance-path needs the project tree (Device/Plc Logic/Application), which this source is not in`, span) ?? false
  if (root?.kind !== "program") return lw.bail("attr-instance-path", `an FB lowered on its own has no instance path`, span) ?? false
  // The program the instance lives in, then its path: the root's own slot; a PROGRAM lowered as its one instance, whose
  // slot IS the program (review); or a PROGRAM this POU calls, its instance among the globals.
  const top = place.root === "global" ? [lw.globals[place.slot]!.name] : ownProgram(st, place) ? [root.name] : [root.name, lw.slots[place.slot]!.name]
  const text = [application, ...top, ...place.path.flatMap((step) => (step.kind === "field" ? [step.name] : []))].join(".")
  for (const name of paths) {
    const field = fieldOf(lw, t.name, name)
    if (field === undefined || field.type.kind !== "elementary" || field.type.elem.family !== "string")
      return lw.bail("attr-instance-path", `${name} carries instance-path but is not a STRING`, span) ?? false
    const target: Place = { ...place, path: [...place.path, { kind: "field", name: field.name }], type: field.type }
    st.out.push({ kind: "assign", target, value: { kind: "const", value: stored(text, field.type), type: field.type, span }, span })
  }
  return true
}

/** The instance's `call_after_global_init_slot` METHOD call (`st.slotCalls`), when its type has one. */
export function slotMethodCall(st: InitStep, place: Place, t: Fb): boolean {
  const { lw, span } = st
  const sym = initMethod(lw, t)
  if (sym === undefined) return true
  const routine: IrRoutine | undefined = calledRoutine(lw, sym, t, span)
  if (routine === undefined) return false
  if (routine.inputs.length > 0 || routine.inouts.length > 0) return lw.bail("attr-init-inputs", `${sym.name} takes arguments`, span) ?? false
  if (programReentrant(lw, routineCallee(lw, routine), programTarget(place)) !== undefined)
    return lw.bail("call-program-reentrant", `${sym.name} may reach the PROGRAM its instance lives in, which it runs moved out of`, span) ?? false
  st.slotCalls.push({ kind: "eval", value: { kind: "invoke", routine: routine.key, instance: place, inputs: [], inouts: [], type: UNKNOWN, span }, span })
  return true
}
