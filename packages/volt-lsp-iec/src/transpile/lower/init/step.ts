/**
 * A POU's init step: what runs once before the first scan, in the order CODESYS runs it.
 */

import { type Lowering, zeroInit } from "../core/lowering.js"
import type { Span, TopLevel } from "../../../frontend/syntax/index.js"
import type { IrSlot, IrStmt } from "../../ir/index.js"
import { holdsCall, type IrNode, isPlace, someNode } from "../../ir/walk.js"
import { lookup } from "../../../frontend/symbols/index.js"
import { initFrame, type InitStep } from "./state.js"
import { typeZero } from "../../../frontend/types/index.js"
import { declaredArgs, reachesFbInit, unreached, visit, writesGlobal } from "./fb-init.js"
import { startStatement, startsAsStatement } from "./position.js"
import { bodyOf } from "../calls/routines.js"
import { leadingCalls } from "../core/ast-walk.js"

/**
 * The init step — ONE declaration-ordered walk (design.md §3.4): the frames in the recorded order, the POU's own, then each
 * PROGRAM it calls (M5.1.4; GVL frames run no statements — a GVL's initializer that does not fold is `init-not-constant`,
 * an instance there `attr-init-unreached`); within a frame, per declaration in order, an initializer that runs, a constant
 * once the walk has started (`position.ts`), or an instance's whole init (`fb-init.ts` `visit`: per class of its EXTENDS
 * chain its own fields then its FB_Init, then its structured initializer). Then each instance's
 * `call_after_global_init_slot` METHOD, after every frame (conformance `state_call_after_global_init_counts` — once per
 * instance, however many scans follow). An instance the walk does not reach — an array element, a global, a routine's
 * local — is refused: whether and when it would run is not measured.
 */
export function initStep(lw: Lowering, span: Span): IrStmt[] | undefined {
  // {attribute 'instance-path'} (user decision 2026-09-15): the STRING holds the instance's path from the project tree —
  // the device folder (before `Plc Logic`), the application folder (after it), then the instance hierarchy from the POU.
  // The simulator's own reads `Device.Sim.Device.Application…`, a segment the tree does not hold.
  const root = lookup(lw.project, lw.shared.root)?.symbol
  const tree = (root?.uri ?? "").split(/[\\/]/)
  const logic = tree.findIndex((segment) => segment.toLowerCase() === "plc logic")
  const application = logic > 0 && logic + 2 < tree.length ? `${tree[logic - 1]}.${tree[logic + 1]}` : undefined
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
    slotCalls: [],
    declaredInits: new Map(),
  }
  const { fbInitCalls } = st
  // THE POU'S OWN FRAME, declaration by declaration (transpile-review 23; the position rule, task 5.7)
  const frame = lw.slots as IrSlot[]
  const own = new Map<number, IrStmt[]>()
  for (const b of initFrame(lw).initSequence?.bySlot ?? []) own.set(b.slot, [...(own.get(b.slot) ?? []), ...b.statements])
  const pending = initFrame(lw).pendingInits
  const ordered: IrStmt[] = []
  let started = false
  for (const [slot, frameSlot] of [...frame].entries()) {
    const runs = pending.filter((p) => p.slot === slot)
    // a constant once the walk has started — an aggregate's static part too, when its dynamic elements run
    if (started && runs.every((p) => p.target !== undefined) && startsAsStatement(st, frameSlot.type, frameSlot.init, initFrame(lw).constants.has(slot))) {
      ordered.push(startStatement({ slot, path: [], type: frameSlot.type, span }, frameSlot.init))
      frame[slot] = { ...frame[slot]!, init: zeroInit(frameSlot.type) }
    }
    const statements = own.get(slot) ?? []
    if (statements.length > 0) {
      ordered.push(...statements)
      started = true
    }
    const clear = () => void (frame[slot] = { ...frame[slot]!, init: typeZero(frameSlot.type) })
    if (!visit(st, { slot, path: [], type: frameSlot.type, span }, declaredArgs(lw, root?.ast as TopLevel | undefined, frameSlot.name), lw, frame[slot]!.init, clear)) return undefined
    const inside = fbInitCalls.splice(0)
    if (inside.length > 0) {
      ordered.push(...inside)
      started = true
    }
  }
  // A PROGRAM this POU calls is an instance among the globals, visited as the frame's slots are — its FB_Init arguments, an
  // instance-path, an init-slot METHOD. They were `attr-init-unreached` (`fb_init_argument_in_program_with_method`: 4,
  // `init_slot_program_own`: 101). Any other global reaching one still is.
  const globals = lw.globals as IrSlot[]
  const programs: { slot: number; statements: IrStmt[] }[] = []
  // by index: visiting one program can lower a METHOD that reaches another for the first time (review — it was skipped)
  for (let slot = 0; slot < globals.length; slot++) {
    const global = globals[slot]!
    if (global.section !== "program") continue
    const clear = () => void (globals[slot] = { ...globals[slot]!, init: typeZero(global.type) })
    if (!visit(st, { slot, path: [], type: global.type, span, root: "global" }, [], lw, global.init, clear)) return undefined
    const statements = fbInitCalls.splice(0)
    if (statements.length > 0) programs.push({ slot, statements })
  }
  const programOrder = calledOrder(st, programs)
  if (programOrder === undefined) return undefined
  if (lw.globals.some((g) => g.section !== "program" && reachesFbInit(st, g.type, "init-step"))) return unreached(st, "the globals")
  for (const r of lw.routines.values()) if (r.state === "lowered" && r.routine.locals.some((l) => reachesFbInit(st, l.type, "init-step"))) return unreached(st, `${r.routine.name}'s locals`)
  const steps = [...ordered, ...programOrder.flatMap((p) => p.statements)]
  // a global an FB_Init argument reads while an FB_Init of this init step writes globals: which value arrives is not recorded
  if (st.globalArguments.size > 0 && writesGlobal(lw, steps))
    return lw.bail("fb-init-argument", "an FB_Init argument reads a global while an FB_Init writes globals — which value arrives is not recorded", span)
  // MORE THAN ONE init-slot METHOD whose order could show: their order among themselves is neither declaration nor frame
  // order — it moved with the names (`init_gvl_program_slot_order{,_renamed}`, M5.1.4) — and the attribute's value is a
  // priority nothing models. niche: accepted loss (0 occurrences in the corpora: no `call_after_global_init_slot`). Several
  // that each touch only their own instance (and read no storage another could write) run in any order alike
  // (`state_call_after_global_init_counts`, `fb_init_before_slot_method_*`).
  if (st.slotCalls.length > 1 && slotOrderShows(lw, st.slotCalls))
    return lw.bail("init-slot-order", `${st.slotCalls.length} call_after_global_init_slot METHODs whose order among themselves could show — not modelled`, span)
  return [...st.out, ...steps, ...st.slotCalls]
}

