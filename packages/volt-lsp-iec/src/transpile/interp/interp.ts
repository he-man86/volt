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
import type { IrExpr, IrPou, IrStmt, IrValue, Place } from "../ir/index.js"
import type { Type } from "../../types/index.js"

/** A runtime value. Ints stay `bigint` (so `/` truncates like IEC does); REAL is `number`; TIME is ns. */
export type Val = IrValue

type Signal = "none" | "break" | "continue" | "return"

/** A runaway loop is a bug in the POU, not a budget to raise — fail loud instead of hanging a test run. */
const MAX_ITERATIONS = 1_000_000

// ─── values ──────────────────────────────────────────────────────────────────

/** The default a slot holds before its first assignment, from the type's own facts. */
export function defaultOf(type: Type): Val {
  if (type.kind !== "elementary") return 0n
  if (type.elem.family === "bool") return false
  if (type.elem.family === "real") return 0
  if (type.elem.family === "string") return ""
  return 0n
}

function num(v: Val): bigint | number {
  if (typeof v === "bigint" || typeof v === "number") return v
  throw new TypeError(`expected a number, got ${typeof v}`)
}

function bool(v: Val): boolean {
  if (typeof v === "boolean") return v
  throw new TypeError(`expected BOOL, got ${typeof v}`)
}

function eq(a: Val, b: Val): boolean {
  if (typeof a === "bigint" && typeof b === "number") return Number(a) === b
  if (typeof a === "number" && typeof b === "bigint") return a === Number(b)
  return a === b
}

function ord(op: "lt" | "le" | "gt" | "ge", a: Val, b: Val): boolean {
  const l = typeof a === "string" ? a : Number(num(a))
  const r = typeof b === "string" ? b : Number(num(b))
  return op === "lt" ? l < r : op === "le" ? l <= r : op === "gt" ? l > r : l >= r
}

function arith(op: string, a: Val, b: Val): Val {
  const l = num(a)
  const r = num(b)
  if (typeof l === "bigint" && typeof r === "bigint") {
    if ((op === "div" || op === "mod") && r === 0n) throw new RangeError("division by zero")
    switch (op) {
      case "add":
        return l + r
      case "sub":
        return l - r
      case "mul":
        return l * r
      case "div":
        return l / r // truncating, as IEC integer division is
      case "mod":
        return l % r
      case "pow":
        return l ** r
    }
  }
  const x = Number(l)
  const y = Number(r)
  switch (op) {
    case "add":
      return x + y
    case "sub":
      return x - y
    case "mul":
      return x * y
    case "div":
      return x / y
    case "mod":
      return x % y
    case "pow":
      return x ** y
  }
  throw new TypeError(`unknown arithmetic op ${op}`)
}

/** AND/OR/XOR — boolean on BOOLs, bitwise on ints. Both are legal IEC; the operand type decides. */
function logic(op: "and" | "or" | "xor", a: Val, b: Val): Val {
  if (typeof a === "bigint" && typeof b === "bigint") return op === "and" ? a & b : op === "or" ? a | b : a ^ b
  const l = bool(a)
  const r = bool(b)
  return op === "and" ? l && r : op === "or" ? l || r : l !== r
}

/** A conversion node is explicit in the IR, so this is the whole of it: cross the int/real divide, or nothing. */
function coerce(v: Val, to: Type): Val {
  if (to.kind !== "elementary") return v
  if (to.elem.family === "real") return typeof v === "bigint" ? Number(v) : v
  if (typeof v === "number" && to.elem.rank !== undefined) return BigInt(Math.trunc(v))
  return v
}

// ─── the machine ─────────────────────────────────────────────────────────────

class Machine {
  constructor(readonly frame: Val[]) {}

  read(place: Place): Val {
    return this.frame[place.slot]!
  }

  expr(e: IrExpr): Val {
    switch (e.kind) {
      case "const":
        return e.value
      case "load":
        return this.read(e.place)
      case "convert":
        return coerce(this.expr(e.value), e.type)
      case "unary": {
        if (e.op === "neg") return arith("sub", 0n, this.expr(e.operand))
        const v = this.expr(e.operand)
        return typeof v === "bigint" ? ~v : !bool(v)
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
            return arith(e.op, l, r)
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
        this.frame[s.target.slot] = this.expr(s.value)
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
      case "break":
        return "break"
      case "continue":
        return "continue"
      case "return":
        return "return"
    }
  }
}

// ─── the public shape ────────────────────────────────────────────────────────

export interface Runner {
  /** Live slot values, in frame order. */
  readonly frame: readonly Val[]
  get(name: string): Val
  set(name: string, value: Val): void
  /** Run one scan cycle. */
  scan(): void
}

/** Prepare a lowered POU for execution: allocate its frame, seed it from the slots' initial values. */
export function run(pou: IrPou): Runner {
  const frame = pou.slots.map((s) => s.init ?? defaultOf(s.type))
  const byName = new Map(pou.slots.map((s, i) => [s.name.toUpperCase(), i]))
  const machine = new Machine(frame)

  const slotOf = (name: string): number => {
    const i = byName.get(name.toUpperCase())
    if (i === undefined) throw new Error(`no variable ${name} in ${pou.name}`)
    return i
  }

  return {
    frame,
    get: (name) => frame[slotOf(name)]!,
    set: (name, value) => void (frame[slotOf(name)] = value),
    scan: () => void machine.block(pou.body),
  }
}
