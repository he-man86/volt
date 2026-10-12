/**
 * WHICH KIND OF TYPE A NAME IS — the derived views of the elementary table (`elementary.ts`): numeric, integer,
 * temporal, isolated from implicit conversion, a known primitive. The one place each old scattered set is computed.
 */
import { ANY_FAMILIES, elementaryType } from "./elementary.js"
import { builtinName } from "./builtins.js"
import type { Dialect } from "../syntax/index.js"
import { elemOf, type Type } from "./type.js"

/** Numeric widening rank (was `NUMERIC_RANK` in check-assignment-types), or undefined for non-numeric. */
export function numericRank(name: string): number | undefined {
  return elementaryType(name)?.rank
}

/** Integer-family names (was `INTEGER_TYPES` in check-binary-operators): int/bit-string with a rank (excludes BIT). */
export function isIntegerType(name: string): boolean {
  const t = elementaryType(name)
  return t !== undefined && t.rank !== undefined && (t.family === "int" || t.family === "bitstring")
}

/** Numeric names (was `NUMERIC_TYPES`): everything with a widening rank (integers + REAL/LREAL). */
export function isNumericType(name: string): boolean {
  return numericRank(name) !== undefined
}

/** Assignment-isolated families — no cross-family implicit conversion (was `ISOLATED`). */
export function isIsolated(name: string): boolean {
  const f = elementaryType(name)?.family
  return f === "bool" || f === "string" || f === "time" || f === "date"
}

/** Date/time (non-duration) family (was `DATETIME_TYPES`). */
export function isDatetime(name: string): boolean {
  return elementaryType(name)?.family === "date"
}

/** Duration family — TIME/LTIME (was `DURATION_TYPES`). */
export function isDuration(name: string): boolean {
  return elementaryType(name)?.family === "time"
}

/**
 * A DURATION OR A DATE — the elementary types whose text is a LITERAL (`T#1s500ms`, `DT#2024-01-01-12:00:00`)
 * rather than a number, so `TO_STRING` renders them through the prelude's own formatter.
 *
 * <p>One home because the two halves of that rule were two hardcoded lists in different folders: the transpiler's
 * admission gate said `["BOOL", "TIME", "LTIME", "DATE", "DT", "TOD", "LREAL"]` and the Rust emitter's dispatch
 * said `["TIME", "LTIME", "DATE", "DT", "TOD"]`, agreeing by luck. They fail in opposite directions and only one
 * of them says so: a name admitted but not dispatched falls to an unguarded `format!` and prints the underlying
 * integer, with no diagnostic anywhere.</p>
 */
export function isTemporal(name: string): boolean {
  return isDuration(name) || isDatetime(name)
}

/** A name the compiler provides as a TYPE in `dialect` (an elementary type it has — `builtinName`), an `ANY_*` generic, or the
 *  bare `POINTER` keyword. */
export function isKnownPrimitive(name: string, dialect: Dialect): boolean {
  const u = name.toUpperCase()
  return builtinName(u, dialect) === "type" || ANY_FAMILIES.has(u) || u === "POINTER"
}

// ─── predicates over a resolved `Type` (openspec transpile-restructure design.md §6 need 5) ───────────────────────────
// The questions the transpiler asks of a type, answered once: lowering and both backends ask here and decide nothing of
// their own (design.md P4). `emit/rust` maps a type to Rust through these alone.

/** A BIT (a struct field of one bit) holds a BOOLEAN: CODESYS reads `dut.bFlag` as TRUE/FALSE, starting at FALSE
 *  (conformance `type_dut_struct_with_bit_fields`) — so both backends store it as their boolean. */
export function isBit(t: Type): boolean {
  return t.kind === "elementary" && t.elem.name === "BIT"
}

/** A type whose value is a BOOLEAN: BOOL, and a BIT (`isBit`) — the same value; a BIT is one bit only in the LAYOUT. */
export function isBoolValued(t: Type): boolean {
  return isBit(t) || elemOf(t)?.family === "bool"
}

/** An integer or a bit string held as an integer (ANY_INT and BYTE…LWORD) — not a BIT, which holds a BOOLEAN. */
export function isIntegral(t: Type): boolean {
  const family = elemOf(t)?.family
  return family === "int" || (family === "bitstring" && !isBit(t))
}

/** A type held as an integer of its `bits`: `isIntegral`, and a duration or a date — TIME/TOD 32-bit milliseconds,
 *  DATE/DT 32-bit seconds, the L variants 64-bit nanoseconds (transpile design §16, §17). */
export function holdsIntegerBits(t: Type): boolean {
  const family = elemOf(t)?.family
  return isIntegral(t) || family === "time" || family === "date"
}

/** A string type's kind — `"STRING"` or `"WSTRING"` — or undefined for anything else. */
export function stringKind(t: Type): "STRING" | "WSTRING" | undefined {
  const elem = elemOf(t)
  return elem?.family !== "string" ? undefined : elem.name === "WSTRING" ? "WSTRING" : "STRING"
}

/** A REAL or an LREAL. */
export function isReal(t: Type): boolean {
  return elemOf(t)?.family === "real"
}

/** A real type's width — 32 for REAL, 64 for LREAL — or undefined for anything else. */
export function floatBits(t: Type): 32 | 64 | undefined {
  const elem = elemOf(t)
  return elem?.family !== "real" ? undefined : elem.bits === 32 ? 32 : 64
}

/** A type whose text is a LITERAL (`T#1s500ms`, `DT#…`) — a duration or a date (`isTemporal`, asked of a `Type`). */
export function hasTextFormat(t: Type): boolean {
  const elem = elemOf(t)
  return elem !== undefined && isTemporal(elem.name)
}
