/** THE INTERPRETER'S VALUES: what a runtime value is, the two accessors that insist on its kind, and a composite's copy. */
import type { IrValue } from "../ir/index.js"
import type { Type } from "../../frontend/types/index.js"
import { fit } from "./store.js"
import { NaNBits } from "./nan.js"

/** A runtime value. Integers, durations and dates stay `bigint` in their type's unit (so `/` truncates like IEC does);
 *  REAL is `number` — but a NaN, which is its bits (`NaNBits`, `semantics/nan.ts`); STRING and WSTRING are `string`; a struct
 *  or FB instance is a record keyed by its fields' upper-cased names, and an array a JavaScript array (index 0 is the
 *  dimension's lower bound). */
export type Val = IrValue | NaNBits | Val[] | { [field: string]: Val }

/** A value that must be a number — lowering typed it so; anything else is an interpreter bug, thrown. A NaN is the
 *  number NaN here: what reads it as a number (a comparison, a conversion to an integer) cannot tell one NaN from another. */
export function num(v: Val): bigint | number {
  if (typeof v === "bigint" || typeof v === "number") return v
  if (v instanceof NaNBits) return Number.NaN
  throw new TypeError(`expected a number, got ${typeof v}`)
}

export function bool(v: Val): boolean {
  if (typeof v === "boolean") return v
  throw new TypeError(`expected BOOL, got ${typeof v}`)
}

/** A struct or array — a value a store copies rather than shares. A NaN is an object too, and an immutable scalar. */
const isComposite = (v: Val): v is Val[] | { [field: string]: Val } => typeof v === "object" && !(v instanceof NaNBits)

/** A composite value copied, so a store of one struct or array into another shares nothing with its source. Element by
 *  element, not `structuredClone`: that makes a `NaNBits` a plain record, which no longer reads as a NaN. */
export function copy(v: Val): Val {
  if (Array.isArray(v)) return v.map(copy)
  return isComposite(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) : v
}

/** A value as a slot of `type` takes it: a composite copied (it shares nothing with its source), anything else stored
 *  as the type holds it (`fit`). */
export function storeAs(value: Val, type: Type): Val {
  return isComposite(value) ? copy(value) : fit(value, type)
}
