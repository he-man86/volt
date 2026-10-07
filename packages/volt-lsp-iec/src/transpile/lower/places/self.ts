/**
 * The instance a body runs on, as a place: the FB it runs on, `THIS^`, and the instance a call runs on.
 */

import type { Lowering } from "../lowering.js"
import type { Span } from "../../../frontend/syntax/index.js"
import type { Place } from "../../ir/index.js"
import { storageOf } from "../storage/layout.js"
import { pointeePlace } from "../pointers/deref.js"
import type { FbType } from "../core/lowering.js"

/** The FB a body runs on — what `THIS^` names — when it runs on one. */
export const selfFb = (lw: Lowering): FbType | undefined => (lw.selfType?.kind === "function_block" ? lw.selfType : undefined)

export const thisPlace = (type: FbType, span: Span): Place => ({ slot: 0, path: [], type, span, root: "this" })

/**
 * The FB instance a call runs on: the place itself, or — for a REFERENCE TO or POINTER TO an FB — the one it points at
 * (conformance `xo_reference_to_fb_call`: `chosen REF= right`, then `chosen(throttle := 7)` and `chosen.Boost()` both run
 * on `right`, which ends at 214 while `left` stays 0). Without this a reference to an FB was `stmt-call_stmt` for the
 * body call and `call-method` for the METHOD — the place resolved, but only its own type was looked at.
 */
export function instancePlace(lw: Lowering, place: Place, span: Span): Place | undefined {
  if (place.type.kind !== "reference" && place.type.kind !== "pointer") return place
  return storageOf(lw, place.type.target, span).kind === "function_block" ? pointeePlace(lw, place, undefined, span) : place
}
