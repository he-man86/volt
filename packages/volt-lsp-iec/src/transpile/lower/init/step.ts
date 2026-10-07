/**
 * A POU's init step: what runs once before the first scan, in the order CODESYS runs it.
 */

import type { Lowering } from "../lowering.js"
import type { Span, TopLevel } from "../../../frontend/syntax/index.js"
import type { IrSlot, IrStmt } from "../../ir/index.js"
import { lookup } from "../../../frontend/symbols/index.js"
import type { InitStep } from "./state.js"
import { typeZero } from "../../../frontend/types/index.js"
import { declaredArgs, reaches, unreached, visit, writesGlobal } from "./fb-init.js"

/**
 * The init step: each instance's `call_after_global_init_slot` METHOD, run once before the first scan (conformance
 * `state_call_after_global_init_counts` — once per instance, however many scans follow). Instances are found through the
 * frame, nested instances and struct fields included, and the method is resolved by the instance's own type. One the walk
 * does not reach — an array element, a global, a routine's local — is refused: whether and when it would run is not
 * measured. Neither is the order between instances; the frame's is taken, as no recorded case can tell them apart.
 */
export function initStep(lw: Lowering, span: Span): IrStmt[] | undefined {
  // {attribute 'instance-path'} (user decision 2026-09-15): the STRING holds the instance's path from the project tree —
  // the device folder (before `Plc Logic`), the application folder (after it), then the instance hierarchy from the POU.
  // The simulator's own reads `Device.Sim.Device.Application…`, a segment the tree does not hold.
  const root = lookup(lw.project, lw.shared.root)?.symbol
  const tree = (root?.uri ?? "").split(/[\\/]/)
  const logic = tree.findIndex((segment) => segment.toLowerCase() === "plc logic")
  const application = logic > 0 && logic + 2 < tree.length ? `${tree[logic - 1]}.${tree[logic + 1]}` : undefined
  // Recorded (`fb_init_before_slot_method_nested`: 5, `fb_init_before_slot_method_sibling`: 7): every FB_Init runs before
  // any call_after_global_init_slot method, a holder's and a sibling's declared earlier alike; and a structured
  // initializer on an instance running FB_Init applies AFTER it (`fb_init_and_structured_initializer`: FB_Init saw 0, the
  // 9 stayed). They were interleaved per instance, in declaration order, the initializer first — an order no recording
  // showed (review of the FB_Init batch). So: the FB_Init calls, then those initializers, then the slot methods.
  const st: InitStep = {
    lw,
    span,
    root,
    application,
    globalArguments: new Set(),
    fbInitHeld: new Map(),
    known: new Map(),
    out: [],
    fbInitCalls: [],
    reapplied: [],
    slotCalls: [],
    declaredInits: new Map(),
  }
  const { fbInitCalls } = st
  // The POU's own initializers interleave with its instances the same way (transpile-review 23): those declared before an
  // instance whose init step does anything run before it. The rest keep their place after every FB_Init.
  const frame = lw.frame as IrSlot[]
  const ownInits = lw.initSequence?.bySlot ?? []
  let ownRun = 0
  for (const [slot, frameSlot] of [...frame].entries()) {
    const clear = () => void (frame[slot] = { ...frame[slot]!, init: typeZero(frameSlot.type) })
    const start = fbInitCalls.length
    if (!visit(st, { slot, path: [], type: frameSlot.type, span }, declaredArgs(lw, root?.ast as TopLevel | undefined, frameSlot.name), lw, frameSlot.init, clear)) return undefined
    const inside = fbInitCalls.splice(start)
    if (inside.length === 0) continue
    for (; ownRun < ownInits.length && ownInits[ownRun]!.slot <= slot; ownRun++) fbInitCalls.push(...ownInits[ownRun]!.statements)
    fbInitCalls.push(...inside)
  }
  // A PROGRAM this POU calls is an instance among the globals, visited as the frame's slots are — its FB_Init arguments, an
  // instance-path, an init-slot METHOD. They were `attr-init-unreached` (`fb_init_argument_in_program_with_method`: 4,
  // `init_slot_program_own`: 101). Any other global reaching one still is.
  const globals = lw.globals as IrSlot[]
  // by index: visiting one program can lower a METHOD that reaches another for the first time (review — it was skipped)
  for (let slot = 0; slot < globals.length; slot++) {
    const global = globals[slot]!
    if (global.section !== "program") continue
    const clear = () => void (globals[slot] = { ...globals[slot]!, init: typeZero(global.type) })
    if (!visit(st, { slot, path: [], type: global.type, span, root: "global" }, [], lw, global.init, clear)) return undefined
  }
  if (lw.globals.some((g) => g.section !== "program" && reaches(st, g.type))) return unreached(st, "the globals")
  for (const r of lw.routines.values()) if (r.state === "lowered" && r.routine.locals.some((l) => reaches(st, l.type))) return unreached(st, `${r.routine.name}'s locals`)
  // a global an FB_Init argument reads while an FB_Init of this init step writes globals: which value arrives is not recorded
  if (st.globalArguments.size > 0 && writesGlobal(lw, fbInitCalls))
    return lw.bail("fb-init-argument", "an FB_Init argument reads a global while an FB_Init writes globals — which value arrives is not recorded", span)
  return [...st.out, ...fbInitCalls, ...st.reapplied, ...ownInits.slice(ownRun).flatMap((b) => b.statements), ...st.slotCalls]
}
