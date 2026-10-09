/**
 * TEMPS — lowering-owned slots, invisible to ST: a FOR bound evaluated once, a chain's value, a guard taken before a call.
 */
import type { Span } from "../../../frontend/syntax/index.js"
import { type Type } from "../../../frontend/types/index.js"
import type { Place } from "../../ir/index.js"
import { type Lowering, zeroInit } from "./lowering.js"

/**
 * A lowering-owned slot of the frame. Its name is UNIQUE and starts with `__`, which CODESYS reserves, so no user
 * variable can take it. It used to be the bare purpose: two FOR loops in one POU made two `for_limit` fields — a Rust
 * struct rustc rejects — and a variable the user called `for_limit` would have collided with the temp. The interpreter
 * reads slots by index, so only the emitter noticed.
 */
export function temp(lw: Lowering, name: string, type: Type): number {
  lw.slots.push({ name: `__${name}_${lw.slots.length}`, type, section: "temp", init: zeroInit(type) })
  return lw.slots.length - 1
}

/** A temp as a place — a per-call local inside a routine, a field or slot elsewhere. */
export function tempPlace(lw: Lowering, purpose: string, type: Type, span: Span): Place {
  if (!lw.routineMode) return { slot: temp(lw, purpose, type), path: [], type, span }
  lw.localSlots.push({ name: `__${purpose}_${lw.localSlots.length}`, type, section: "temp", init: zeroInit(type) })
  return { slot: lw.localSlots.length - 1, path: [], type, span, root: "local" }
}
