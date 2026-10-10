/**
 * IR VALUES AS RUST EXPRESSIONS — a constant's literal, a string's units, and the expression a variable starts at.
 */
import type { IrInit, IrLayout, IrValue } from "../../ir/index.js"
import { peelArray, type Type } from "../../../frontend/types/index.js"
import { rustName } from "./names.js"
import { isReal32, rustType, stringPath } from "./types.js"

/** Where the byte image starts — `semantics/memory.ts`'s, which the emitter may not import (layering rule 4); an address
 *  at or past it is printed in hex (`literal`). */
const IMAGE_BASE = 1n << 32n

/** Each layout the program holds, by its upper-cased name, with its fields' Rust names. */
export type Layouts = ReadonlyMap<string, { layout: IrLayout; fields: readonly string[] }>

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
  // no `u16` per unit: `lit`'s `&[T]` is the WSTRING's own `&[u16]` (7.4.8)
  if (t.kind === "elementary" && t.name === "WSTRING") return `&[${text.split("").map((ch) => `${ch.charCodeAt(0)}`).join(", ")}]`
  return byteString(text)
}

/**
 * A string literal as the UNITS a comparison reads of it (7.4.9): what `lit` would hold before its first 0, at most its
 * capacity — the bytes `b"abc"` (a STRING), the typed units `[97u16, 98u16]` (a WSTRING: nothing else fixes their type
 * there) — as an array for `==`/`!=`, a slice for an ordering (`&b"abc"[..]`: a slice has no order against an array).
 */
export function comparedUnits(v: string, t: Type, ordering: boolean): string {
  const capacity = t.kind === "elementary" ? t.length : undefined
  const units = v.slice(0, capacity).split("\0")[0]!
  const text = t.kind === "elementary" && t.name === "WSTRING" ? `[${units.split("").map((ch) => `${ch.charCodeAt(0)}u16`).join(", ")}]` : byteString(units)
  return ordering ? `&${text}[..]` : text
}

/** The fewest digits that parse back to the same f32 — a folded REAL (`0.10000000149011612`) printed as its f64 is
 *  clippy's `excessive_precision`, though it names the same f32 as `0.1`. */
function shortestF32(v: number): string {
  const f = Math.fround(v)
  if (!Number.isFinite(f)) return `${v}`
  for (let p = 1; p < 9; p++) if (Math.fround(Number(f.toPrecision(p))) === f) return `${Number(f.toPrecision(p))}`
  return `${Number(f.toPrecision(9))}`
}

/**
 * A LONG LITERAL'S DIGITS GROUPED BY THREE (7.2.11): an integer part of six digits or more from the right, a fraction of
 * six or more from the left (`1_709_078_400`, `0.100_000_001_490_116_12`) — clippy's `unreadable_literal` asks exactly
 * that, and leaves five digits or fewer bare. An exponent stays as written.
 */
export function grouped(text: string): string {
  return text.replace(/^(-?)(\d+)(?:\.(\d+))?/, (_m, sign: string, whole: string, fraction: string | undefined) => {
    const w = whole.length > 5 ? whole.replace(/\B(?=(?:\d{3})+$)/g, "_") : whole
    const f = fraction === undefined ? "" : `.${fraction.length > 5 ? fraction.replace(/(\d{3})(?=\d)/g, "$1_") : fraction}`
    return `${sign}${w}${f}`
  })
}

