/**
 * The IR interpreter — a backend, and the reference the other backends are checked against.
 *
 * It runs the SAME IR the Rust emitter prints, which is the point: a lowering bug shows up in both, and an
 * emitter bug shows up as a disagreement between them rather than as a silently wrong number. It walks a
 * frame of slots — no name lookup, no scope chain, no types at run time; lowering already answered all three.
 *
 * ponytail: a tree walk. It is the oracle and the fast path to a green test, not the shipping runtime — if
 * scan throughput ever matters, that is what the Rust backend is for.
 */
import {
  type Access,
  type IrExpr,
  type IrInvoke,
  type IrLayout,
  type IrPou,
  type IrRoutine,
  type IrStmt,
  peelArray,
  type Place,
  LOOP_CAP_MESSAGE,
  LOOP_ITERATION_CAP,
} from "../ir/index.js"
import type { Type } from "../../types/index.js"
import {
  arith,
  bool,
  coerce,
  copy,
  eq,
  fit,
  instantiate,
  logic,
  MATH,
  num,
  ord,
  STRING_FUNCTIONS,
  type Val,
} from "../ir/values.js"
import { binaryValue, builtinValue, unaryValue } from "../ir/evaluate.js"
export type { Val } from "../ir/values.js"

type Signal = "none" | "break" | "continue" | "return"

// the cap and its wording come from the IR, so the two backends cannot drift apart on either — see ir.ts

/** Where a value lives: a container (a frame, a record, an array) and the key into it. */
type Cell = { container: Record<string | number, Val>; key: string | number }

class Machine {
  /**
   * @param root   the frame a body runs on — the POU's slot array, or an FB instance's record
   * @param keys   the key of each slot index in `root`: the index itself, or the field's upper-cased name
   * @param inouts the caller's variables bound to the body's VAR_IN_OUT parameters, by parameter index
   */
  constructor(
    private readonly root: Record<string | number, Val>,
    private readonly keys: readonly (string | number)[],
    private readonly inouts: readonly Cell[],
    private readonly layouts: ReadonlyMap<string, IrLayout>,
    private readonly routines: ReadonlyMap<string, IrRoutine>,
    /** The application's globals — ONE array every body shares. */
    private readonly globals: Val[],
    /** The running METHOD's, ACTION's or FUNCTION's per-call locals. */
    private readonly locals: Val[] = [],
    /** The FB instances this body's caller lends it (`lent` places), by slot. */
    private readonly lent: readonly Cell[] = [],
  ) {}

