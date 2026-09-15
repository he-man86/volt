/**
 * The interpreter's values and the rules that make them IEC: how a type stores a value (`fit`), how a conversion reads
 * one (`coerce`), the operators on them, the Standard string functions, and a fresh value of a type.
 */
import {
  defaultValueOf,
  type IrLayout,
  type IrMathName,
  type IrStringName,
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
  if (family === "real") return bits === 32 && typeof v === "number" ? Math.fround(v) : v
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
export function coerce(v: Val, to: Type, from: Type): Val {
  if (to.kind !== "elementary") return v
  const family = to.elem.family
  // → STRING: an integer's decimal text, 'TRUE'/'FALSE', a TIME as `T#` and its non-zero components ('T#1d2h', 'T#0ms').
  // STRING → integer skips leading spaces and tabs, reads an optional sign and the digits that follow, stopping at the
  // first other character — '12abc' is 12, '$T7' is 7, '+5' is 5, '- 5' and '' are 0 (conformance `string_conversions*`).
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

/** A fresh value of a type: an elementary one at `init`, a struct or FB instance at its fields' initial values, an array
 *  of fresh elements — the interpreter's counterpart of the emitter's `new()`. */
export function instantiate(type: Type, init: IrValue, layouts: ReadonlyMap<string, IrLayout>): Val {
  if (type.kind === "struct" || type.kind === "function_block") {
    const layout = layouts.get(type.name.toUpperCase())
    if (layout === undefined) throw new Error(`no layout for ${type.name}`)
    return Object.fromEntries(layout.fields.map((f) => [f.name.toUpperCase(), instantiate(f.type, f.init, layouts)]))
  }
  const array = peelArray(type)
  // every element starts at its OWN type's zero — a BOOL array's is FALSE, not the array slot's placeholder
  if (array !== undefined) return Array.from({ length: array.length }, () => instantiate(array.element, defaultValueOf(array.element), layouts))
  return fit(init, type)
}

/** A composite value copied, so a store of one struct or array into another shares nothing with its source. */
export function copy(v: Val): Val {
  return typeof v === "object" ? structuredClone(v) : v
}
