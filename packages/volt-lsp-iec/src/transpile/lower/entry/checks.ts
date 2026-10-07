/**
 * What a lowered POU's storage must be for a backend to hold it: a representable type, no reversed array.
 */

import { peelArray, type Type } from "../../../frontend/types/index.js"
import { openDims } from "../places/bounds.js"

/**
 * A type a backend can store: elementary, a laid-out struct or FB instance, or a sized array of those — and, in a slot a
 * call LENDS (`lent`), an `ARRAY[*]` of those: the array its call lends, a Rust slice (design §26).
 */
export function representable(t: Type, lent: boolean): boolean {
  // a pointer or reference holds its one target's index (design §9 form 1) — a plain integer in both backends
  // an interface holds its instance's tag (design §22) — a plain integer too
  if (t.kind === "elementary" || t.kind === "struct" || t.kind === "function_block" || t.kind === "pointer" || t.kind === "reference" || t.kind === "interface") return true
  if (openDims(t) > 0) return lent && representable((t as Extract<Type, { kind: "array" }>).element, false)
  const array = peelArray(t)
  return array !== undefined && representable(array.element, false)
}

/** An array type, at any depth of its elements, with a dimension whose lower bound is above its upper. */
export function reversedArray(t: Type): boolean {
  return t.kind === "array" && ((t.bounds ?? []).some((b) => b.lower > b.upper) || reversedArray(t.element))
}
