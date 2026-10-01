/**
 * The IR interpreter — a backend, and the reference the other backends are checked against.
 *
 * It runs the SAME IR the Rust emitter prints, which is the point: a lowering bug shows up in both, and an
 * emitter bug shows up as a disagreement between them rather than as a silently wrong number. It walks a
 * frame of slots — no name lookup, no scope chain, no types at run time; lowering already answered all three.
 *
 * ponytail: a tree compiled once into closures (`compileExpr`, `compileStmt`). It is the oracle and the fast path to a green test, not the shipping runtime — if
 * scan throughput ever matters, that is what the Rust backend is for.
 */
import {
  type Access,
  type IrExpr,
  type IrInvoke,
  type IrLayout,
  type IrCall,
  type IrPou,
  type IrRoutine,
  type IrStmt,
  peelArray,
  type Place,
} from "../ir/index.js"
import type { Type } from "../../frontend/types/index.js"
import {
  bool,
  coerce,
  copy,
  eq,
  fit,
  instantiate,
  num,
  ord,
  type Val,
  visible,
} from "../ir/values.js"
import { binaryValue, builtinValue, selectedArg, unaryValue } from "../ir/evaluate.js"
export type { Val } from "../ir/values.js"

type Signal = "none" | "break" | "continue" | "return"

/**
 * A HARNESS gave up on a loop — not a program outcome. CODESYS caps no loop (`tr_27_loop_cap_*` run 1,000,001 and
 * 5,000,000 passes), so neither backend does; a harness that runs code it cannot trust to terminate passes
 * `run(pou, { loopGuard })`, and this is thrown on the body entry past the guard: one pass = one body entry.
 */
export class LoopGuardError extends RangeError {
  constructor(readonly guard: number) {
    super(`loop entered its body more than ${guard} times (harness loop guard)`)
  }
}

/** How a harness runs a POU. */
export interface RunOptions {
  /** Throw {@link LoopGuardError} when one loop enters its body more than this many times. Unset: no bound. */
  readonly loopGuard?: number
}

/** Where a value lives: a container (a frame, a record, an array) and the key into it. */
type Cell = { container: Record<string | number, Val>; key: string | number }

class Machine {
  /**
   * @param root   the frame a body runs on — the POU's slot array, or an FB instance's record
   * @param keys   the key of each slot index in `root`: the index itself, or the field's upper-cased name
   * @param inouts the caller's variables bound to the body's VAR_IN_OUT parameters, by parameter index
   */
  constructor(
    readonly root: Record<string | number, Val>,
    readonly keys: readonly (string | number)[],
    private readonly inouts: readonly Cell[],
    readonly layouts: ReadonlyMap<string, IrLayout>,
    private readonly routines: ReadonlyMap<string, IrRoutine>,
    /** The application's globals — ONE array every body shares. */
    readonly globals: Val[],
    /** The harness's loop guard ({@link RunOptions}) — undefined runs every pass. */
    readonly guard: number | undefined,
    /** The running METHOD's, ACTION's or FUNCTION's per-call locals. */
    readonly locals: Val[] = [],
    /** The FB instances this body's caller lends it (`lent` places), by slot. */
    private readonly lent: readonly Cell[] = [],
  ) {}

