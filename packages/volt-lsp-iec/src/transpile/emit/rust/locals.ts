/**
 * A ROUTINE'S LOCALS AS RUST BINDINGS (lean 7.7.1-7.7.3) — which are `mut`, which no read can see the initial value of, and
 * where each is declared — so a generated fn needs no blanket `#[allow(unused_mut, unused_variables,
 * unused_assignments)]`: what rustc would say of a binding is decided here, from the IR, before it is printed.
 */
import type { IrBinding, IrCall, IrInvoke, IrPou, IrRoutine, IrStmt, Place } from "../../ir/index.js"
import { isPlace, type IrNode, someNode, somePlace, writtenPlaces } from "../../ir/walk.js"
import { stringKind } from "../../../frontend/types/index.js"
import { type Printer, reachOfBody } from "./printer.js"

/** How many places in the body write each routine-local slot (`writtenPlaces`): an in-out of a callee is written unless
 *  the callee takes it read-only (a VAR_IN_OUT CONSTANT, `IrSlot.readOnly`). */
export function writeSites(p: Printer, body: IrRoutine["body"]): Map<number, number> {
  const readOnly = (call: IrInvoke | IrCall, i: number): boolean =>
    (call.kind === "invoke" ? p.routines.get(call.routine)?.inouts[i] : p.layouts.get(call.fb.toUpperCase())?.layout.inouts?.[i])?.readOnly === true
  const sites = new Map<number, number>()
  for (const at of writtenPlaces(body, readOnly)) if (at.root === "local") sites.set(at.slot, (sites.get(at.slot) ?? 0) + 1)
  return sites
}

/** A store of the WHOLE local as a plain `x = v` — not a field or element of it, and not a STRING stored into with
 *  `IecStr::store` (another capacity), which reads the buffer it writes into. */
function plainStore(s: IrStmt): s is Extract<IrStmt, { kind: "assign" }> {
  if (s.kind !== "assign" || s.target.root !== "local" || s.target.path.length > 0) return false
  const t = s.target.type
  return stringKind(t) === undefined || (s.value.type.kind === "elementary" && t.kind === "elementary" && s.value.type.length === t.length)
}

/**
 * The locals (by index into `[...locals, ...inouts]`, `fieldNames`' order) and in-outs the body never USES, as rustc
 * counts a use: a local named nowhere but as the target of a plain store, an in-out named nowhere at all (a store
 * through it is one). The result is always used (it is handed back); a lent instance is `__lent_N` already.
 */
export function unreadOf(routine: IrRoutine): Set<number> {
  const stored = new Set<Place>()
  someNode(routine.body, (n) => (!isPlace(n) && plainStore(n as IrStmt) && stored.add((n as Extract<IrStmt, { kind: "assign" }>).target), false))
  const read = new Set<string>()
  someNode(routine.body, (n) => (isPlace(n) && !stored.has(n) && (n.root === "local" || n.root === "inout") && read.add(`${n.root}:${n.slot}`), false))
  const out = new Set<number>()
  routine.locals.forEach((_, i) => i !== routine.result && !read.has(`local:${i}`) && out.add(i))
  routine.inouts.forEach((_, i) => !read.has(`inout:${i}`) && out.add(routine.locals.length + i))
  return out
}

/** The parameters of a routine no run can see (`deadParamsOf`): positions in `IrRoutine.inputs` and `IrRoutine.inouts`. */
export interface DeadParams {
  readonly inputs: ReadonlySet<number>
  readonly inouts: ReadonlySet<number>
}

/**
 * THE PARAMETERS NO RUN CAN SEE (lean 7.7.7, 7.7.9) — by routine key: each input the body never uses (`unreadOf`) that
 * every call hands a constant, which reads nothing, so leaving it out changes no order either; and each in-out the body
 * never names that every call binds to a place no binding can fault on (no dereference, no image byte, no index but a
 * constant). A borrowed `POINTER TO` input (form 2) is the first: every `p^` became the hidden in-out, and each call
 * handed the pointer `0`; an ANY input whose size folded into its variant, and whose `pValue` the body never reads, is
 * both. Neither the routine's parameter nor any call's argument is printed (`printRoutine`, `exprInvoke`).
 */
