/** THE INTERPRETER'S VALUES: what a runtime value is, the two accessors that insist on its kind, and a composite's copy. */
import type { IrValue } from "../ir/index.js"
import type { Type } from "../../frontend/types/index.js"
import { fit } from "./store.js"

/** A runtime value. Integers, durations and dates stay `bigint` in their type's unit (so `/` truncates like IEC does);
 *  REAL is `number`; STRING and WSTRING are `string`; a struct or FB instance is a record keyed by its fields'
 *  upper-cased names, and an array a JavaScript array (index 0 is the dimension's lower bound). */
export type Val = IrValue | Val[] | { [field: string]: Val }

/** A value that must be a number — lowering typed it so; anything else is an interpreter bug, thrown. */
export function num(v: Val): bigint | number {
  if (typeof v === "bigint" || typeof v === "number") return v
  throw new TypeError(`expected a number, got ${typeof v}`)
}

export function bool(v: Val): boolean {
  if (typeof v === "boolean") return v
  throw new TypeError(`expected BOOL, got ${typeof v}`)
}

/** A composite value copied, so a store of one struct or array into another shares nothing with its source. */
export function copy(v: Val): Val {
  return typeof v === "object" ? structuredClone(v) : v
}

/** A value as a slot of `type` takes it: a composite copied (it shares nothing with its source), anything else stored
 *  as the type holds it (`fit`). */
export function storeAs(value: Val, type: Type): Val {
  return typeof value === "object" ? copy(value) : fit(value, type)
}