  /** A METHOD, ACTION or FUNCTION: fresh locals, the inputs stored into them, the body run on the instance (or on nothing),
   *  and the result slot's value — FALSE stands in for a routine without one, which only an `eval` calls. */
  invoke(e: IrInvoke): Val {
    const routine = this.routines.get(e.routine)!
    // the inputs in the order they are written — a call inside one runs there (`callshape_argument_order`)
    const inputs: Val[] = new Array(e.inputs.length)
    for (const k of e.order ?? e.inputs.keys()) {
      if (typeof k === "number") inputs[k] = this.expr(e.inputs[k]!)
      // an in-out's index, taken where the in-out is written (`IrFreeze`)
      else this.write(k.temp, this.expr(k.value))
    }
    const bound = e.inouts.map((b) => this.bind(b))
    const locals = routine.locals.map((s) => instantiate(s.type, s.init, this.layouts))
    routine.inputs.forEach((index, k) => {
      const value = inputs[k]!
      locals[index] = typeof value === "object" ? copy(value) : fit(value, routine.locals[index]!.type)
    })
    let root: Record<string | number, Val> = {}
    let keys: string[] = []
    if (e.instance !== undefined) {
      const at = this.locate(e.instance)
      root = (at.container as Record<string | number, Val>)[at.key] as Record<string | number, Val>
      keys = this.layouts.get(routine.fb!.toUpperCase())!.fields.map((f) => f.name.toUpperCase())
    }
    const lent = (e.lent ?? []).map((p) => this.bind(p))
    new Machine(root, keys, bound, this.layouts, this.routines, this.globals, this.guard, locals, lent).block(routine.body)
    this.writeBack(e.inouts, bound)
    return routine.result === undefined ? false : locals[routine.result]!
  }

  /** A copy lent for a call and marked `back` is written to its place once the call returns (`bindInOut`) — the case
   *  where a VAR_IN_OUT was given a CONSTANT, so the binding is a cell holding a copy rather than the caller's place.
   *  (The first line of this was `bind`'s doc, left stacked above `writeBack`.) */
  private writeBack(bindings: readonly import("../ir/index.js").IrBinding[], cells: readonly Cell[]): void {
    bindings.forEach((b, i) => {
      if ("kind" in b && b.back !== undefined) this.write(b.back, (cells[i]!.container as Record<string | number, Val>)[cells[i]!.key]!)
    })
  }

  private bind(b: import("../ir/index.js").IrBinding): Cell {
    if ("kind" in b) {
      const value = this.expr(b.value)
      return { container: { v: typeof value === "object" ? copy(value) : fit(value, b.type) }, key: "v" }
    }
    const cell = this.locate(b)
    return { container: cell.container as Record<string | number, Val>, key: cell.key }
  }

  /** The container a place's root names, before the first step of its path. */
  private base(place: Place): Record<string | number, Val> {
    switch (place.root) {
      case undefined:
        return this.root
      case "local":
        return this.locals as unknown as Record<number, Val>
      case "global":
        return this.globals as unknown as Record<number, Val>
      case "inout":
        return this.inouts[place.slot]!.container
      case "lent":
        return this.lent[place.slot]!.container
      case "this":
        return { THIS: this.root as Val }
    }
  }

  /** The key into {@link base} a place's root names. */
  private baseKey(place: Place): string | number {
    switch (place.root) {
      case undefined:
        return this.keys[place.slot]!
      case "local":
      case "global":
        return place.slot
      case "inout":
        return this.inouts[place.slot]!.key
      case "lent":
        return this.lent[place.slot]!.key
      case "this":
        return "THIS"
    }
  }

  /** The container and key the steps before a place's last one lead to — where a read or write lands. */
  private locate(place: Place): { container: Val[] | { [field: string]: Val }; key: number | string; bit: Extract<Access, { kind: "bit" }> | undefined } {
    // a dereference: the pointer holds 0 when null, and CODESYS stops the application on that access — so does this
    if (place.guard !== undefined && this.read(place.guard) === 0n) throw new RangeError("dereference of a null pointer")
    const steps = place.path
    const last = steps.at(-1)
    const bit = last?.kind === "bit" ? last : undefined
    const walk = bit === undefined ? steps.length : steps.length - 1
    let container: Val[] | { [field: string]: Val } = this.base(place) as Val[] | { [field: string]: Val }
    let key: number | string = this.baseKey(place)
    for (let s = 0; s < walk; s++) {
      const step = steps[s]!
      const next = (container as Record<string | number, Val>)[key] as Val[] | { [field: string]: Val }
      if (step.kind === "field") key = step.name.toUpperCase()
      else if (step.kind === "index") {
        const i = Number(num(this.expr(step.index)) as bigint) - Number(step.lower)
        // ponytail: what an out-of-bounds index does in CODESYS is unmeasured (no CheckBounds: it writes past the array) — refused loudly
        if (i < 0 || i >= (step.length ?? (next as Val[]).length)) throw new RangeError(`array index ${i + Number(step.lower)} is outside its bounds`)
        key = i
      }
      container = next
    }
    return { container, key, bit }
  }