  /** A METHOD, ACTION or FUNCTION: fresh locals, the inputs stored into them, the body run on the instance (or on nothing),
   *  and the result slot's value — FALSE stands in for a routine without one, which only an `eval` calls. */
  private invoke(e: IrInvoke): Val {
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
    new Machine(root, keys, bound, this.layouts, this.routines, this.globals, locals, lent).block(routine.body)
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

  /** The container and key the steps before a place's last one lead to — where a read or write lands. */
  private locate(place: Place): { container: Val[] | { [field: string]: Val }; key: number | string; bit?: Extract<Access, { kind: "bit" }> } {
    // a dereference: the pointer holds 0 when null, and CODESYS stops the application on that access — so does this
    if (place.guard !== undefined && this.read(place.guard) === 0n) throw new RangeError("dereference of a null pointer")
    const steps = place.path
    const last = steps.at(-1)
    const bit = last?.kind === "bit" ? last : undefined
    const walk = bit === undefined ? steps : steps.slice(0, -1)
    const start: Cell =
      place.root === "inout"
        ? this.inouts[place.slot]!
        : place.root === "lent"
          ? this.lent[place.slot]!
        : place.root === "local"
          ? { container: this.locals as unknown as Record<number, Val>, key: place.slot }
          : place.root === "global"
            ? { container: this.globals as unknown as Record<number, Val>, key: place.slot }
            : place.root === "this"
              ? { container: { THIS: this.root as Val }, key: "THIS" }
              : { container: this.root, key: this.keys[place.slot]! }
    let container: Val[] | { [field: string]: Val } = start.container as Val[] | { [field: string]: Val }
    let key: number | string = start.key
    for (const step of walk) {
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
    return { container, key, ...(bit === undefined ? {} : { bit }) }
  }

  read(place: Place): Val {
    const { container, key, bit } = this.locate(place)
    const value = (container as Record<string | number, Val>)[key]!
    // A bigint's `>>` and `&` work on infinite two's complement, so a negative INT's bits read as the PLC's do.
    return bit === undefined ? value : ((num(value) as bigint) >> BigInt(bit.index)) & 1n ? true : false
  }

  write(place: Place, value: Val): void {
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

  expr(e: IrExpr): Val {
    switch (e.kind) {
      case "const":
        return fit(e.value, e.type)
      // A fresh composite — what a VAR_TEMP struct or array is reset to at the top of each call.
      case "fresh":
        return instantiate(e.type, e.init, this.layouts)
      case "load":
        return this.read(e.place)
      case "invoke":
        return this.invoke(e)
      case "dispatch": {
        // a call through an interface runs on the instance its value names; none — a null interface — stops the application
        const tag = this.expr(e.tag)
        const arm = e.arms.find((a) => a.tag === tag)
        if (arm === undefined) throw new RangeError("call through an interface that holds no instance")
        return this.invoke(arm.call)
      }
      case "convert":
        return fit(coerce(this.expr(e.value), e.type, e.value.type), e.type)
      // The three node kinds whose meaning needs no storage live in `ir/evaluate.ts`, because lowering evaluates
      // them too when it folds a declaration's initial value — one table, so a folded value and a computed one
      // cannot disagree.
      case "builtin":
        return builtinValue(e.name, e.args.map((a) => this.expr(a)), e.type)
      case "unary":
        return unaryValue(e.op, this.expr(e.operand), e.type)
      case "binary": {
        // The short-circuit forms must not evaluate the right side — the only reason they are distinct nodes,
        // and the one part of a binary that belongs to whoever does the evaluating.
        if (e.op === "and_then") return bool(this.expr(e.left)) && bool(this.expr(e.right))
        if (e.op === "or_else") return bool(this.expr(e.left)) || bool(this.expr(e.right))
        return binaryValue(e.op, this.expr(e.left), this.expr(e.right), e.type)
      }
    }
  }

  block(list: readonly IrStmt[]): Signal {
    for (const s of list) {
      const sig = this.stmt(s)
      if (sig !== "none") return sig
    }
    return "none"
  }

  stmt(s: IrStmt): Signal {
    switch (s.kind) {
      case "assign":
        this.write(s.target, this.expr(s.value))
        return "none"
      case "if":
        return this.block(bool(this.expr(s.cond)) ? s.then : s.else)
      case "switch": {
        const sel = this.expr(s.selector)
        for (const arm of s.arms)
          for (const label of arm.labels)
            if (label.lo === label.hi ? eq(sel, label.lo) : ord("ge", sel, label.lo) && ord("le", sel, label.hi))
              return this.block(arm.body)
        return this.block(s.else)
      }
      case "loop": {
        this.block(s.init)
        for (let n = 0; ; n++) {
          if (n > LOOP_ITERATION_CAP) throw new RangeError(LOOP_CAP_MESSAGE)
          if (s.test !== undefined && !s.test.atEnd && !bool(this.expr(s.test.cond))) break
          const sig = this.block(s.body)
          if (sig === "break") break
          if (sig === "return") return sig
          this.block(s.step)
          if (s.test !== undefined && s.test.atEnd && !bool(this.expr(s.test.cond))) break
        }
        return "none"
      }
      case "call": {
        // the FB's body runs on the instance itself — its fields are the frame, the bound places its VAR_IN_OUT
        const at = this.locate(s.instance)
        const instance = (at.container as Record<string | number, Val>)[at.key] as Record<string | number, Val>
        const layout = this.layouts.get(s.fb.toUpperCase())!
        // the binding this call makes, which the FB's METHODs called from outside dispatch on (`lower/bindings.ts`)
        if (s.bind !== undefined) this.write(s.bind.place, s.bind.tag)
        const bound = s.inouts.map((b) => this.bind(b))
        const lent = (s.lent ?? []).map((p) => this.bind(p))
        new Machine(instance, layout.fields.map((f) => f.name.toUpperCase()), bound, this.layouts, this.routines, this.globals, [], lent).block(layout.body!)
        this.writeBack(s.inouts, bound)
        return "none"
      }
      case "eval":
        // a call as a statement — direct, or dispatched through an interface
        this.expr(s.value)
        return "none"
      case "break":
        return "break"
      case "continue":
        return "continue"
      case "return":
        return "return"
    }
  }
}

/** A shift or rotate happens in the NODE'''s width. Lowering always types these from a promoted operand, so anything
 *  else is a lowering bug — reported as one rather than silently treated as 32 bits. */
function widthOf(type: Type, op: string): number {
  if (type.kind !== "elementary") throw new TypeError(`${op.toUpperCase()} on a ${type.kind}, which lowering should have typed`)
  return type.elem.bits
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
  if (slot < 0) throw new Error(`no variable ${path} in ${pou.name}`)
  let container = frame as unknown as Record<string | number, Val>
  let key: string | number = slot
  let type: Type = pou.slots[slot]!.type
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

/** Prepare a lowered POU for execution: allocate its frame, seed it from the slots' initial values. */
export function run(pou: IrPou): Runner {
  const layouts = new Map(pou.layouts.map((l) => [l.name.toUpperCase(), l]))
  const frame = pou.slots.map((s) => instantiate(s.type, s.init, layouts))
  const routines = new Map(pou.routines.map((r) => [r.key, r]))
  const globals = pou.globals.map((s) => instantiate(s.type, s.init, layouts))
  const machine = new Machine(frame as unknown as Record<number, Val>, pou.slots.map((_, i) => i), [], layouts, routines, globals)
  if (pou.init !== undefined) machine.block(pou.init)

  return {
    frame,
    get: (path) => {
      const { container, key } = resolvePath(pou, frame, globals, layouts, path)
      return container[key]!
    },
    // stored as the variable's type holds it, like every write the program makes — a test cannot plant a value the PLC couldn't
    set: (path, value) => {
      const { container, key, type } = resolvePath(pou, frame, globals, layouts, path)
      container[key] = typeof value === "object" ? copy(value) : fit(value, type)
    },
    scan: () => void machine.block(pou.body),
  }
}
