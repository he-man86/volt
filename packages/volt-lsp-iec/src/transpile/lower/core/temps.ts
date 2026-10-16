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
 * reads slots by index, so only the emitter noticed. A `statement` temp is `scoped` (`IrSlot.scoped`): the Rust prints
 * it as a local of the fn that runs the statement, never a field (lean 7.6.1).
 */
function temp(lw: Lowering, name: string, type: Type, written: TempWrite): number {
  lw.slots.push({ name: `__${name}_${lw.slots.length}`, type, section: "temp", init: zeroInit(type), ...(written === "statement" ? { scoped: true as const } : {}) })
  return lw.slots.length - 1
}

/**
 * Where a temp is written: `statement` — at ONE site, before every read, all of them in the block that write stands in
 * (a chain's value, a property's, an in-out's frozen index, guard or address, a kept `__base`); `branches` — in several
 * arms (`__QUERYINTERFACE`'s found flag, one store per tag), so it stays a field in a body.
 */
type TempWrite = "statement" | "branches"

/** A temp as a place — a per-call local inside a routine, a field or slot elsewhere. */
export function tempPlace(lw: Lowering, purpose: string, type: Type, span: Span, written: TempWrite): Place {
  if (!lw.routineMode) return { slot: temp(lw, purpose, type, written), path: [], type, span }
  lw.localSlots.push({ name: `__${purpose}_${lw.localSlots.length}`, type, section: "temp", init: zeroInit(type) })
  return { slot: lw.localSlots.length - 1, path: [], type, span, root: "local" }
}
