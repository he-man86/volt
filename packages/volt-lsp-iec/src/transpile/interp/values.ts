/**
 * The interpreter's values and the rules that make them IEC: how a type stores a value (`fit`), how a conversion reads
 * one (`coerce`), the operators on them, the Standard string functions, and a fresh value of a type.
 */
import {
  defaultValueOf,
  type IrLayout,
  type IrMathName,
  type IrStringName,
  type IrInit,
  type IrValue,
  peelArray,
} from "../ir/index.js"
import { elemOf, type Type } from "../../types/index.js"
import { isBit } from "../ir/index.js"

/** A runtime value. Integers, durations and dates stay `bigint` in their type's unit (so `/` truncates like IEC does);
 *  REAL is `number`; STRING and WSTRING are `string`; a struct or FB instance is a record keyed by its fields'
 *  upper-cased names, and an array a JavaScript array (index 0 is the dimension's lower bound). */
export type Val = IrValue | Val[] | { [field: string]: Val }

/**
 * The one-argument math functions. LOG is base 10 in IEC.
 *
 * A LOGARITHM OF ZERO STOPS THE TASK, and nothing else in this table stops anything. Measured across all ten
 * functions' domain edges (`operators/math-domain.ts`, 2026-09-18) — the whole rest of the table completes:
 *
 *   SQRT(-1) ASIN(2) ACOS(-2) LN(-1) LOG(-1) SIN(inf)   ->  NaN
 *   EXP(1000) SQRT(inf) LN(inf)                         ->  Infinity
 *   EXP(-1000)                                          ->  0
 *   TAN(pi/2)                                           ->  1.6331239353195370E16, finite
 *   LN(0) LOG(0)                                        ->  THE SCAN NEVER COMPLETES
 *
 * Which makes exactly two things stop a CODESYS task: dividing by zero (`arith`) and this. Both are the machine's
 * divide-by-zero, and neither is "the result was infinite" — `EXP(1000)` is infinite and runs.
 */
const logarithm =
  (f: (x: number) => number) =>
  (x: number): number => {
    if (x === 0) throw new RangeError("the logarithm of zero stops the task on CODESYS")
    return f(x)
  }