  /** A place with no step and no dereference — a variable itself, the commonest place there is — is its root's slot,
   *  reached without walking a path or building a result for one. */
  private static plain(place: Place): boolean {
    return place.path.length === 0 && place.guard === undefined
  }

  read(place: Place): Val {
    if (Machine.plain(place)) return this.base(place)[this.baseKey(place)]!
    const { container, key, bit } = this.locate(place)
    const value = (container as Record<string | number, Val>)[key]!
    // A bigint's `>>` and `&` work on infinite two's complement, so a negative INT's bits read as the PLC's do.
    return bit === undefined ? value : ((num(value) as bigint) >> BigInt(bit.index)) & 1n ? true : false
  }

  write(place: Place, value: Val): void {
    if (Machine.plain(place)) {
      this.base(place)[this.baseKey(place)] = typeof value === "object" ? copy(value) : fit(value, place.type)
      return
    }
    const { container, key, bit } = this.locate(place)
    const slot = container as Record<string | number, Val>
    if (bit === undefined) {
      slot[key] = typeof value === "object" ? copy(value) : fit(value, place.type)
      return
    }
    const current = num(slot[key]!) as bigint
    const mask = 1n << BigInt(bit.index)
    // set or clear, then store at the INTEGER's width — so INT's bit 15 set on 0 reads back as -32768
    slot[key] = fit(bool(value) ? current | mask : current & ~mask, bit.of)
  }

  /** An expression's value on this frame — through the closure it was compiled into, once ({@link compiledExpr}). */
  expr(e: IrExpr): Val {
    return compiledExpr(e)(this)
  }

  /** A statement list run on this frame — through the closure it was compiled into, once ({@link compiledBlock}). */
  block(list: readonly IrStmt[]): Signal {
    return compiledBlock(list)(this)
  }

  /** An FB call: the FB's body runs on the instance itself — its fields are the frame, the bound places its VAR_IN_OUT. */
  call(s: IrCall): void {
    const at = this.locate(s.instance)
    const instance = (at.container as Record<string | number, Val>)[at.key] as Record<string | number, Val>
    const layout = this.layouts.get(s.fb.toUpperCase())!
    // the binding this call makes, which the FB's METHODs called from outside dispatch on (`lower/bindings.ts`)
    if (s.bind !== undefined) this.write(s.bind.place, s.bind.tag)
    const bound = s.inouts.map((b) => this.bind(b))
    const lent = (s.lent ?? []).map((p) => this.bind(p))
    new Machine(instance, layout.fields.map((f) => f.name.toUpperCase()), bound, this.layouts, this.routines, this.globals, this.guard, [], lent).block(layout.body!)
    this.writeBack(s.inouts, bound)
  }
}

/**
 * THE TREE IS WALKED ONCE, NOT ONCE PER PASS. Each IR node is compiled, the first time it runs, into a closure over its
 * already-compiled children; a pass is then a chain of direct calls. Walking the tree on every pass — a `switch` on
 * the node's kind, then on its operator, then on the place's root, a result object per place and a spread to build it,
 * at every node of every pass — cost ~400 ns for `cnt := cnt + 1` and its loop test, which put the recorded loops
 * (`tr_27_loop_cap_*`: 1,000,001 and 5,000,000 passes) at seconds. A closure holds nothing but the node it was made
 * from; the frame it runs on is its argument, so one compiled body serves every instance, call and scan.
 */
type Run<T> = (m: Machine) => T

const exprs = new WeakMap<IrExpr, Run<Val>>()
const blocks = new WeakMap<readonly IrStmt[], Run<Signal>>()

