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
import type { Type } from "../../types/index.js"

/** A runtime value. Integers, durations and dates stay `bigint` in their type's unit (so `/` truncates like IEC does);
 *  REAL is `number`; STRING and WSTRING are `string`; a struct or FB instance is a record keyed by its fields'
 *  upper-cased names, and an array a JavaScript array (index 0 is the dimension's lower bound). */
export type Val = IrValue | Val[] | { [field: string]: Val }

/** The one-argument math functions. LOG is base 10 in IEC. */
export const MATH: Readonly<Record<IrMathName, (x: number) => number>> = {
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

export function arith(op: string, a: Val, b: Val): Val {
  const l = num(a)
  const r = num(b)
  if (typeof l === "bigint" && typeof r === "bigint") {
    // `/` by zero stops the application (the recorder's read times out); MOD by zero is 0 in every width and signedness,
    // the dividend's sign regardless (conformance `mod_by_zero`, `cc_mod_udint_dint`)
    if (op === "div" && r === 0n) throw new RangeError("division by zero")
    if (op === "mod" && r === 0n) return 0n
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
    // AN INFINITY STOPS THE TASK; a NaN does not. Measured on CODESYS 3.5.21.40, 2026-09-18, and the split is clean:
    //
    //   SQRT(-1) -> REAL#NaN, the scan completes      `domain_sqrt_negative`
    //   LN(-1)   -> REAL#NaN, the scan completes      `domain_ln_negative`
    //   LN(0)    -> the scan never completes          `domain_ln_zero`
    //   1.0 / 0  -> the scan never completes          `domain_divide_real_by_zero`
    //
    // "never completes" is the stable half. HOW it fails to complete is not: across runs the same case reports either
    // a stalled done flag or a timed-out start, depending on what ran before it. Only the completion is evidence.
    //
    // Both of the ones that die produce an infinity and both survivors produce a NaN, so the rule is the VALUE, not
    // the operation. That matters for a PLC: returning `Infinity` and carrying on is not a rounding difference from
    // the vendor, it is a program that keeps running where the real one has stopped. No recording holds an infinite
    // value — the only non-numeric REAL any of them prints is `REAL#NaN` — which is what this rule predicts.
    if (typeof v === "number" && !Number.isFinite(v) && !Number.isNaN(v))
      throw new RangeError("a REAL operation produced an infinity, which stops the task on CODESYS")
    return bits === 32 && typeof v === "number" ? Math.fround(v) : v
  }
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
    // REAL -> INTEGER GOES THROUGH A 64-BIT REGISTER, and `fit` then wraps into the declared type. Out of that
    // register's range — NaN included — the value is x86's "integer indefinite", i64::MIN. Measured on CODESYS
    // 3.5.21.40 (2026-09-18) and this explains four of the five points:
    //
    //   LREAL_TO_DINT(3.0E9)   = -1294967296   in range, wrapped narrow      (`real_to_int_out_of_range`)
    //   LREAL_TO_DINT(1.0E30)  = 0             i64::MIN, its low 32 bits     (`real_to_dint_above_range`)
    //   LREAL_TO_LINT(1.0E30)  = i64::MIN      the register itself           (`real_to_lint_above_range`)
    //   REAL_TO_DINT(NaN)      = 0             i64::MIN, its low 32 bits     (`real_to_dint_nan`)
    //
    // THE FIFTH DOES NOT FIT: `LREAL_TO_DINT(-1.0E30)` records -2147483648, where this model says 0
    // (`real_to_dint_below_range`). Both magnitudes are out of range and only the SIGN differs, so a single
    // conversion cannot produce both — the likeliest reading is that one of them is folded at compile time.
    // `real_to_dint_runtime_*` put the same magnitudes behind arithmetic the compiler cannot fold; until those are
    // recorded, the model that explains four points is used rather than a rule invented to explain five.
    const INDEFINITE = -(2n ** 63n)
    if (Number.isNaN(n)) return INDEFINITE
    const rounded = Math.sign(n) * Math.round(Math.abs(n))
    if (!Number.isFinite(rounded)) return INDEFINITE
    const value = BigInt(rounded)
    return value < INDEFINITE || value > 2n ** 63n - 1n ? INDEFINITE : value
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
