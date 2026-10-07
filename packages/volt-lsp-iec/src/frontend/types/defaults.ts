/**
 * WHAT A DECLARATION THAT STATES NOTHING GETS — a sizeless STRING's length, and a type's zero value.
 */
import { isBit } from "./predicates.js"
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
  const family = type.kind === "elementary" ? type.elem.family : undefined
  return family === "bool" || isBit(type) ? false : family === "real" ? 0 : family === "string" ? "" : 0n
}