function compiledExpr(e: IrExpr): Run<Val> {
  let run = exprs.get(e)
  if (run === undefined) exprs.set(e, (run = compileExpr(e)))
  return run
}

function compiledBlock(list: readonly IrStmt[]): Run<Signal> {
  let run = blocks.get(list)
  if (run === undefined) blocks.set(list, (run = compileBlock(list)))
  return run
}

function compileExpr(e: IrExpr): Run<Val> {
  switch (e.kind) {
    case "const": {
      // a constant is stored the same way every time it is read: fitted on its first read, and kept
      let value: Val | undefined
      return () => (value ??= fit(e.value, e.type))
    }
    // A fresh composite — what a VAR_TEMP struct or array is reset to at the top of each call.
    case "fresh":
      return (m) => instantiate(e.type, e.init, m.layouts)
    case "load":
      return compileRead(e.place)
    case "invoke":
      return (m) => m.invoke(e)
    case "dispatch": {
      // a call through an interface runs on the instance its value names; none — a null interface — stops the application
      const tag = compiledExpr(e.tag)
      return (m) => {
        const t = tag(m)
        const arm = e.arms.find((a) => a.tag === t)
        if (arm === undefined) throw new RangeError("call through an interface that holds no instance")
        return m.invoke(arm.call)
      }
    }
    case "select": {
      // a read through a pointer that may name several variables: the tag picks which. None is a null dereference,
      // which stops the application exactly as `iec_deref` does for the single-target form.
      const tag = compiledExpr(e.tag)
      return (m) => {
        const t = tag(m)
        const arm = e.arms.find((a) => a.tag === t)
        if (arm === undefined) throw new RangeError("dereference of a null pointer")
        return m.read(arm.place)
      }
    }
    case "convert": {
      const value = compiledExpr(e.value)
      return (m) => fit(coerce(value(m), e.type, e.value.type), e.type)
    }
    // The three node kinds whose meaning needs no storage live in `ir/evaluate.ts`, because lowering evaluates
    // them too when it folds a declaration's initial value — one table, so a folded value and a computed one
    // cannot disagree.
    case "builtin": {
      const args = e.args.map(compiledExpr)
      // SEL and MUX evaluate only the input their selector picks (`IrBuiltinName`)
      if (e.name === "sel" || e.name === "mux") {
        const name = e.name
        return (m) => fit(args[selectedArg(name, args[0]!(m), args.length)]!(m), e.type)
      }
      const types = e.args.map((a) => a.type)
      return (m) => builtinValue(e.name, args.map((a) => a(m)), e.type, types, e.bits)
    }
    case "unary": {
      const operand = compiledExpr(e.operand)
      return (m) => unaryValue(e.op, operand(m), e.type)
    }
    case "binary": {
      const left = compiledExpr(e.left)
      const right = compiledExpr(e.right)
      // The short-circuit forms must not evaluate the right side — the only reason they are distinct nodes,
      // and the one part of a binary that belongs to whoever does the evaluating.
      if (e.op === "and_then") return (m) => bool(left(m)) && bool(right(m))
      if (e.op === "or_else") return (m) => bool(left(m)) || bool(right(m))
      const { op, type } = e
      return (m) => binaryValue(op, left(m), right(m), type)
    }
  }
}

/** A read of a place. A variable itself — no step, no dereference, the commonest place there is — is one slot of the
 *  frame, the locals or the globals, read directly; anything else walks its path ({@link Machine.read}). */
function compileRead(place: Place): Run<Val> {
  const slot = place.slot
  if (place.path.length === 0 && place.guard === undefined)
    switch (place.root) {
      case undefined:
        return (m) => m.root[m.keys[slot]!]!
      case "local":
        return (m) => m.locals[slot]!
      case "global":
        return (m) => m.globals[slot]!
    }
  return (m) => m.read(place)
}

