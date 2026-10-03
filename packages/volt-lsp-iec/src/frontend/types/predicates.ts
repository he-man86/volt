/**
 * WHICH KIND OF TYPE A NAME IS — the derived views of the elementary table (`elementary.ts`): numeric, integer,
 * temporal, isolated from implicit conversion, a known primitive. The one place each old scattered set is computed.
 */
import { ANY_FAMILIES, elementaryType } from "./elementary.js"
import { isElementaryTypeName } from "./platform.js"

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

/** A name the resolver treats as a known primitive (was `type-resolver.ELEMENTARY_TYPES`): an elementary
 *  type, an `ANY_*` generic, or the bare `POINTER` keyword. */
export function isKnownPrimitive(name: string): boolean {
  const u = name.toUpperCase()
  return isElementaryTypeName(u) || ANY_FAMILIES.has(u) || u === "POINTER"
}