/**
 * The called PROGRAMs whose init runs statements, in the order CODESYS initializes them: the order the POU's body first
 * CALLS them (`init_frame_order_several`: called b then a, initialized b then a; `_renamed`: declared Z before A, called A
 * before Z, initialized A then Z — neither declaration nor name order). One alone needs no order. The recordings call them as
 * bare statements at the top of the body, so more than one where one is not FIRST NAMED by such a call statement — read
 * first, called first inside an expression or a branch, called through another POU — is `init-frame-order`: not recorded
 * (gate 5c: a read before the call, a call in an untaken branch, were ordered by the first call in silence).
 */
function calledOrder(st: InitStep, programs: readonly { slot: number; statements: IrStmt[] }[]): typeof programs | undefined {
  if (programs.length < 2) return programs
  const unit = st.root?.ast as TopLevel | undefined
  const body = unit === undefined || (unit.kind !== "program" && unit.kind !== "function_block") ? undefined : bodyOf(st.lw, unit, unit.body, undefined, { library: false })
  const calls = body === undefined || "code" in body ? new Map<string, number>() : leadingCalls(body.statements)
  const at = (p: { slot: number }) => calls.get(st.lw.globals[p.slot]!.name.toUpperCase())
  const uncalled = programs.find((p) => at(p) === undefined)
  if (uncalled !== undefined)
    return st.lw.bail("init-frame-order", `${st.lw.globals[uncalled.slot]!.name} runs initialization statements and is not first named by a call statement of ${st.lw.shared.root}'s own body — the order of several PROGRAMs' initialization is recorded only for bodies that call them so`, st.span)
  // CALLED through another POU — a PROGRAM, FB, METHOD, ACTION or FUNCTION body that calls it or runs an action or method
  // on it (gate 5c, second review: `Mid(); A_Prg(); Z_Prg();` with Mid calling Z_Prg was ordered A before Z in silence),
  // wherever that body runs: what is recorded is the root calling them itself. A READ of one from another POU stays
  // ordered by the root's calls (`initord_chain*`: each PROGRAM's initializer reads the next one's instance, confirmed).
  const root = st.lw.shared.root.toUpperCase()
  const ordered = new Set(programs.map((p) => p.slot))
  const callsOne = (n: IrNode): boolean =>
    !isPlace(n) && (n.kind === "call" || n.kind === "invoke") && n.instance?.root === "global" && n.instance.path.length === 0 && ordered.has(n.instance.slot)
  const others = [
    ...[...st.lw.layouts].flatMap(([key, l]) => (key === root ? [] : [l.body ?? []])),
    ...[...st.lw.routines.values()].flatMap((r) => (r.state === "lowered" ? [r.routine.body] : [])),
  ]
  const through = others.find((body) => someNode(body, callsOne))
  if (through !== undefined)
    return st.lw.bail("init-frame-order", "a PROGRAM that runs initialization statements is called through another POU — the order of several PROGRAMs' initialization is recorded only for a body that calls them itself", st.span)
  return [...programs].sort((a, b) => at(a)! - at(b)!)
}

/** Whether the order among several init-slot METHODs could show: one calls anything, writes a global, or touches storage
 *  another may write — a called PROGRAM's, a dereference's, an in-out's, a lent instance's, the byte image's. */
function slotOrderShows(lw: Lowering, calls: readonly IrStmt[]): boolean {
  const foreign = (n: IrNode): boolean => {
    if (!isPlace(n)) return n.kind === "assign" && n.target.root === "global"
    if (n.guard !== undefined) return true
    if (n.root === undefined || n.root === "this" || n.root === "local") return false
    return n.root !== "global" || lw.globals[n.slot]?.section === "program"
  }
  return calls.some((c) => {
    const key = c.kind === "eval" && c.value.kind === "invoke" ? c.value.routine : undefined
    const called = key === undefined ? undefined : lw.routines.get(key)
    return called?.state !== "lowered" || holdsCall(called.routine.body) || someNode(called.routine.body, foreign)
  })
}
