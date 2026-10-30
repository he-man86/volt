/**
 * A VALUE WRITTEN FROM OUTSIDE — what `Runner.set` takes (openspec `runner-set-checks`): only a value the variable's
 * DECLARED type holds as given, as CODESYS's online write refuses anything else ("value out of range" / "invalid value").
 * Nothing wraps, rounds past a range or is cut: a value the type does not hold is refused by name, and nothing is written
 * — the next scan reads only what lowering promised the cell holds. The owner's open points, built as their defaults and
 * open: an out-of-range integer is REFUSED, not wrapped (1); a STRING longer than its capacity is REFUSED, not cut (2).
 */
import type { IrLayout } from "../ir/index.js"
import { peelArray, type Type } from "../../frontend/types/index.js"
import { NaNBits, type Val } from "../semantics/index.js"

/** A write `Runner.set` refused — the path written, the variable's declared type, and why. Nothing was written. */
export class RunnerValueError extends Error {
  constructor(
    readonly path: string,
    readonly type: string,
    readonly reason: string,
  ) {
    super(`${path} : ${type} — ${reason}`)
    this.name = "RunnerValueError"
  }
}

/** The type as the IDE names it: `INT`, `STRING(5)`, `INT(0..10)`, `ARRAY[1..3] OF SINT`, `POINTER TO WORD`. */
function typeName(t: Type): string {
  if (t.kind === "elementary") {
    if (t.subrange !== undefined) return `${t.name}(${t.subrange.lower}..${t.subrange.upper})`
    return t.length === undefined ? t.name : `${t.name}(${t.length})`
  }
  const array = peelArray(t)
  if (array !== undefined) return `ARRAY[${array.lower}..${array.lower + BigInt(array.length) - 1n}] OF ${typeName(array.element)}`
  if (t.kind === "pointer" || t.kind === "reference") return `${t.kind.toUpperCase()} TO ${typeName(t.target)}`
  return "name" in t ? t.name : t.kind
}

/** What kind of value `v` is, with the value where it is short: `a bigint (5)`, `a string ("abc")`. */
function kindOf(v: Val): string {
  if (typeof v === "bigint" || typeof v === "number" || typeof v === "boolean") return `a ${typeof v} (${String(v)})`
  if (typeof v === "string") return `a string (${JSON.stringify(v)})`
  if (v instanceof NaNBits) return "a NaN"
  return Array.isArray(v) ? "an array" : "a record"
}

/** A refusal, thrown. */
const refuse = (path: string, t: Type, reason: string): never => {
  throw new RunnerValueError(path, typeName(t), reason)
}

/** Refused unless `v` is of the JavaScript kind `t` holds — `expected` says which. */
function ofKind(path: string, v: Val, t: Type, kind: "bigint" | "number" | "boolean" | "string", expected: string): void {
  const nan = kind === "number" && v instanceof NaNBits
  if (typeof v !== kind && !nan) refuse(path, t, `${kindOf(v)} is no ${typeName(t)} — ${typeName(t)} takes ${expected}`)
}

/** The range an integer-valued type holds: its subrange, its table range, or — a duration or a date — the unsigned count
 *  of its unit in its width. */
function rangeOf(t: Extract<Type, { kind: "elementary" }>): { min: bigint; max: bigint } {
  return t.subrange === undefined ? (t.elem.range ?? { min: 0n, max: (1n << BigInt(t.elem.bits)) - 1n }) : { min: t.subrange.lower, max: t.subrange.upper }
}

