/**
 * Array bounds: an `ARRAY[*]`'s open dimensions and the hidden inputs carrying them, a place's bound, and the refusal
 * of storing an open array whole.
 */

import type { Lowering } from "../core/lowering.js"
import type { IrExpr, Place } from "../../ir/index.js"
import { elementaryRef, type Type } from "../../../frontend/types/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import { binaryOf } from "../core/build.js"

/**
 * One bound of one dimension of an array place — LOWER_BOUND/UPPER_BOUND. A sized array's folds; an `ARRAY[*]` in-out's
 * lower is the hidden bound its call was handed (design §26), its upper that plus the dimension's element count, minus
 * one — read off the array the call bound (`IrCount`, lean 7.7.8), so the two cannot disagree and only the lower bound
 * travels. DINT, as measured (`callshape_array_star_bound_width`, `callshape_bounds_of_sized_array`). Undefined where
 * neither is known.
 */
export function boundOf(lw: Lowering, place: Place, which: "lower" | "upper", dim: number): IrExpr | undefined {
  const type = elementaryRef("DINT")
  if (place.type.kind !== "array") return undefined
  if (place.type.bounds !== undefined) {
    const bound = place.type.bounds[dim - 1]
    return bound === undefined ? undefined : { kind: "const", value: which === "lower" ? bound.lower : bound.upper, type, span: place.span }
  }
  if (place.root !== "inout" || place.path.length > 0 || dim < 1 || dim > place.type.dims.length) return undefined
  // an FB's in-out reached from its METHOD would read the instance's fields — the bounds of the body's current binding, a
  // model no recording shows (review of batch 3b)
  if (lw.inoutSlots[place.slot]!.ofInstance === true) return undefined
  const key = boundName(lw.inoutSlots[place.slot]!.name, dim).toUpperCase()
  const local = lw.localByName.get(key)
  const field = lw.byName.get(key)
  const at: Place | undefined =
    local !== undefined ? { slot: local, path: [], type, span: place.span, root: "local" } : field !== undefined ? { slot: field, path: [], type, span: place.span } : undefined
  if (at === undefined) return undefined
  const lower: IrExpr = { kind: "load", place: at, type, span: place.span }
  if (which === "lower") return lower
  const count: IrExpr = { kind: "count", array: place, dim, type, span: place.span }
  return binaryOf("sub", binaryOf("add", lower, count, type, place.span), { kind: "const", value: 1n, type, span: place.span }, type, place.span)
}

/**
 * An `ARRAY[*]` read or stored as a whole value — refused: it is only ever indexed, bound to another in-out, or read by
 * LOWER_BOUND/UPPER_BOUND in what is recorded. `tmp := numbers` printed a slice clone rustc rejects, and a store swapped
 * the caller's array for one of another length under the old bounds (review of batch 3b).
 */
export function refuseOpenArray(lw: Lowering, place: Place, span: Span): boolean {
  if (openDims(place.type) === 0) return false
  lw.bail("open-array-value", "an ARRAY[*] used as a whole value, not indexed or bound to an in-out", span)
  return true
}

/** How many open dimensions an `ARRAY[*]` has — 0 for any other type, a sized array whose bounds did not fold included. */
export const openDims = (t: Type): number => (t.kind === "array" && t.bounds === undefined && t.dims.every((d) => d.lower === undefined && d.upper === undefined) ? t.dims.length : 0)

/** The hidden slot holding the lower bound of an `ARRAY[*]` in-out's dimension (design §26) — `__`, which CODESYS
 *  reserves. The upper is derived (`boundOf`), never handed. */
export const boundName = (inout: string, dim: number): string => `__${inout}_lower_${dim}`
