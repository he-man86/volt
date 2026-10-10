/**
 * WHAT A DECLARATION THAT STATES NOTHING GETS — a sizeless STRING's length, and a type's zero value.
 */
import { isBoolValued } from "./predicates.js"
import type { Type } from "./type.js"

/** The characters a sizeless STRING or WSTRING holds (conformance `string_default_length`, `wstring_basic`). */
export const DEFAULT_STRING_LENGTH = 80

/**
 * A type's zero — the value a slot declared without one starts at: FALSE, 0, 0.0, an empty string, and 0 for a duration,
 * a date and a pointer (an index into the frame), in the shape the transpiler computes with (a duration or a date is a
 * `bigint` in its type's unit). The transpiler's lowering stamps it on a slot, so no backend picks a default: the
 * interpreter and the Rust emitter each kept a copy, and the emitter's gave a WSTRING field a STRING
 * (consolidate-lsp-structure B8). Was the transpiler's `defaultValueOf` (transpile-restructure 1.1.4).
 */
export function typeZero(type: Type): bigint | number | boolean | string {
  // A SUBRANGE starts at 0 when its range holds 0, else at its LOWER bound: INT(3..9) 3, INT(-5..5) 0, DINT(-10..-2) -10
  // (`tr_a25_subrange_defaults`, `decl_subrange_unsigned`: UINT(1..5) 1; transpile-restructure 6.A.25)
  if (type.kind === "elementary" && type.subrange !== undefined) {
    const { lower, upper } = type.subrange
    return lower <= 0n && upper >= 0n ? 0n : lower
  }
  const family = type.kind === "elementary" ? type.elem.family : undefined
  return isBoolValued(type) ? false : family === "real" ? 0 : family === "string" ? "" : 0n
}
