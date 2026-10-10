/** A CONVERSION NODE'S VALUE (`coerce`), before `fit` stores it at the target's width. */
import { isBoolValued, type Type } from "../../frontend/types/index.js"
import type { IrValue } from "../ir/index.js"
import type { Val } from "./value.js"
import { fit } from "./store.js"
import { visible } from "./string.js"
import { calendarText, longCalendarText, lrealText, ltimeText, timeText } from "./text.js"
import { parseInteger, parseReal } from "./parse.js"

/** A type's elementary name, for a message — `unknown` where it has none. */
const elemName = (t: Type): string => (t.kind === "elementary" ? t.elem.name : t.kind)

/** An integer target — the only thing a STRING has a measured conversion to, besides REAL. */
const isInt = (t: Type): boolean =>
  t.kind === "elementary" && (t.elem.family === "int" || t.elem.family === "bitstring")

/** A bigint rounded half-to-even straight to 24 significant bits — the one rounding an integer -> REAL makes. */
function toSingle(n: bigint): number {
  const magnitude = n < 0n ? -n : n
  const shift = BigInt(Math.max(0, magnitude.toString(2).length - 24))
  if (shift === 0n) return Number(n)
  let kept = magnitude >> shift
  const rest = magnitude - (kept << shift)
  const half = 1n << (shift - 1n)
  if (rest > half || (rest === half && (kept & 1n) === 1n)) kept += 1n
  const rounded = Number(kept << shift)
  return n < 0n ? -rounded : rounded
}

/** An elementary target — the only kind `coerce` converts to. */
type Elementary = Extract<Type, { kind: "elementary" }>

/**
 * A conversion node's value, before `fit` stores it at the target's width. Measured on CODESYS (design §11): REAL →
 * integer rounds half AWAY from zero (2.5 → 3, -2.5 → -3) — this used to truncate — and `fit` then wraps an
 * out-of-range result (REAL_TO_INT(40000.0) is -25536); BOOL → numeric is 1/0; numeric → BOOL is "not zero". A
 * dispatcher over the five conversions below; no rule of its own.
 */
export function coerce(v: Val, to: Type, from: Type): Val {
  if (to.kind !== "elementary") return v
  const family = to.elem.family
  if (family === "string") return toText(v, to, from)
  if (typeof v === "string") return fromText(visible(v), to)
  if (isBoolValued(to)) return toBool(v)
  const n = typeof v === "boolean" ? (v ? 1n : 0n) : v
  if (family === "real") return toReal(n, to)
  // Math.round alone rounds -2.5 to -2 (half toward +infinity); on the magnitude it is half away from zero.
  // REAL → TIME rounds the same way: REAL_TO_TIME(2.5) is 3ms (conformance `temporal_conversions`)
  if (typeof n === "number" && (to.elem.rank !== undefined || family === "time")) return realToInt(n, to)
  return n
}

/**
 * → STRING: an integer's decimal text, 'TRUE'/'FALSE', a TIME as `T#` and its non-zero components ('T#1d2h', 'T#0ms').
 * (STRING → integer is `fromText`; `fit` then wraps it like any integer: STRING_TO_INT('99999') is -31073.)
 */
function toText(v: Val, to: Elementary, from: Type): Val {
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE"
  const source = from.kind === "elementary" ? from.name : ""
  // STRING <-> WSTRING carries the string, not the buffer behind it (the prelude's `narrow` / `widen`)
  if (typeof v === "string") return source === to.elem.name ? v : visible(v)
  if (source === "TIME") return timeText(v as bigint)
  if (source === "LTIME") return ltimeText(v as bigint)
  if (source === "LREAL") return lrealText(v as number)
  if (source === "LDATE" || source === "LDT" || source === "LTOD") return longCalendarText(source, v as bigint)
  return source === "DATE" || source === "DT" || source === "TOD" ? calendarText(source, v as bigint) : String(v)
}

/**
 * STRING → number, on the string the buffer holds: a REAL target reads a decimal prefix (`parseReal`); an integer target
 * skips leading spaces and tabs, reads an optional sign and the digits that follow, stopping at the first other
 * character — '12abc' is 12, '$T7' is 7, '+5' is 5, '- 5' and '' are 0 (conformance `string_conversions*`, `parseInteger`).
 */
function fromText(v: string, to: Elementary): Val {
  if (to.elem.family === "real") return parseReal(v)
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
  return parseInteger(v)
}

/** numeric → BOOL is "not zero". */
export function toBool(v: Val): Val {
  return typeof v === "boolean" ? v : typeof v === "bigint" ? v !== 0n : v !== 0
}

/** → REAL: an integer rounds to the target's width ONCE: `Number(n)` then `fit`'s `Math.fround` rounds a 64-bit value
 *  twice, and 2^60+2^36+1 lands on REAL's halfway point in LREAL and ties down to 2^60 — CODESYS and Rust `as f32` say
 *  2^60+2^37 (`tr_47_i2r_lint_to_real_double_round`). */
export function toReal(n: Val, to: Elementary): Val {
  return typeof n === "bigint" ? (to.elem.bits === 32 ? toSingle(n) : Number(n)) : n
}

const I64_MIN = -(2n ** 63n)
const I32_MIN = -(2n ** 31n)

/**
 * REAL -> INTEGER, MEASURED IN FULL. `conversions/real-to-integer.ts` asks both real types against all twelve
 * integer destinations with five out-of-range value classes, and `real-to-integer-ladder.ts` walks a magnitude
 * ladder on BOTH signs past every interesting threshold. 192 cells, and this reproduces every one.
 *
 * THE CONVERSION HAPPENS AT THE DESTINATION'S REGISTER WIDTH — 64-bit for a 64-bit destination, 32-bit for
 * everything else, which then wraps into the declared type in `fit`. That is the fact four points could not
 * show, and it is why `real_to_dint_below_range` sat unexplained: `LREAL_TO_DINT(-1.0E30)` is -2147483648
 * because the 32-BIT register's indefinite is 0x80000000, while `LREAL_TO_LINT(-1.0E30)` is the 64-bit one.
 *
 *   64-BIT DESTINATION                        32-BIT AND NARROWER
 *   NaN                    -> i64::MIN        NaN                     -> 0
 *   v >= 2^64              -> i64::MIN        v >= 2^63               -> 0
 *   v <  -2^63             -> i64::MIN        v <  -2^31              -> -2^31
 *   otherwise              -> wrap to i64     otherwise               -> wrap to i32
 *
 * The asymmetry between the two directions is the measurement's, not a simplification. Going UP a 32-bit
 * destination wraps all the way to 2^63 (LREAL_TO_DINT of 2^33 is 408, of 9.22E18 is -1024); going DOWN it
 * stops at -2^31 and answers 0x80000000 for everything below (-3.0E9 and -1.0E30 give the same -2147483648).
 * Which is not a shape a single hardware instruction produces, so no mechanism is claimed here — only the
 * table, which every one of the 192 recordings agrees with.
 */
function realToInt(n: number, to: Elementary): bigint {
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

/** A conversion node's value as its target stores it — `coerce`, then `fit`. The one rule the IR fold and the
 *  interpreter both run (lean 10.3). */
export function convertValue(v: Val, to: Type, from: Type): Val {
  return fit(coerce(v, to, from), to)
}

/** A constant node's value — the literal as its type stores it. */
export function constValue(value: IrValue, type: Type): Val {
  return fit(value, type)
}
