/**
 * THE TWIN HARNESS'S SHARED STEPS — a case's recorded value and input read off the recordings, and the Rust each case
 * table is printed as. Shared by `runtime-twins.test.ts` (the tables hold their recordings) and
 * `runtime-twins-rust.test.ts` (the Rust runtime against them).
 */
import { type Seen, STRING_CASES, type StringCase } from "../../../src/transpile/semantics/string.cases.js"
import { lengthOf, visible } from "../../../src/transpile/semantics/string.js"
import { MEMORY_CASES } from "../../../src/transpile/semantics/memory.cases.js"
import { NAN_CASES } from "../../../src/transpile/semantics/nan.cases.js"

/** Every string case, its rule's cases flattened. */
export const STRING_CASE_LIST: readonly StringCase[] = Object.values(STRING_CASES).flat()

/** What a buffer shows where a recording looked at it: the unit (0 past what is held), the string, or its length. */
export function shown(buffer: string, seen: Seen): string {
  if ("unit" in seen) return String(seen.unit < buffer.length ? buffer.charCodeAt(seen.unit) : 0)
  return "text" in seen ? visible(buffer) : String(lengthOf(buffer))
}

/** Every byte-image case, its rule's cases flattened. */
export const MEMORY_CASE_LIST = Object.values(MEMORY_CASES).flat()

/** Every NaN case, its rule's cases flattened. */
export const NAN_CASE_LIST = Object.values(NAN_CASES).flat()