export const MATH: Readonly<Record<IrMathName, (x: number) => number>> = {
  sqrt: Math.sqrt,
  ln: logarithm(Math.log),
  log: logarithm(Math.log10),
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
 * (`iec_*`), so the differential test checks both against CODESYS. Measured (conformance `string_*`,
 * `string_positions_*`): positions are 1-based and a count clamps to the string — LEFT(abc, 5) is 'abc', LEFT(abc, -1)
 * is ''; MID and DELETE select nothing at a position below 1 or a length at or below 0; INSERT at 0 prepends, but past
 * the end OR below 0 leaves the string as it was (INSERT(abc, 'XY', -1) is 'abc'); FIND of '' is 0. REPLACE is DELETE,
 * then INSERT at P - 1 raised to 0 — every measured REPLACE agrees: REPLACE(abc, 'XY', 1, 0) is 'XYabc' and
 * REPLACE(abc, 'XY', 2, 5) is 'abc'. (This first read "INSERT at P - 1", which implied INSERT at -1 prepends; the
 * oracle recorded that INSERT and said otherwise.)
 */
export const STRING_FUNCTIONS: Readonly<Record<IrStringName, (args: readonly Val[]) => Val>> = {
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
/** Days since 1970 as a civil year, month and day — Hinnant's days-from-civil inverse, mirrored by the prelude's `iec_civil`. */
export function civilDate(days: bigint): [bigint, bigint, bigint] {
  const z = days + 719468n
  const era = (z >= 0n ? z : z - 146096n) / 146097n
  const doe = z - era * 146097n
  const yoe = (doe - doe / 1460n + doe / 36524n - doe / 146096n) / 365n
  const doy = doe - (365n * yoe + yoe / 4n - yoe / 100n)
  const mp = (5n * doy + 2n) / 153n
  const d = doy - (153n * mp + 2n) / 5n + 1n
  const m = mp < 10n ? mp + 3n : mp - 9n
  return [yoe + era * 400n + (m <= 2n ? 1n : 0n), m, d]
}

const pad = (n: bigint, width: number): string => n.toString().padStart(width, "0")

/** A DATE, DT (seconds) or TOD (milliseconds) as its literal text, zero-padded; a TOD's milliseconds only when non-zero
 *  (conformance `temporal_conversions`) — mirrored by the prelude's `iec_date_text` / `iec_dt_text` / `iec_tod_text`. */
export function calendarText(name: "DATE" | "DT" | "TOD", v: bigint): string {
  if (name === "TOD") {
    const s = v / 1000n
    const clock = `${pad(s / 3600n, 2)}:${pad((s / 60n) % 60n, 2)}:${pad(s % 60n, 2)}`
    return `TOD#${clock}${v % 1000n === 0n ? "" : `.${pad(v % 1000n, 3)}`}`
  }
  const days = v >= 0n ? v / 86400n : (v - 86399n) / 86400n
  const [y, m, d] = civilDate(days)
  const date = `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`
  if (name === "DATE") return `D#${date}`
  const t = v - days * 86400n
  return `DT#${date}-${pad(t / 3600n, 2)}:${pad((t / 60n) % 60n, 2)}:${pad(t % 60n, 2)}`
}

export function timeText(ms: bigint): string {
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
export function clamp(n: Val, s: Val): number {
  return Math.min(Math.max(Number(n), 0), (s as string).length)
}

/** Up to `length` characters of `s` from `start`, never past its end. */
export function span(s: string, start: number, length: number): string {
  return s.slice(Math.min(start, s.length), Math.min(start + length, s.length))
}

/** A value that must be a number — lowering typed it so; anything else is an interpreter bug, thrown. */
export function num(v: Val): bigint | number {
  if (typeof v === "bigint" || typeof v === "number") return v
  throw new TypeError(`expected a number, got ${typeof v}`)
}

export function bool(v: Val): boolean {
  if (typeof v === "boolean") return v
  throw new TypeError(`expected BOOL, got ${typeof v}`)
}

// Lowering converts both operands of a comparison to ONE type, so the two values always share a representation, and
// JavaScript's own operators compare it exactly — bigints as bigints (a LINT above 2^53 included), strings by code unit.
export function eq(a: Val, b: Val): boolean {
  return a === b
}

export function ord(op: "lt" | "le" | "gt" | "ge", a: Val, b: Val): boolean {
  return op === "lt" ? a < b : op === "le" ? a <= b : op === "gt" ? a > b : a >= b
}

export function arith(op: string, a: Val, b: Val, type?: Type): Val {
  const l = num(a)
  const r = num(b)
  if (typeof l === "bigint" && typeof r === "bigint") {
    // `/` by zero stops the application (the recorder's read times out); MOD by zero is 0 in every width and signedness,
    // the dividend's sign regardless (conformance `mod_by_zero`, `cc_mod_udint_dint`)
    if (op === "div" && r === 0n) throw new RangeError("division by zero")
    if (op === "mod" && r === 0n) return 0n
    // A DIVISION WHOSE RESULT DOES NOT FIT THE COMPUTATION WIDTH STOPS THE TASK — `MIN / -1`, and nothing else can
    // reach it. This is the CPU's divide-overflow trap, not a wrap, and the measurements say exactly that
    // (`arithedge_*_div_min_by_minus_one`, 2026-09-18):
    //
    //   SINT  -128 / -1                 ->  SINT#-128       an 8-bit operand computes in DINT, where 128 fits,
    //   INT   -32768 / -1               ->  INT#-32768      so the division succeeds and only the STORE wraps
    //   DINT  -2147483648 / -1          ->  STOPS           computed in DINT: 2147483648 does not fit
    //   LINT  -9223372036854775808 / -1 ->  STOPS           computed in LINT: same
    //
    // So the width that matters is the one the operation COMPUTES in — `e.type`, the promoted type — and not the
    // slot's. Every other overflow in this function wraps on store and none of them trap.
    const elem = type !== undefined ? elemOf(type) : undefined
    if (op === "div" && elem?.signed === true && elem.bits !== undefined) {
      const quotient = l / r
      if (BigInt.asIntN(elem.bits, quotient) !== quotient)
        throw new RangeError("a division overflowed its type, which stops the task on CODESYS")
    }
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
  // A REAL DIVISION BY ZERO STOPS THE TASK TOO — IEEE would answer an infinity and carry on, and the vendor does
  // not: `realovf_divide_by_computed_zero` never finishes its scan while `realovf_divide_small_by_smaller`, which
  // overflows to the same infinity without a zero divisor, finishes fine. The divisor is what matters, not the
  // result. `-0.0 === 0` in JS, so a negative zero divisor is caught by the same test.
  if (op === "div" && y === 0) throw new RangeError("division by zero")
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
export function logic(op: "and" | "or" | "xor", a: Val, b: Val): Val {
  if (typeof a === "bigint" && typeof b === "bigint") return op === "and" ? a & b : op === "or" ? a | b : a ^ b
  const l = bool(a)
  const r = bool(b)
  return op === "and" ? l && r : op === "or" ? l || r : l !== r
}

/**
 * A value as its type STORES it — the interpreter's counterpart of the emitter's `wrapping_*` and `f32`. IEC
 * integers wrap at their declared width and REAL is a 32-bit float (both measured against CODESYS, `conformance`);
 * JavaScript gives neither for free, a bigint being unbounded and a number being float64. Every node that
 * produces a typed value passes through here, so an operand is always already in its type's representation.
 */
export function fit(v: Val, type: Type): Val {
  if (type.kind !== "elementary") return v
  const { family, bits, signed } = type.elem
  if (family === "real") {
    // AN INFINITY IS AN ORDINARY VALUE. This used to throw here, on the reading that an infinity stops the task and
    // a NaN does not — which fitted the four domain measurements and was still WRONG, because both of the cases that
    // stopped were divisions by zero:
    //
    //   SQRT(-1) -> REAL#NaN, completes    LN(-1) -> REAL#NaN, completes
    //   LN(0)    -> stops                  1.0/0  -> stops
    //
    // `operators/real-overflow.ts` separated the two readings and the answer is not the value (2026-09-18):
    //
    //   big * big        -> REAL#Infinity, completes        3.0E38 squared
    //   big + big        -> REAL#Infinity, completes
    //   1.0E38 / 1.0E-38 -> REAL#Infinity, completes        a DIVISION that overflows, divisor NOT zero
    //   num / (num-num)  -> stops                           divisor IS zero
    //   inf * 0.0        -> REAL#NaN,      completes        and the infinity is readable a statement later
    //
    // So a REAL variable can hold `REAL#Infinity` — `bound_real_above_max` holds one from a mere declaration — and
    // what stops the task is DIVIDING BY ZERO, exactly as it is for integers. That rule lives in `arith`.
    return bits === 32 && typeof v === "number" ? Math.fround(v) : v
  }
  // A BIT HOLDS A BOOLEAN. It is `bitstring` in the type table because it is one bit of LAYOUT, and everything else
  // already knew better — `defaultValueOf` starts it `false` and the emitter maps it to Rust `bool` — but an
  // explicit initializer took the integer path below and stored `0n`, so `x : BIT := 0` read back as 0 where CODESYS
  // says FALSE (`bound_bit_at_min` / `_at_max`, 2026-09-18; and `:= -1` or `:= 2` is refused outright, "Cannot
  // convert type 'SINT' to type 'BIT'"). The default value was right only because nothing converted it.
  if (isBit(type)) return typeof v === "bigint" ? v !== 0n : v
  // a STRING(n) keeps its first n characters — `STRING(5) := 'abcdefgh'` is 'abcde' (conformance `string_*`)
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
/** A type's elementary name, for a message — `unknown` where it has none. */
const elemName = (t: Type): string => (t.kind === "elementary" ? t.elem.name : t.kind)

/** An integer target — the only thing a STRING has a measured conversion to, besides REAL. */
const isInt = (t: Type): boolean =>
  t.kind === "elementary" && (t.elem.family === "int" || t.elem.family === "bitstring")

export function coerce(v: Val, to: Type, from: Type): Val {
  if (to.kind !== "elementary") return v
  const family = to.elem.family
  // → STRING: an integer's decimal text, 'TRUE'/'FALSE', a TIME as `T#` and its non-zero components ('T#1d2h', 'T#0ms').
  // STRING → integer skips leading spaces and tabs, reads an optional sign and the digits that follow, stopping at the
  // first other character — '12abc' is 12, '$T7' is 7, '+5' is 5, '- 5' and '' are 0 (conformance `string_conversions*`).
  // `fit` then wraps it like any integer: STRING_TO_INT('99999') is -31073.
  if (family === "string") {
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE"
    const source = from.kind === "elementary" ? from.name : ""
    if (source === "TIME") return timeText(v as bigint)
    return source === "DATE" || source === "DT" || source === "TOD" ? calendarText(source, v as bigint) : String(v)
  }
  if (typeof v === "string" && family === "real") {
    // a decimal prefix after spaces/tabs: '.5', '5.', '1.5E' (1.5), '2e2', '1,5' (1); none at all is 0 (`string_to_real_parse`)
    const m = /^[ \t]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(v)
    return m === null ? 0 : Number(m[1])
  }
  if (typeof v === "string") {
    // …AND ONLY FOR AN INTEGER TARGET. This was a catch-all: any string reaching any non-REAL target was parsed
    // for leading digits, so a BOOL or a TIME target got a digit parse nobody had measured. Lowering refuses
    // those conversions today (`conversion-type`, "not measured yet"), which is what kept the guess latent — but
    // a guess in the ORACLE is the worst place for one, because every other backend is graded against it.
    //
    // It is not a hypothetical. `cc6_string_to_bool_and_time` asked CODESYS on 2026-09-17 and the answer is
    // nothing like a digit parse: STRING_TO_BOOL('TRUE') and ('true') are TRUE, ('True') is FALSE, ('1') is
    // FALSE, (' TRUE') and ('TRUEX') are TRUE — a prefix match against exactly two spellings, case-uniform. The
    // digit parse would have answered TRUE for '1' and FALSE for 'TRUE'. Both measurements are in
    // `codesys.run.json`; implementing them is coverage work and belongs to `transpile-st-to-rust`.
    //
    // So: refuse rather than invent. Unreachable today, and if lowering ever lets one through, this says which.
    if (!isInt(to)) throw new TypeError(`no measured conversion from a STRING to ${elemName(to)}`)
    const m = /^[ \t]*([+-]?)(\d*)/.exec(v)!
    const magnitude = BigInt(m[2] || "0")
    return m[1] === "-" ? -magnitude : magnitude
  }
  if (family === "bool") return typeof v === "boolean" ? v : typeof v === "bigint" ? v !== 0n : v !== 0
  const n = typeof v === "boolean" ? (v ? 1n : 0n) : v
  if (family === "real") return typeof n === "bigint" ? Number(n) : n
  // Math.round alone rounds -2.5 to -2 (half toward +infinity); on the magnitude it is half away from zero.
  // REAL → TIME rounds the same way: REAL_TO_TIME(2.5) is 3ms (conformance `temporal_conversions`)
  if (typeof n === "number" && (to.elem.rank !== undefined || family === "time")) {
    // REAL -> INTEGER, MEASURED IN FULL. `conversions/real-to-integer.ts` asks both real types against all twelve
    // integer destinations with five out-of-range value classes, and `real-to-integer-ladder.ts` walks a magnitude
    // ladder on BOTH signs past every interesting threshold. 192 cells, and this reproduces every one.
    //
    // THE CONVERSION HAPPENS AT THE DESTINATION'S REGISTER WIDTH — 64-bit for a 64-bit destination, 32-bit for
    // everything else, which then wraps into the declared type in `fit`. That is the fact four points could not
    // show, and it is why `real_to_dint_below_range` sat unexplained: `LREAL_TO_DINT(-1.0E30)` is -2147483648
    // because the 32-BIT register's indefinite is 0x80000000, while `LREAL_TO_LINT(-1.0E30)` is the 64-bit one.
    //
    //   64-BIT DESTINATION                        32-BIT AND NARROWER
    //   NaN                    -> i64::MIN        NaN                     -> 0
    //   v >= 2^64              -> i64::MIN        v >= 2^63               -> 0
    //   v <  -2^63             -> i64::MIN        v <  -2^31              -> -2^31
    //   otherwise              -> wrap to i64     otherwise               -> wrap to i32
    //
    // The asymmetry between the two directions is the measurement's, not a simplification. Going UP a 32-bit
    // destination wraps all the way to 2^63 (LREAL_TO_DINT of 2^33 is 408, of 9.22E18 is -1024); going DOWN it
    // stops at -2^31 and answers 0x80000000 for everything below (-3.0E9 and -1.0E30 give the same -2147483648).
    // Which is not a shape a single hardware instruction produces, so no mechanism is claimed here — only the
    // table, which every one of the 192 recordings agrees with.
    const I64_MIN = -(2n ** 63n)
    const I32_MIN = -(2n ** 31n)
    const wide = to.elem.bits >= 64
    if (Number.isNaN(n)) return wide ? I64_MIN : 0n
    // ROUNDS, HALF AWAY FROM ZERO — `Math.round` alone takes -2.5 to -2. That rule was sourced from one value,
    // `REAL_TO_TIME(2.5) = 3ms`, which banker's rounding fits equally well. `conversions/integer-to-real.ts` asks
    // eight halves either side: 0.5 -> 1, 2.5 -> 3, -0.5 -> -1, -2.5 -> -3. Half to even would answer 0 and 2, so it
    // is ruled out rather than merely unlikely. `TRUNC` is toward zero and genuinely differs — TRUNC(-0.5) is 0.
    const rounded = Math.sign(n) * Math.round(Math.abs(n))
    if (!Number.isFinite(rounded)) return wide ? I64_MIN : rounded > 0 ? 0n : I32_MIN
    const value = BigInt(rounded)
    if (wide) return value >= 2n ** 64n || value < I64_MIN ? I64_MIN : BigInt.asIntN(64, value)
    if (value < I32_MIN) return I32_MIN
    if (value >= 2n ** 63n) return 0n
    return BigInt.asIntN(32, value)
  }
  return n
}

/** A fresh value of a type: an elementary one at `init`, a struct or FB instance at its fields' initial values, an array
 *  of fresh elements — the interpreter's counterpart of the emitter's `new()`. */
export function instantiate(type: Type, init: IrInit, layouts: ReadonlyMap<string, IrLayout>): Val {
  if (type.kind === "struct" || type.kind === "function_block") {
    const layout = layouts.get(type.name.toUpperCase())
    if (layout === undefined) throw new Error(`no layout for ${type.name}`)
    // the TYPE's own field values, with the fields an aggregate initializer names set over them
    const named = typeof init === "object" && "fields" in init ? init.fields : {}
    return Object.fromEntries(layout.fields.map((f) => [f.name.toUpperCase(), instantiate(f.type, named[f.name.toUpperCase()] ?? f.init, layouts)]))
  }
  const array = peelArray(type)
  // every element starts at its OWN type's zero — a BOOL array's is FALSE, not the array slot's placeholder — unless an
  // aggregate initializer gave it one
  const elements = typeof init === "object" && "elements" in init ? init.elements : []
  if (array !== undefined) return Array.from({ length: array.length }, (_, i) => instantiate(array.element, elements[i] ?? defaultValueOf(array.element), layouts))
  return fit(init as IrValue, type)
}

/** A composite value copied, so a store of one struct or array into another shares nothing with its source. */
export function copy(v: Val): Val {
  return typeof v === "object" ? structuredClone(v) : v
}
