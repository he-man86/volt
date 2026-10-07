/**
 * IR VALUES AS RUST EXPRESSIONS — a constant's literal, a string's units, and the expression a variable starts at.
 */
import type { IrInit, IrLayout, IrValue } from "../../ir/index.js"
import { peelArray, type Type, typeZero } from "../../../frontend/types/index.js"
import { rustName } from "./names.js"
import { isReal32, rustType, stringPath } from "./types.js"

/** Each layout the program holds, by its upper-cased name, with its fields' Rust names. */
export type Layouts = ReadonlyMap<string, { layout: IrLayout; fields: readonly string[] }>

/** The Rust expression a variable of `t` starts at: a literal, a layout's `new()`, or an array of fresh elements. */
function initOfValue(t: Type, init: IrValue): string {
  if (t.kind === "struct" || t.kind === "function_block") return `${rustName(t.name)}::new()`
  const array = peelArray(t)
  if (array === undefined) return literal(init, t)
  const element = initOfValue(array.element, typeZero(array.element))
  return array.element.kind === "elementary" ? `[${element}; ${array.length}]` : `std::array::from_fn(|_| ${element})`
}

/** A STRING's bytes as a Rust byte-string literal: printable ASCII as itself, every other byte as `\xNN`. */
function byteString(text: string): string {
  let out = ""
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    out += code >= 0x20 && code < 0x7f && ch !== '"' && ch !== "\\" ? ch : `\\x${code.toString(16).padStart(2, "0")}`
  }
  return `b"${out}"`
}

/** A string literal as the units of its type: bytes for a STRING, UTF-16 units for a WSTRING. */
function unitsLiteral(text: string, t: Type): string {
  // code UNITS, not code points — `split("")` walks UTF-16 units, as the interpreter's string does
  if (t.kind === "elementary" && t.name === "WSTRING") return `&[${text.split("").map((ch) => `${ch.charCodeAt(0)}u16`).join(", ")}]`
  return byteString(text)
}

/** The fewest digits that parse back to the same f32 — a folded REAL (`0.10000000149011612`) printed as its f64 is
 *  clippy's `excessive_precision`, though it names the same f32 as `0.1`. */
function shortestF32(v: number): string {
  const f = Math.fround(v)
  if (!Number.isFinite(f)) return `${v}`
  for (let p = 1; p < 9; p++) if (Math.fround(Number(f.toPrecision(p))) === f) return `${Number(f.toPrecision(p))}`
  return `${Number(f.toPrecision(9))}`
}

export function literal(v: IrValue, t: Type): string {
  if (typeof v === "boolean") return v ? "true" : "false"
  if (typeof v === "string") return `${stringPath(t)}::lit(${unitsLiteral(v, t)})`
  // A REAL CONSTANT TOO BIG FOR ITS WIDTH IS AN INFINITY, not a compile error. `x : REAL := 3.5E38` is accepted by
  // CODESYS and holds `REAL#Infinity` (`bound_real_above_max`), while Rust refuses `3.5e38f32` outright —
  // "the literal does not fit into the type `f32` and will be converted to `f32::INFINITY`", denied by default. So
  // the conversion Rust is warning about is exactly the one the vendor performs: write it out.
  if (typeof v === "number" && !Number.isFinite(v) && !Number.isNaN(v))
    return `(${v < 0 ? "-" : ""}${t.kind === "elementary" ? rustType(t) : "f64"}::INFINITY)`
  if (typeof v === "number" && isReal32(t) && !Number.isFinite(Math.fround(v)))
    return `(${v < 0 ? "-" : ""}f32::INFINITY)`
  const text = `${typeof v === "number" && isReal32(t) ? shortestF32(v) : v}${t.kind === "elementary" ? rustType(t) : ""}`.replace(/^(-?\d+)(f\d\d)$/, "$1.0$2")
  // A NEGATIVE CONSTANT IS PARENTHESIZED, because in Rust a method call binds TIGHTER than unary minus — the
  // classic `-1.abs()` trap. The emitter makes a constant the RECEIVER of a method in a dozen places
  // (`wrapping_*`, `max`/`min`, `limit`, `abs`, the shifts and rotates, `round`, `clone`, the string helpers),
  // and in every one of them a bare `-1i32` let the sign escape the call:
  //
  //   MAX(E_Sign.Neg, x)  with Neg := -1 and x := 5  ->  `-1i32.max((self.x as i32))`
  //
  // which Rust reads as `-(1.max(5))` = -5 where the interpreter and CODESYS answer 5. A silent wrong answer,
  // reachable from an ordinary negative enum value, and no recorded case caught it. Parenthesizing HERE fixes
  // every receiver position at once rather than at each of the dozen call sites, which is the only version of
  // this fix that a thirteenth call site cannot defeat.
  return text.startsWith("-") ? `(${text})` : text
}

/**
 * A slot's initial value as a Rust expression: a struct or FB instance at its TYPE's values (`new()`), with the fields
 * an aggregate initializer names set over them; an array element by element, each left out at its type's own.
 */
export function initOf(layouts: Layouts, t: Type, init: IrInit): string {
  if (t.kind === "struct" || t.kind === "function_block") {
    const base = `${rustName(t.name)}::new()`
    const named = typeof init === "object" && "fields" in init ? init.fields : undefined
    const entry = layouts.get(t.name.toUpperCase())
    if (named === undefined || entry === undefined) return base
    const sets = entry.layout.fields.flatMap((f, i) => (named[f.name.toUpperCase()] === undefined ? [] : [`v.${entry.fields[i]} = ${initOf(layouts, f.type, named[f.name.toUpperCase()]!)};`]))
    return sets.length === 0 ? base : `{ let mut v = ${base}; ${sets.join(" ")} v }`
  }
  const array = peelArray(t)
  const elements = typeof init === "object" && "elements" in init ? init.elements : undefined
  if (array === undefined || elements === undefined) return initOfValue(t, init as IrValue)
  return `[${Array.from({ length: array.length }, (_, i) => initOf(layouts, array.element, elements[i] ?? typeZero(array.element))).join(", ")}]`
}