/** A write to a place, stored as the place's type holds it — the counterpart of {@link compileRead}. */
function compileWrite(place: Place): (m: Machine, value: Val) => void {
  const { slot, type } = place
  if (place.path.length === 0 && place.guard === undefined)
    switch (place.root) {
      case undefined:
        return (m, v) => void (m.root[m.keys[slot]!] = typeof v === "object" ? copy(v) : fit(v, type))
      case "local":
        return (m, v) => void (m.locals[slot] = typeof v === "object" ? copy(v) : fit(v, type))
      case "global":
        return (m, v) => void (m.globals[slot] = typeof v === "object" ? copy(v) : fit(v, type))
    }
  return (m, v) => m.write(place, v)
}

function compileBlock(list: readonly IrStmt[]): Run<Signal> {
  const stmts = list.map(compileStmt)
  if (stmts.length === 0) return () => "none"
  if (stmts.length === 1) return stmts[0]!
  return (m) => {
    for (const s of stmts) {
      const sig = s(m)
      if (sig !== "none") return sig
    }
    return "none"
  }
}

function compileStmt(s: IrStmt): Run<Signal> {
  switch (s.kind) {
    case "assign": {
      const value = compiledExpr(s.value)
      const store = compileWrite(s.target)
      return (m) => {
        store(m, value(m))
        return "none"
      }
    }
    case "if": {
      const cond = compiledExpr(s.cond)
      const then = compiledBlock(s.then)
      const otherwise = compiledBlock(s.else)
      return (m) => (bool(cond(m)) ? then : otherwise)(m)
    }
    case "switch": {
      const selector = compiledExpr(s.selector)
      const arms = s.arms.map((arm) => ({ labels: arm.labels, body: compiledBlock(arm.body) }))
      const otherwise = compiledBlock(s.else)
      return (m) => {
        const sel = selector(m)
        for (const arm of arms)
          for (const label of arm.labels)
            if (label.lo === label.hi ? eq(sel, label.lo) : ord("ge", sel, label.lo) && ord("le", sel, label.hi))
              return arm.body(m)
        return otherwise(m)
      }
    }
    case "loop": {
      const init = compiledBlock(s.init)
      const body = compiledBlock(s.body)
      const step = compiledBlock(s.step)
      // the test, at the top of a pass (FOR, WHILE) or at its end (REPEAT) — or none
      const before = s.test !== undefined && !s.test.atEnd ? compiledExpr(s.test.cond) : undefined
      const after = s.test !== undefined && s.test.atEnd ? compiledExpr(s.test.cond) : undefined
      return (m) => {
        init(m)
        for (let n = 1; ; n++) {
          if (before !== undefined && !bool(before(m))) break
          if (m.guard !== undefined && n > m.guard) throw new LoopGuardError(m.guard)
          const sig = body(m)
          if (sig === "break") break
          if (sig === "return") return sig
          step(m)
          if (after !== undefined && !bool(after(m))) break
        }
        return "none"
      }
    }
    case "call":
      return (m) => {
        m.call(s)
        return "none"
      }
    case "eval": {
      // a call as a statement — direct, or dispatched through an interface
      const value = compiledExpr(s.value)
      return (m) => {
        value(m)
        return "none"
      }
    }
    case "break":
      return () => "break"
    case "continue":
      return () => "continue"
    case "return":
      return () => "return"
  }
}

export interface Runner {
  /** Live slot values, in frame order. */
  readonly frame: readonly Val[]
  /** A variable by its path from the POU, as the IDE names it: `count`, `inst.q`, `arr[2].x`. */
  get(path: string): Val
  set(path: string, value: Val): void
  /** Run one scan cycle. */
  scan(): void
}

/** Two ST names for one variable: case-insensitive, a backtick quote (`` `TYPE` ``) not part of the name. */
export function sameName(a: string, b: string): boolean {
  const bare = (n: string): string => n.replace(/^`|`$/g, "").toUpperCase()
  return bare(a) === bare(b)
}

/** A variable path's container, key and type — `inst.q` walks the slot `inst`, then its field `Q`; `arr[2]` subtracts
 *  the dimension's lower bound. Shared by `get` and `set`, so a test reads exactly where the program writes. */
