/**
 * The FRAME a called routine is lowered in, beyond its declared locals: its inputs (an ANY input's hidden size, an
 * `ARRAY[*]` in-out's hidden bounds), the hidden in-outs a call binds (an ANY input's variable, a STRING CURSOR's string,
 * a pointer the body only dereferences) and the FB's own in-outs a METHOD or ACTION reaches. Split out of
 * `calledRoutine` (`routines.ts`, transpile-restructure 1.9.4).
 */

import type { FbType, Lowering, RoutineSymbol } from "../core/lowering.js"
import type { StatementList, VarSection } from "../../../frontend/syntax/index.js"
import { declareInOuts, declareOpenBounds, declareVars } from "../storage/declare.js"
import { positionalOf, positionalParameters } from "./parameters.js"
import { ANY_FAMILIES, elementaryRef, type Type, typeZero } from "../../../frontend/types/index.js"
import { ANY_TARGET, anyInputsOf } from "../pointers/any.js"
import { CURSOR, type CursorArgument, cursorInputsOf } from "../pointers/cursor.js"
import { BORROWED, borrowedInputsOf, borrowedPointerSlots } from "../pointers/borrowed.js"
import { overridesCalled, reachedNames } from "../core/ast-walk.js"
import { chainNames, pouChain } from "../core/chain.js"
import { pointerFrame } from "../pointers/state.js"
import { shadowedInOutsOf } from "./binding.js"
import { nested } from "../core/nested.js"

/** The routine's inputs, in order — the slots a call stores its inputs into — recorded under `key` for its callers. */
export function routineInputs(lw: Lowering, r: Lowering, sections: readonly VarSection[], key: string): number[] {
  const firstInput = r.localSlots.length
  // an ANY / ANY_* input is a hidden DINT the call fills with its argument's size (conformance `state_any_input_sizes`)
  for (const section of sections.filter((s) => s.sectionKind === "VAR_INPUT"))
    for (const decl of section.decls) {
      if (decl.type.kind !== "named_type" || !ANY_FAMILIES.has(decl.type.name.text.toUpperCase())) {
        declareVars(r, [{ ...section, decls: [decl] }])
        continue
      }
      for (const n of decl.names) {
        pointerFrame(r).anyInputs.add(n.text.toUpperCase())
        r.localByName.set(n.text.toUpperCase(), r.localSlots.length)
        r.localSlots.push({ name: n.text, type: elementaryRef("DINT"), section: "VAR_INPUT", init: 0n })
      }
    }
  // an `ARRAY[*]` in-out's bounds: hidden inputs every call fills from the array it binds (design §26)
  declareOpenBounds(r, sections.filter((s) => s.sectionKind === "VAR_IN_OUT"), "VAR_INPUT")
  const inputs = Array.from({ length: r.localSlots.length - firstInput }, (_, i) => firstInput + i)
  anyInputsOf(lw).set(key, new Set(inputs.filter((i) => pointerFrame(r).anyInputs.has(r.localSlots[i]!.name.toUpperCase()))))
  positionalOf(lw).set(
    key,
    positionalParameters(sections).map(({ name, output }) => ({ name, output })),
  )
  return inputs
}

