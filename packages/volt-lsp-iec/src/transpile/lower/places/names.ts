/**
 * Names: which place a bare name is (its precedence), and which METHOD or ACTION a name on an FB is.
 */

import type { FbType, Lowering, RoutineSymbol } from "../core/lowering.js"
import type { Expr, Span } from "../../../frontend/syntax/index.js"
import type { IrRoutine, Place } from "../../ir/index.js"
import { globalPlace } from "./globals.js"
import { lookup, lookupMember } from "../../../frontend/symbols/index.js"
import { selfFb } from "./self.js"
import { calledRoutine } from "../calls/routines.js"
import { pointerFrame } from "../pointers/state.js"
import { bodyChain } from "../core/chain.js"
import type { PendingBody } from "../core/shared.js"

/**
 * A bare name's place, by the precedence a body sees it (transpile-review 19): the routine's own local (its result,
 * inputs and VAR), its own VAR_IN_OUT / VAR_OUTPUT, a METHOD's VAR_STAT, the frame's slot (then an in-out the routine
 * reaches on its FB), and last a global.
 */
export function namePlace(lw: Lowering, e: Extract<Expr, { kind: "ident_expr" }>): Place | undefined {
  // an ANY input is read only as `.diSize`; its value, `pValue` and `typeClass` are not measured
  if (pointerFrame(lw).anyInputs.has(e.name.toUpperCase())) return lw.bail("any-input", `${e.name} is an ANY input, used other than as .diSize`, e.span)
  // a routine's own local (its result, inputs and VAR) shadows the instance's field of the same name
  const local = lw.localByName.get(e.name.toUpperCase())
  if (local !== undefined) return { slot: local, path: [], type: lw.localSlots[local]!.type, span: e.span, root: "local" }
  // ...and so does its own VAR_IN_OUT / VAR_OUTPUT — before a VAR_STAT or field of the FB it runs on (`tr_19_method_inout_shadows_*`).
  // The FB's own in-outs a routine reaches (`ofInstance`) are the FB's names, so they still come after its VAR_STAT.
  const inout = lw.inoutByName.get(e.name.toUpperCase())
  if (inout !== undefined && lw.routineMode && lw.inoutSlots[inout]!.ofInstance !== true)
    return { slot: inout, path: [], type: lw.inoutSlots[inout]!.type, span: e.span, root: "inout" }
  // a METHOD's VAR_STAT: one global, named for the method that declares it (conformance `state_var_stat_two_instances`)
  const stat = lw.statics.get(e.name.toUpperCase())
  if (stat !== undefined) return { slot: stat, path: [], type: lw.shared.globals.slots[stat]!.type, span: e.span, root: "global" }
  const slot = lw.byName.get(e.name.toUpperCase())
  if (slot === undefined && inout !== undefined)
    return { slot: inout, path: [], type: lw.inoutSlots[inout]!.type, span: e.span, root: "inout" }
  if (slot === undefined) {
    // A VAR_TEMP this code SEES but does not run — its FB's ACTION (a PROPERTY accessor's reach is unrecorded) — holds no
    // value of this run: refused. Where it is not visible — a METHOD, a derived body — the name is whatever else declares
    // it, a global of that name (`var_temp_named_in_method_beside_global`: 41 over a global 40): the symbols' answer, which
    // skips a VAR_TEMP the scope does not reach (`symbols/scope-nav.ts` `lookup`).
    if (lookup(lw.scope, e.name)?.symbol.varSection === "VAR_TEMP") return outerTemp(lw, e.name, e.span)
    const global = globalPlace(lw, e.name, e.span)
    if (global !== undefined) return global
    // `symbols/` decides what the name IS — a GVL, an enum member, a library global — so the report names
    // the real reason rather than "unknown identifier".
    const found = lookup(lw.scope, e.name)?.symbol
    const what = found === undefined ? "does not resolve" : `is a ${found.kind}, which has no frame slot yet`
    return lw.bail("place-not-local", `${e.name} ${what}`, e.span)
  }
  return { slot, path: [], type: lw.slots[slot]!.type, span: e.span }
}

/** A METHOD or ACTION a bare name inside an FB names — `M()` is `THIS^.M()` (conformance `fbcall_bare_method_call`). */
export function ownMember(lw: Lowering, name: string): RoutineSymbol | undefined {
  const frame = selfFb(lw)
  if (frame?.scope === undefined || lookup(lw.scope, name)?.symbol.kind === "function") return undefined
  const member = lookupMember(frame.scope, name)
  return member?.kind === "method" || member?.kind === "action" ? member : undefined
}

/** A METHOD or ACTION called on an instance of `frame` — by the instance's own type, so an override wins wherever the
 *  call is written (conformance `inh_base_body_reaches_override`, `inh_inherited_method_reaches_override`). */
export function methodOf(lw: Lowering, frame: FbType, name: string, span: Span, call?: Extract<Expr, { kind: "call" }>): IrRoutine | undefined {
  const sym = frame.scope === undefined ? undefined : lookupMember(frame.scope, name)
  if (sym?.kind !== "method" && sym?.kind !== "action") return lw.bail("call-method", `${name} is not a METHOD or ACTION lowering can call`, span)
  return calledRoutine(lw, sym, frame, span, sym.name, call)
}

/**
 * WHETHER `name` IS A VAR_TEMP OF THE FB `unit` OR OF ONE OF ITS BASES — asked of a MEMBER path, `inst.x` / `THIS^.x`: a
 * VAR_TEMP is storage of its body's run only (a local, 7.6.4), no member of the instance. Through an instance the vendors
 * refuse it (`oopa_write_var_temp`: "'scratch' is no input"); `THIS^.scratch` in the body itself they compile and read 0
 * where the body stored 5 (`var_temp_named_through_this`) — not modelled, niche: accepted loss (0 occurrences in the
 * corpora). A bare name is the symbols' to resolve (`namePlace`).
 */
export function namesOuterTemp(lw: Lowering, unit: PendingBody["unit"] | undefined, name: string): boolean {
  const key = name.toUpperCase()
  return (
    unit !== undefined &&
    bodyChain(lw, unit).units.some((u) => u.varSections.some((s) => s.sectionKind === "VAR_TEMP" && s.decls.some((d) => d.names.some((n) => n.text.toUpperCase() === key))))
  )
}

/** The refusal `namesOuterTemp` answers for. */
export function outerTemp(lw: Lowering, name: string, span: Span): undefined {
  return lw.bail("var-temp-outside-body", `${name} is a VAR_TEMP — storage of its own body's run, named here outside that body`, span)
}