function resolvePath(pou: IrPou, frame: Val[], globals: Val[], layouts: ReadonlyMap<string, IrLayout>, path: string) {
  // a name may be backtick-quoted — ``fb.`TYPE` `` is how CODESYS names a variable declared `` `TYPE` ``
  // `a[1, 2]` indexes two dimensions: one step each, as `a[1][2]` would
  const parts = [...path.matchAll(/(`[^`]+`|[A-Za-z_]\w*)|\[([^\]]+)\]/g)].flatMap((m) =>
    m[2] === undefined ? [m] : m[2].split(",").map((index) => [m[0], undefined, index.trim()] as unknown as RegExpExecArray),
  )
  const first = parts[0]?.[1]
  const slot = first === undefined ? -1 : pou.slots.findIndex((s) => sameName(s.name, first))
  // not the POU's own: a global by its name — a GVL variable, or the `__clock` a harness sets before a scan
  const global = slot < 0 && first !== undefined ? pou.globals.findIndex((s) => s.section !== "program" && sameName(s.name, first)) : -1
  if (slot < 0 && global < 0) throw new Error(`no variable ${path} in ${pou.name}`)
  let container = (global >= 0 ? globals : frame) as unknown as Record<string | number, Val>
  let key: string | number = global >= 0 ? global : slot
  let type: Type = global >= 0 ? pou.globals[global]!.type : pou.slots[slot]!.type
  for (const part of parts.slice(1)) {
    container = container[key] as Record<string | number, Val>
    if (part[1] !== undefined) {
      const layout = type.kind === "struct" || type.kind === "function_block" ? layouts.get(type.name.toUpperCase()) : undefined
      const field = layout?.fields.find((f) => sameName(f.name, part[1]!))
      // an FB's VAR_STAT, named through an instance, is the one global every instance shares
      const shared = field === undefined ? layout?.statics?.find((s) => sameName(s.name, part[1]!)) : undefined
      if (shared !== undefined) {
        container = globals as unknown as Record<string | number, Val>
        key = shared.global
        type = pou.globals[shared.global]!.type
        continue
      }
      if (field === undefined) throw new Error(`no variable ${path} in ${pou.name}`)
      key = field.name.toUpperCase()
      type = field.type
    } else {
      const array = peelArray(type)
      if (array === undefined) throw new Error(`${path} indexes a non-array`)
      key = Number(BigInt(part[2]!) - array.lower)
      type = array.element
    }
  }
  return { container, key, type }
}

/** A value as the IDE shows it: a string is what stands before its terminator, not the buffer behind it (`values.ts`). */
function shown(v: Val): Val {
  if (typeof v === "string") return visible(v)
  if (Array.isArray(v)) return v.map(shown)
  if (typeof v === "object" && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shown(x)]))
  return v
}

/** Prepare a lowered POU for execution: allocate its frame, seed it from the slots' initial values. */
export function run(pou: IrPou, options: RunOptions = {}): Runner {
  const layouts = new Map(pou.layouts.map((l) => [l.name.toUpperCase(), l]))
  const frame = pou.slots.map((s) => instantiate(s.type, s.init, layouts))
  const routines = new Map(pou.routines.map((r) => [r.key, r]))
  const globals = pou.globals.map((s) => instantiate(s.type, s.init, layouts))
  const machine = new Machine(frame as unknown as Record<number, Val>, pou.slots.map((_, i) => i), [], layouts, routines, globals, options.loopGuard)
  if (pou.init !== undefined) machine.block(pou.init)

  return {
    frame,
    get: (path) => {
      const { container, key } = resolvePath(pou, frame, globals, layouts, path)
      return shown(container[key]!)
    },
    // stored as the variable's type holds it, like every write the program makes — a test cannot plant a value the PLC couldn't
    set: (path, value) => {
      const { container, key, type } = resolvePath(pou, frame, globals, layouts, path)
      container[key] = typeof value === "object" ? copy(value) : fit(value, type)
    },
    scan: () => void machine.block(pou.body),
  }
}
