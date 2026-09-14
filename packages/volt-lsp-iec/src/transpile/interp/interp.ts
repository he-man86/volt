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
import type { IrExpr, IrMathName, IrPou, IrStmt, IrStringName, IrValue, Place } from "../ir/index.js"
import type { Type } from "../../types/index.js"

/** A runtime value. Integers, durations and dates stay `bigint` in their type's unit (so `/` truncates like IEC does);
 *  REAL is `number`; STRING and WSTRING are `string`. */
export type Val = IrValue

type Signal = "none" | "break" | "continue" | "return"

/** The one-argument math functions. LOG is base 10 in IEC. */
const MATH: Readonly<Record<IrMathName, (x: number) => number>> = {
  sqrt: Math.sqrt,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
}

/**
 * The Standard string functions, over already-converted arguments. Mirrored line for line by the emitter's prelude
 * (`iec_*`), so the differential test checks both against CODESYS. Measured (test/exec `string_*`,
 * `string_positions_*`): positions are 1-based and a count clamps to the string — LEFT(abc, 5) is 'abc', LEFT(abc, -1)
 * is ''; MID and DELETE select nothing at a position below 1 or a length at or below 0; INSERT at 0 prepends, but past
 * the end OR below 0 leaves the string as it was (INSERT(abc, 'XY', -1) is 'abc'); FIND of '' is 0. REPLACE is DELETE,
 * then INSERT at P - 1 raised to 0 — every measured REPLACE agrees: REPLACE(abc, 'XY', 1, 0) is 'XYabc' and
 * REPLACE(abc, 'XY', 2, 5) is 'abc'. (This first read "INSERT at P - 1", which implied INSERT at -1 prepends; the
 * oracle recorded that INSERT and said otherwise.)
 */
const STRING_FUNCTIONS: Readonly<Record<IrStringName, (args: readonly Val[]) => Val>> = {
  len: ([s]) => BigInt((s as string).length),
  left: ([s, n]) => (s as string).slice(0, clamp(n, s)),
  right: ([s, n]) => (s as string).slice((s as string).length - clamp(n, s)),
  mid: ([s, l, p]) => (Number(p) < 1 || Number(l) <= 0 ? "" : span(s as string, Number(p) - 1, Number(l))),
  concat: ([a, b]) => (a as string) + (b as string),
  insert: ([a, b, p]) => {
    const at = Number(p)
    return at < 0 || at > (a as string).length ? a : (a as string).slice(0, at) + (b as string) + (a as string).slice(at)
  },
  delete: ([s, l, p]) => {
    if (Number(p) < 1 || Number(l) <= 0) return s
    const start = Math.min(Number(p) - 1, (s as string).length)
    return (s as string).slice(0, start) + (s as string).slice(start + span(s as string, start, Number(l)).length)
  },
  replace: ([a, b, l, p]) => STRING_FUNCTIONS.insert([STRING_FUNCTIONS.delete([a, l, p]), b, BigInt(Math.max(Number(p) - 1, 0))]),
  find: ([a, b]) => ((b as string) === "" ? 0n : BigInt((a as string).indexOf(b as string) + 1)),
}

/** A TIME's text — mirrored by the emitter's `iec_time_text`. */
function timeText(ms: bigint): string {
  let rest = ms
  let out = ""
  for (const [unit, suffix] of [[86_400_000n, "d"], [3_600_000n, "h"], [60_000n, "m"], [1000n, "s"], [1n, "ms"]] as const) {
    const n = rest / unit
    rest %= unit
    if (n !== 0n) out += `${n}${suffix}`
  }
  return `T#${out || "0ms"}`
}

/** `n` as a count within `s`: at least 0, at most its length. */
function clamp(n: Val, s: Val): number {
  return Math.min(Math.max(Number(n), 0), (s as string).length)
}

/** Up to `length` characters of `s` from `start`, never past its end. */
function span(s: string, start: number, length: number): string {
  return s.slice(Math.min(start, s.length), Math.min(start + length, s.length))
}

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