export function deadParamsOf(pou: IrPou): ReadonlyMap<string, DeadParams> {
  const live = new Map<string, { inputs: Set<number>; inouts: Set<number> }>()
  const inert = (b: IrBinding): boolean =>
    !("kind" in b) && b.guard === undefined && b.root !== "image" && b.path.every((s) => s.kind !== "index" || s.index.kind === "const")
  someNode([...pou.body, ...(pou.init ?? []), ...pou.routines.flatMap((r) => r.body), ...pou.layouts.flatMap((l) => l.body ?? [])], (n) => {
    if (!isPlace(n) && n.kind === "invoke") {
      const at = live.get(n.routine) ?? { inputs: new Set<number>(), inouts: new Set<number>() }
      n.inputs.forEach((a, k) => a.kind !== "const" && at.inputs.add(k))
      n.inouts.forEach((b, i) => !inert(b) && at.inouts.add(i))
      live.set(n.routine, at)
    }
    return false
  })
  const out = new Map<string, DeadParams>()
  for (const r of pou.routines) {
    const unread = unreadOf(r)
    const inputs = new Set(r.inputs.flatMap((i, k) => (unread.has(i) && live.get(r.key)?.inputs.has(k) !== true ? [k] : [])))
    const inouts = new Set(r.inouts.flatMap((_, i) => (unread.has(r.locals.length + i) && live.get(r.key)?.inouts.has(i) !== true ? [i] : [])))
    if (inputs.size > 0 || inouts.size > 0) out.set(r.key, { inputs, inouts })
  }
  return out
}

/**
 * WHETHER A ROUTINE'S FN IS `#[must_use]` (lean 7.7.13): it returns a value and can write nothing its caller sees — a
 * FUNCTION (no `&mut self`) handed no `g`/`prg`/`__mem`, no instance lent, and every in-out it still takes lent
 * read-only (a VAR_IN_OUT CONSTANT). Calling one for nothing is a call that does nothing: clippy's
 * `must_use_candidate` named exactly these, and a statement that discards one prints `let _ =` (`stmt.ts`).
 */
export function mustUse(p: Printer, routine: IrRoutine): boolean {
  if (routine.kind !== "function" || routine.result === undefined || (routine.lent ?? []).length > 0) return false
  const reach = reachOfBody(p, routine.key)
  if (reach.usesGlobals || reach.usesPrograms || reach.usesImage === true) return false
  const dead = p.dead.get(routine.key)?.inouts
  return routine.inouts.every((slot, i) => dead?.has(i) === true || slot.readOnly === true)
}

/** The assigned locals at a point of the body, or `dead` where control cannot reach. */
type Assigned = ReadonlySet<number> | "dead"

/**
 * WHICH LOCALS NO READ CAN SEE THE INITIAL VALUE OF — definite assignment over the IR's structured control flow, the
 * analysis rustc's own borrow check runs, kept at least as cautious: a read sees a local's initial value unless a plain
 * store to it stands before the read on EVERY path. A loop's body may run no pass (its stores do not reach past the
 * loop), an IF's two branches meet, an EXIT / CONTINUE / RETURN ends its path; a RETURN reads the result, and so does
 * the end of the body. Such a local is declared with no initial value — rustc then proves it set before each read —
 * where printing one is a value rustc reports is never read (`unused_assignments`).
 */