/** An elementary value: its kind, then what the type holds of that kind. */
function checkElementary(path: string, v: Val, t: Extract<Type, { kind: "elementary" }>): void {
  const { family, name } = t.elem
  if (family === "bool" || name === "BIT") return ofKind(path, v, t, "boolean", "a boolean")
  // A REAL HOLDS ITS INFINITIES AND ITS NaNs — the program makes them (`REAL#Infinity` completes, `SQRT(-1)` is a NaN) and
  // the edge differential seeds them — so a write of one is a value of the type: an infinity as the number, a NaN as its
  // BITS (`NaNBits`, of the type's width), never a JavaScript NaN, which states no bits (`fit` would pick the default
  // NaN's for it). A finite value no 32-bit float holds is refused: stored, it would become an infinity.
  if (family === "real") {
    ofKind(path, v, t, "number", "a number")
    if (v instanceof NaNBits) {
      if (v.width !== t.elem.bits) refuse(path, t, `a ${v.width}-bit NaN is no ${name} — ${name} holds ${t.elem.bits}-bit NaNs`)
      return
    }
    if (Number.isNaN(v)) return refuse(path, t, `NaN is written as its bits (a NaNBits of ${t.elem.bits} bits) — a JavaScript NaN states none`)
    if (t.elem.bits === 32 && Number.isFinite(v) && !Number.isFinite(Math.fround(v as number))) refuse(path, t, `${String(v)} is outside REAL's range — no 32-bit float holds it`)
    return
  }
  if (family === "string") return checkString(path, v, t)
  ofKind(path, v, t, "bigint", "a bigint")
  const { min, max } = rangeOf(t)
  if ((v as bigint) < min || (v as bigint) > max) refuse(path, t, `${v as bigint} is outside ${typeName(t)}'s range ${min}..${max}`)
}

/** A STRING or WSTRING: a string within the capacity, every character one the variable holds as written — a STRING an
 *  ASCII byte (`semantics/string.ts`: past ASCII its byte is not measured), a WSTRING one UTF-16 unit. The value is the
 *  variable's BUFFER: a NUL in it ends what `get` shows, and what stands after it is the residue a PLC's buffer holds too —
 *  written as given. */
function checkString(path: string, v: Val, t: Extract<Type, { kind: "elementary" }>): void {
  ofKind(path, v, t, "string", "a string")
  const s = v as string
  const shown = `'${s}'`
  if (t.length !== undefined && s.length > t.length) refuse(path, t, `${shown} has ${s.length} characters — a ${typeName(t)} holds ${t.length}`)
  if (t.name === "STRING" && [...s].some((c) => c.charCodeAt(0) > 0x7f))
    refuse(path, t, `${shown} holds a character past ASCII, whose byte in a STRING is not measured`)
  if (t.name === "WSTRING" && [...s].some((c) => c.length > 1))
    refuse(path, t, `${shown} holds a character past one UTF-16 unit, whose units in a WSTRING are not measured`)
}

/**
 * THE ONE CHECK — `value` written at `path` into a variable of `type`, or a `RunnerValueError`. A struct is checked field
 * by field (every field, nothing more, by the upper-cased names `get` reads it with), an array element by element (its
 * length, then each, named by its index); an FB instance is written by its variables, never whole; a POINTER, REFERENCE
 * or INTERFACE holds what the program stored in it.
 */
export function checkValue(path: string, value: Val, type: Type, layouts: ReadonlyMap<string, IrLayout>): void {
  if (type.kind === "elementary") return checkElementary(path, value, type)
  const array = peelArray(type)
  if (array !== undefined) {
    if (!Array.isArray(value)) return refuse(path, type, `${kindOf(value)} is no ${typeName(type)} — ${typeName(type)} takes an array of its elements`)
    if (value.length !== array.length) refuse(path, type, `the value has ${value.length} elements — the array holds ${array.length}`)
    value.forEach((element, i) => checkValue(`${path}[${array.lower + BigInt(i)}]`, element, array.element, layouts))
    return
  }
  if (type.kind === "function_block") return refuse(path, type, "an FB instance is written by its variables, not whole")
  if (type.kind === "pointer" || type.kind === "reference" || type.kind === "interface")
    return refuse(path, type, `a ${type.kind.toUpperCase()} holds what the program stores in it — it is not written from outside`)
  if (type.kind !== "struct") return refuse(path, type, `a ${type.kind} variable holds no value a write could give it`)
  const fields = layouts.get(type.name.toUpperCase())!.fields
  if (typeof value !== "object" || Array.isArray(value) || value instanceof NaNBits)
    return refuse(path, type, `${kindOf(value)} is no ${type.name} — ${type.name} takes a record of its fields`)
  const missing = fields.find((f) => !(f.name.toUpperCase() in value))
  if (missing !== undefined) refuse(path, type, `the value has no field ${missing.name.toUpperCase()}`)
  const extra = Object.keys(value).find((k) => !fields.some((f) => f.name.toUpperCase() === k))
  if (extra !== undefined) refuse(path, type, `${type.name} has no field ${extra}`)
  for (const f of fields) checkValue(`${path}.${f.name.toUpperCase()}`, value[f.name.toUpperCase()]!, f.type, layouts)
}