export function literal(v: IrValue, t: Type): string {
  if (typeof v === "boolean") return v ? "true" : "false"
  // an ADDRESS in the byte image, printed from where the image starts (`runtime/pointer.ts` `IMAGE_BASE`)
  // (hex, grouped by four: one literal, which no position needs parenthesized and clippy reads without a lint)
  if (t.kind === "pointer" && typeof v === "bigint" && v >= IMAGE_BASE) return `0x${v.toString(16).replace(/\B(?=(?:[0-9a-f]{4})+$)/g, "_")}`
  // an empty one is the empty string `new` builds (7.4.7): no slice to copy
  if (typeof v === "string") return v === "" ? `${stringPath(t)}::new()` : `${stringPath(t)}::lit(${unitsLiteral(v, t)})`
  // A REAL CONSTANT TOO BIG FOR ITS WIDTH IS AN INFINITY, not a compile error. `x : REAL := 3.5E38` is accepted by
  // CODESYS and holds `REAL#Infinity` (`bound_real_above_max`), while Rust refuses `3.5e38f32` outright —
  // "the literal does not fit into the type `f32` and will be converted to `f32::INFINITY`", denied by default. So
  // the conversion Rust is warning about is exactly the one the vendor performs: write it out.
  if (typeof v === "number" && !Number.isFinite(v) && !Number.isNaN(v))
    return `(${v < 0 ? "-" : ""}${t.kind === "elementary" ? rustType(t) : "f64"}::INFINITY)`
  if (typeof v === "number" && isReal32(t) && !Number.isFinite(Math.fround(v)))
    return `(${v < 0 ? "-" : ""}f32::INFINITY)`
  const digits = grouped(`${typeof v === "number" && isReal32(t) ? shortestF32(v) : v}`)
  const text = `${digits}${t.kind === "elementary" ? rustType(t) : ""}`.replace(/^(-?[\d_]+)(f\d\d)$/, "$1.0$2")
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
 * A CONSTANT AT A TYPED POSITION (7.2.8, 7.2.9) — a struct field's initializer, where the field's declared type fixes the
 * literal's: no suffix (`li: 0,`, `l25: 2.5,`) and no parentheses round a negative one (`im5: -5,`), which only a method
 * RECEIVER needs (`literal`). A REAL keeps its point (`0.0`), an infinity its path (`-f32::INFINITY`).
 */
function typedLiteral(v: IrValue, t: Type): string {
  if (typeof v !== "bigint" && typeof v !== "number") return literal(v, t)
  if (t.kind !== "elementary") return literal(v, t)
  if (typeof v === "number" && (!Number.isFinite(v) || (isReal32(t) && !Number.isFinite(Math.fround(v)))))
    return `${v < 0 ? "-" : ""}${rustType(t)}::INFINITY`
  const text = grouped(typeof v === "number" ? (isReal32(t) ? shortestF32(v) : `${v}`) : `${v}`)
  return typeof v === "number" && /^-?[\d_]+$/.test(text) ? `${text}.0` : text
}

/**
 * THE ONE `initOf`: a slot's initial value as a Rust expression — a scalar's literal; a struct or FB instance at its TYPE's
 * values (`new()`), with the fields an aggregate initializer names set over them; an array's stated elements, then every
 * remaining one at `rest` — `[x; N]` (an elementary element) or `std::array::from_fn` when it states none. It reads the
 * `IrInit` lowering made complete; it picks no default (transpile-restructure 5.3/5.4 — the free `initOfValue` and its
 * `typeZero` per element are gone).
 */
export function initOf(layouts: Layouts, t: Type, init: IrInit, typed = false): string {
  if (t.kind === "struct" || t.kind === "function_block") {
    const base = `${rustName(t.name)}::new()`
    const named = typeof init === "object" && "fields" in init ? init.fields : undefined
    const entry = layouts.get(t.name.toUpperCase())
    if (named === undefined || entry === undefined) return base
    // each `v.f = …` stores into a declared field: a typed position
    const sets = entry.layout.fields.flatMap((f, i) => (named[f.name.toUpperCase()] === undefined ? [] : [`v.${entry.fields[i]} = ${initOf(layouts, f.type, named[f.name.toUpperCase()]!, true)};`]))
    return sets.length === 0 ? base : `{ let mut v = ${base}; ${sets.join(" ")} v }`
  }
  const array = peelArray(t)
  if (array === undefined) {
    if (typeof init === "object") throw new Error(`initOf: a ${t.kind} slot with an aggregate initial value`)
    return typed ? typedLiteral(init, t) : literal(init, t)
  }
  if (typeof init !== "object" || !("elements" in init)) throw new Error("initOf: an array slot whose initial value states no elements")
  const rest = initOf(layouts, array.element, init.rest, typed)
  if (init.elements.length === 0) return array.element.kind === "elementary" ? `[${rest}; ${array.length}]` : `std::array::from_fn(|_| ${rest})`
  return `[${Array.from({ length: array.length }, (_, i) => (i < init.elements.length ? initOf(layouts, array.element, init.elements[i]!, typed) : rest)).join(", ")}]`
}