/** The hidden in-outs this variant's call binds: an ANY input's variable, a STRING CURSOR's string, a borrowed pointer. */
export function hiddenInOuts(
  lw: Lowering,
  r: Lowering,
  targets: ReadonlyMap<string, Type>,
  cursors: ReadonlyMap<string, CursorArgument>,
  statements: StatementList,
  key: string,
): void {
  // the ANY inputs this variant was given a variable for: one hidden VAR_IN_OUT each, which `pValue` names
  for (const [input, type] of targets) {
    pointerFrame(r).anyTargets.set(input, r.inoutSlots.length)
    r.inoutSlots.push({ name: `${ANY_TARGET}${input}`, type, section: "VAR_IN_OUT", init: typeZero(type) })
  }
  // FORM 2: a `POINTER TO T` parameter this body only dereferences becomes a hidden VAR_IN_OUT of T, and every
  // `p^` becomes the place the CALL binds to it. One lowering serves every call site — which is the whole point,
  // since `ptrparam_two_targets` calls one routine with two different `ADR` arguments and gets two answers.
  // A STRING CURSOR: a character pointer this call fills with a string's address walks that string — one hidden
  // VAR_IN_OUT of the caller's exact string type, and the pointer keeps its byte offset (`PointerFrame.cursors`)
  const cursorByInput = new Map<number, number>()
  for (const [input, { type: text, shares, offset }] of cursors) {
    const local = r.localByName.get(input)!
    const inout = shares === undefined ? r.inoutSlots.length : pointerFrame(r).cursors.get(shares)!.inout
    pointerFrame(r).cursors.set(input, { inout, unit: (r.localSlots[local]!.type as Extract<Type, { kind: "pointer" }>).target, offset })
    r.inoutByName.set(`${input}^`, inout)
    cursorByInput.set(local, inout)
    if (shares === undefined)
      r.inoutSlots.push({ name: `${CURSOR}${r.localSlots[local]!.name}`, type: text, section: "VAR_IN_OUT", init: typeZero(text) })
  }
  cursorInputsOf(lw).set(key, cursorByInput)
  const borrowedByInput = new Map<number, number>()
  for (const [name, slot] of borrowedPointerSlots(r, statements)) {
    if (pointerFrame(r).cursors.has(name)) continue
    const pointee = (slot.type as Extract<Type, { kind: "pointer" }>).target
    pointerFrame(r).borrowedPointers.set(name, r.inoutSlots.length)
    borrowedByInput.set(r.localSlots.indexOf(slot), r.inoutSlots.length)
    r.inoutSlots.push({ name: `${BORROWED}${slot.name}`, type: pointee, section: "VAR_IN_OUT", init: typeZero(pointee) })
  }
  borrowedInputsOf(lw).set(key, borrowedByInput)
}

/**
 * The FB's own VAR_IN_OUT a METHOD or ACTION reaches — each a parameter the call binds (`lowerInvoke`). Taken from the
 * FB's declaration, in its scope, and only those the routine can reach: they were every in-out of the FB's LOWERED body,
 * so a METHOD that never names one was refused from outside, and which POU lowered first decided (review of batch 3a).
 */
export function instanceInOuts(lw: Lowering, r: Lowering, sym: RoutineSymbol, frame: FbType, statements: StatementList): void {
  const reached = reachedNames(r, statements)
  // The owner's EXTENDS chain, base first: a base's in-out is the derived FB's too, reached through the base's METHODs
  // (`callshape_inout_base_method_from_derived_method`: 11, `callshape_inout_super_method_from_override`: 11). They were
  // the owner's own only, so a derived METHOD calling such a base METHOD was `call-fb-inout` (pro2193's ConveyorFB).
  const sections: VarSection[] = []
  // Below the owner's chain, the FRAME's — the instance's type — when the routine calls a METHOD overridden there: a base
  // METHOD run on a derived instance then reaches the derived FB's own in-outs (`callshape_inout_override_from_outside_base_method`).
  // Not otherwise: one calling no override took them all, and faulted unbound (review).
  const ownerChain = chainNames(lw, sym.owner.name)
  const overridden = overridesCalled(frame, ownerChain, statements)
  for (const unit of pouChain(lw, frame.name))
    if (overridden || ownerChain.has(unit.name.text.toUpperCase())) sections.unshift(...unit.varSections.filter((s) => s.sectionKind === "VAR_IN_OUT"))
  const declared = nested(r, sym.owner, {}, (d) => (declareInOuts(d, sections), d)).value
  for (const slot of declared.inoutSlots) {
    const own = slot.name.toUpperCase()
    if (reached !== "all" && !reached.has(own)) continue
    // a parameter or local of the routine by that name hides the FB's in-out: a call that would take it is refused (review)
    if (r.inoutByName.has(own) || r.localByName.has(own)) {
      shadowedInOutsOf(r).add(own)
      continue
    }
    r.inoutByName.set(own, r.inoutSlots.length)
    r.inoutSlots.push({ ...slot, ofInstance: true })
  }
}
