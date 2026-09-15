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
} from "./values.js"
export type { Val } from "./values.js"

type Signal = "none" | "break" | "continue" | "return"

/** A runaway loop is a bug in the POU, not a budget to raise — fail loud instead of hanging a test run. */
const MAX_ITERATIONS = 1_000_000

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
    for (const k of e.order ?? e.inputs.keys()) inputs[k] = this.expr(e.inputs[k]!)
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
    return routine.result === undefined ? false : locals[routine.result]!
  }

  /** A VAR_IN_OUT binding: the caller's place itself — or, lent to a VAR_IN_OUT CONSTANT, a cell holding a copy of a value. */
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
      case "builtin": {
        const args = e.args.map((a) => this.expr(a))
        const pick = (op: "lt" | "gt"): Val => args.reduce((best, v) => (ord(op, v, best) ? v : best))
        switch (e.name) {
          case "max":
            return fit(pick("gt"), e.type)
          case "min":
            return fit(pick("lt"), e.type)
          case "limit": {
            // MIN(MAX(IN, MN), MX) — measured; with MN > MX that is MX for every IN
            const [mn, value, mx] = args as [Val, Val, Val]
            const raised = ord("gt", value, mn) ? value : mn
            return fit(ord("lt", raised, mx) ? raised : mx, e.type)
          }
          case "sel":
            return fit(bool(args[0]!) ? args[2]! : args[1]!, e.type)
          case "trunc": {
            // Toward zero into a DINT whose out-of-range answer is DINT's MINIMUM — x86's "integer indefinite":
            // TRUNC(3.0E9) is -2147483648, where LREAL_TO_DINT(3.0E9) wraps to -1294967296 (conformance
            // `trunc_out_of_range`). TRUNC_INT then wraps that DINT into INT, as `fit` does for every integer.
            const t = Math.trunc(Number(num(args[0]!)))
            const inRange = Number.isFinite(t) && t >= -2147483648 && t <= 2147483647
            return fit(inRange ? BigInt(t) : -2147483648n, e.type)
          }
          case "shl":
          case "shr": {
            // x86's count mask: SHL(DWORD 1, 33) is 2 and a count of -1 shifts by 31 (conformance `shift_count_*`,
            // `shift_negative_count`). The value is already promoted, and a bigint `>>` is arithmetic on a negative —
            // SHR(SINT -128, 1) is -64, as measured.
            const bits = e.type.kind === "elementary" ? e.type.elem.bits : 32
            const count = BigInt(Number(num(args[1]!)) & (bits - 1))
            const value = num(args[0]!) as bigint
            return fit(e.name === "shl" ? value << count : value >> count, e.type)
          }
          case "rol":
          case "ror": {
            // in the value's own width, count modulo that width — ROL(BYTE 129, 9) is 3 (conformance `rotate_*`)
            const bits = e.type.kind === "elementary" ? e.type.elem.bits : 32
            const width = BigInt(bits)
            const left = BigInt(((Number(num(args[1]!)) % bits) + bits) % bits)
            const by = e.name === "rol" ? left : (width - left) % width
            const unsigned = BigInt.asUintN(bits, num(args[0]!) as bigint)
            return fit(BigInt.asUintN(bits, (unsigned << by) | (unsigned >> ((width - by) % width))), e.type)
          }
          case "mux": {
            // an out-of-range K — negative included — picks the LAST input (conformance `mux_out_of_range`)
            const k = Number(num(args[0]!))
            const inputs = args.slice(1)
            return fit(k >= 0 && k < inputs.length ? inputs[k]! : inputs[inputs.length - 1]!, e.type)
          }
          case "expt":
            // float64, narrowed by `fit` when lowering typed it REAL (both arguments REAL) — matches CODESYS's digits
            return fit(Math.pow(Number(num(args[0]!)), Number(num(args[1]!))), e.type)
          case "abs": {
            // in the promoted type lowering chose; `fit` wraps a signed minimum back to itself
            const v = args[0]!
            return fit(typeof v === "bigint" ? (v < 0n ? -v : v) : Math.abs(Number(v)), e.type)
          }
          case "len":
          case "left":
          case "right":
          case "mid":
          case "concat":
          case "insert":
          case "delete":
          case "replace":
          case "find":
            return fit(STRING_FUNCTIONS[e.name](args), e.type)
          case "sqrt":
          case "ln":
          case "log":
          case "exp":
          case "sin":
          case "cos":
          case "tan":
          case "asin":
          case "acos":
          case "atan":
            // computed in float64, then `fit` narrows a REAL to float32 — the oracle checks this matches CODESYS's digits
            return fit(MATH[e.name](Number(num(args[0]!))), e.type)
        }
      }
      case "unary": {
        if (e.op === "neg") return fit(arith("sub", 0n, this.expr(e.operand)), e.type)
        const v = this.expr(e.operand)
        return typeof v === "bigint" ? fit(~v, e.type) : !bool(v)
      }
      case "binary": {
        // The short-circuit forms must not evaluate the right side — the only reason they are distinct nodes.
        if (e.op === "and_then") return bool(this.expr(e.left)) && bool(this.expr(e.right))
        if (e.op === "or_else") return bool(this.expr(e.left)) || bool(this.expr(e.right))
        const l = this.expr(e.left)
        const r = this.expr(e.right)
        switch (e.op) {
          case "eq":
            return eq(l, r)
          case "ne":
            return !eq(l, r)
          case "lt":
          case "le":
          case "gt":
          case "ge":
            return ord(e.op, l, r)
          case "and":
          case "or":
          case "xor":
            return logic(e.op, l, r)
          default:
            return fit(arith(e.op, l, r), e.type)
        }
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
          if (n > MAX_ITERATIONS) throw new RangeError("loop exceeded the iteration cap")
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
        const bound = s.inouts.map((b) => this.bind(b))
        const lent = (s.lent ?? []).map((p) => this.bind(p))
        new Machine(instance, layout.fields.map((f) => f.name.toUpperCase()), bound, this.layouts, this.routines, this.globals, [], lent).block(layout.body!)
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