export function lateInit(routine: IrRoutine): Set<number> {
  const seen = new Set<number>()
  // what evaluating `n` reads, against the locals assigned before it, and the locals it stores in passing: a call's
  // frozen in-out index (written where it is bound, read by the call after it) and a whole local a copy is written back to
  const effects = (n: IrNode | readonly IrNode[], st: ReadonlySet<number>): ReadonlySet<number> => {
    const stores: Place[] = []
    someNode(n, (x) => {
      if (isPlace(x)) return false
      const at = x.kind === "freeze" ? x.temp : x.kind === "copy" ? x.back : undefined
      if (at !== undefined && at.root === "local" && at.path.length === 0) stores.push(at)
      return false
    })
    somePlace(n, (at) => (!stores.includes(at) && at.root === "local" && !st.has(at.slot) && seen.add(at.slot), false))
    return stores.length === 0 ? st : new Set([...st, ...stores.map((at) => at.slot)])
  }
  const meet = (a: Assigned, b: Assigned): Assigned => (a === "dead" ? b : b === "dead" ? a : new Set([...a].filter((x) => b.has(x))))
  const list = (stmts: readonly IrStmt[], st: Assigned): Assigned => {
    for (const s of stmts) {
      if (st === "dead") return st
      st = stmt(s, st)
    }
    return st
  }
  const stmt = (s: IrStmt, st: ReadonlySet<number>): Assigned => {
    switch (s.kind) {
      case "assign":
        return plainStore(s) ? new Set([...effects(s.value, st), s.target.slot]) : effects(s, st)
      case "if": {
        const at = effects(s.cond, st)
        return meet(list(s.then, at), list(s.else, at))
      }
      case "switch": {
        const at = effects(s.selector, st)
        return [...s.arms.map((a) => list(a.body, at)), list(s.else, at)].reduce(meet)
      }
      case "loop": {
        const entry = list(s.init, st)
        if (entry === "dead") return entry
        const head = s.test !== undefined && !s.test.atEnd ? effects(s.test.cond, entry) : entry
        const body = list(s.body, head)
        const stepped = body === "dead" ? body : list(s.step, body)
        if (s.test !== undefined && s.test.atEnd && stepped !== "dead") effects(s.test.cond, stepped)
        return entry
      }
      case "break":
      case "continue":
        return "dead"
      case "return":
        if (routine.result !== undefined && !st.has(routine.result)) seen.add(routine.result)
        return "dead"
      case "call":
      case "eval":
        return effects(s, st)
    }
  }
  const end = list(routine.body, new Set())
  if (end !== "dead" && routine.result !== undefined && !end.has(routine.result)) seen.add(routine.result)
  return new Set(routine.locals.flatMap((_, i) => (routine.inputs.includes(i) || seen.has(i) ? [] : [i])))
}

/**
 * The locals some run of the body may store TWICE — the ones a late-initialized binding needs `mut` for. A late one
 * stored once on every path (`let x; if c { x = 1 } else { x = 2 }`) needs none (rustc's `unused_mut`). Followed as
 * `lateInit` follows the body, with "maybe stored" for "surely stored": the branches of an IF join, and a store in a
 * loop's body, its step or its test may run on a second pass.
 */
export function storedTwice(p: Printer, routine: IrRoutine): Set<number> {
  const twice = new Set<number>()
  const sites = (n: IrNode | readonly IrNode[]): number[] => [...writeSites(p, (Array.isArray(n) ? n : [n]) as IrStmt[]).entries()].flatMap(([slot, k]) => (k > 0 ? [slot] : []))
  const store = (slots: readonly number[], st: ReadonlySet<number>): Set<number> => {
    for (const slot of slots) if (st.has(slot)) twice.add(slot)
    return new Set([...st, ...slots])
  }
  const list = (stmts: readonly IrStmt[], st: ReadonlySet<number>): ReadonlySet<number> => stmts.reduce((at, s) => stmt(s, at), st)
  const stmt = (s: IrStmt, st: ReadonlySet<number>): ReadonlySet<number> => {
    switch (s.kind) {
      case "if": {
        const [a, b] = [list(s.then, st), list(s.else, st)]
        return new Set([...a, ...b])
      }
      case "switch":
        return new Set([...s.arms.flatMap((a) => [...list(a.body, st)]), ...list(s.else, st)])
      case "loop": {
        const entry = list(s.init, st)
        const inside = sites([...s.body, ...s.step])
        for (const slot of inside) twice.add(slot)
        return new Set([...entry, ...inside])
      }
      default:
        return store(sites(s), st)
    }
  }
  list(routine.body, new Set())
  return twice
}

/**
 * Whether the body's first word on the local `slot` is a plain store of the whole of it at the body's top level — where
 * a late-initialized local is declared, `let x: T = v;` (clippy's `needless_late_init` names a bare `let x;` there).
 */
export function storedFirstAtTop(routine: IrRoutine, slot: number): boolean {
  for (const s of routine.body) {
    if (plainStore(s) && s.target.slot === slot) return !somePlace(s.value, (at) => at.root === "local" && at.slot === slot)
    if (somePlace(s, (at) => at.root === "local" && at.slot === slot)) return false
  }
  return false
}