// Lowering converts both operands of a comparison to ONE type, so the two values always share a representation, and
// JavaScript's own operators compare it exactly — bigints as bigints (a LINT above 2^53 included), strings by code unit.
function eq(a: Val, b: Val): boolean {
  return a === b
}

function ord(op: "lt" | "le" | "gt" | "ge", a: Val, b: Val): boolean {
  return op === "lt" ? a < b : op === "le" ? a <= b : op === "gt" ? a > b : a >= b
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

/**
 * A value as its type STORES it — the interpreter's counterpart of the emitter's `wrapping_*` and `f32`. IEC
 * integers wrap at their declared width and REAL is a 32-bit float (both measured against CODESYS, `test/exec`);
 * JavaScript gives neither for free, a bigint being unbounded and a number being float64. Every node that
 * produces a typed value passes through here, so an operand is always already in its type's representation.
 */
function fit(v: Val, type: Type): Val {
  if (type.kind !== "elementary") return v
  const { family, bits, signed } = type.elem
  if (family === "real") return bits === 32 && typeof v === "number" ? Math.fround(v) : v
  // a STRING(n) keeps its first n characters — `STRING(5) := 'abcdefgh'` is 'abcde' (test/exec `string_*`)
  if (family === "string") return typeof v === "string" && type.length !== undefined ? v.slice(0, type.length) : v
  // a duration or date wraps like the integer it is: TIME and TOD are 32-bit milliseconds, DATE and DT 32-bit seconds,
  // the L variants 64-bit nanoseconds (design §16, §17)
  if ((family === "int" || family === "bitstring" || family === "time" || family === "date") && typeof v === "bigint")
    return signed ? BigInt.asIntN(bits, v) : BigInt.asUintN(bits, v)
  return v
}

/**
 * A conversion node's value, before `fit` stores it at the target's width. Measured on CODESYS (design §11): REAL →
 * integer rounds half AWAY from zero (2.5 → 3, -2.5 → -3) — this used to truncate — and `fit` then wraps an
 * out-of-range result (REAL_TO_INT(40000.0) is -25536); BOOL → numeric is 1/0; numeric → BOOL is "not zero".
 */
function coerce(v: Val, to: Type, from: Type): Val {
  if (to.kind !== "elementary") return v
  const family = to.elem.family
  // → STRING: an integer's decimal text, 'TRUE'/'FALSE', a TIME as `T#` and its non-zero components ('T#1d2h', 'T#0ms').
  // STRING → integer skips leading spaces and tabs, reads an optional sign and the digits that follow, stopping at the
  // first other character — '12abc' is 12, '$T7' is 7, '+5' is 5, '- 5' and '' are 0 (test/exec `string_conversions*`).
  // `fit` then wraps it like any integer: STRING_TO_INT('99999') is -31073.
  if (family === "string") {
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE"
    return from.kind === "elementary" && from.name === "TIME" ? timeText(v as bigint) : String(v)
  }
  if (typeof v === "string" && family === "real") {
    // a decimal prefix after spaces/tabs: '.5', '5.', '1.5E' (1.5), '2e2', '1,5' (1); none at all is 0 (`string_to_real_parse`)
    const m = /^[ \t]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(v)
    return m === null ? 0 : Number(m[1])
  }
  if (typeof v === "string") {
    const m = /^[ \t]*([+-]?)(\d*)/.exec(v)!
    const magnitude = BigInt(m[2] || "0")
    return m[1] === "-" ? -magnitude : magnitude
  }
  if (family === "bool") return typeof v === "boolean" ? v : typeof v === "bigint" ? v !== 0n : v !== 0
  const n = typeof v === "boolean" ? (v ? 1n : 0n) : v
  if (family === "real") return typeof n === "bigint" ? Number(n) : n
  // Math.round alone rounds -2.5 to -2 (half toward +infinity); on the magnitude it is half away from zero.
  if (typeof n === "number" && to.elem.rank !== undefined) return BigInt(Math.sign(n) * Math.round(Math.abs(n)))
  return n
}

// ─── the machine ─────────────────────────────────────────────────────────────

class Machine {
  constructor(
    readonly frame: Val[],
    private readonly types: readonly Type[],
  ) {}

  read(place: Place): Val {
    const value = this.frame[place.slot]!
    const bit = place.path[0]
    // A bigint's `>>` and `&` work on infinite two's complement, so a negative INT's bits read as the PLC's do.
    return bit === undefined ? value : ((num(value) as bigint) >> BigInt(bit.index)) & 1n ? true : false
  }

  write(place: Place, value: Val): void {
    const bit = place.path[0]
    if (bit === undefined) {
      this.frame[place.slot] = fit(value, place.type)
      return
    }
    const current = num(this.frame[place.slot]!) as bigint
    const mask = 1n << BigInt(bit.index)
    // set or clear, then store at the SLOT's width — so INT's bit 15 set on 0 reads back as -32768
    this.frame[place.slot] = fit(bool(value) ? current | mask : current & ~mask, this.types[place.slot]!)
  }

  expr(e: IrExpr): Val {
    switch (e.kind) {
      case "const":
        return fit(e.value, e.type)
      case "load":
        return this.read(e.place)
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
            // TRUNC(3.0E9) is -2147483648, where LREAL_TO_DINT(3.0E9) wraps to -1294967296 (test/exec
            // `trunc_out_of_range`). TRUNC_INT then wraps that DINT into INT, as `fit` does for every integer.
            const t = Math.trunc(Number(num(args[0]!)))
            const inRange = Number.isFinite(t) && t >= -2147483648 && t <= 2147483647
            return fit(inRange ? BigInt(t) : -2147483648n, e.type)
          }
          case "shl":
          case "shr": {
            // x86's count mask: SHL(DWORD 1, 33) is 2 and a count of -1 shifts by 31 (test/exec `shift_count_*`,
            // `shift_negative_count`). The value is already promoted, and a bigint `>>` is arithmetic on a negative —
            // SHR(SINT -128, 1) is -64, as measured.
            const bits = e.type.kind === "elementary" ? e.type.elem.bits : 32
            const count = BigInt(Number(num(args[1]!)) & (bits - 1))
            const value = num(args[0]!) as bigint
            return fit(e.name === "shl" ? value << count : value >> count, e.type)
          }
          case "rol":
          case "ror": {
            // in the value's own width, count modulo that width — ROL(BYTE 129, 9) is 3 (test/exec `rotate_*`)
            const bits = e.type.kind === "elementary" ? e.type.elem.bits : 32
            const width = BigInt(bits)
            const left = BigInt(((Number(num(args[1]!)) % bits) + bits) % bits)
            const by = e.name === "rol" ? left : (width - left) % width
            const unsigned = BigInt.asUintN(bits, num(args[0]!) as bigint)
            return fit(BigInt.asUintN(bits, (unsigned << by) | (unsigned >> ((width - by) % width))), e.type)
          }
          case "mux": {
            // an out-of-range K — negative included — picks the LAST input (test/exec `mux_out_of_range`)
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
  const frame = pou.slots.map((s) => fit(s.init ?? defaultOf(s.type), s.type))
  const byName = new Map(pou.slots.map((s, i) => [s.name.toUpperCase(), i]))
  const machine = new Machine(
    frame,
    pou.slots.map((s) => s.type),
  )

  const slotOf = (name: string): number => {
    const i = byName.get(name.toUpperCase())
    if (i === undefined) throw new Error(`no variable ${name} in ${pou.name}`)
    return i
  }

  return {
    frame,
    get: (name) => frame[slotOf(name)]!,
    // stored as the slot's type holds it, like every write the program makes — a test cannot plant a value the PLC couldn't
    set: (name, value) => {
      const i = slotOf(name)
      frame[i] = fit(value, pou.slots[i]!.type)
    },
    scan: () => void machine.block(pou.body),
  }
}
