/**
 * The clock: `TIME()` and `LTIME()` read a global the harness sets before a scan.
 */

import type { Lowering } from "../lowering.js"
import type { Expr } from "../../../frontend/syntax/index.js"
import type { IrExpr } from "../../ir/index.js"
import { elementaryRef } from "../../../frontend/types/index.js"
import { convert } from "../values/convert.js"

/** The global `TIME()` and `LTIME()` read: an LTIME in nanoseconds, which a harness sets before a scan
 *  (`Runner.set(CLOCK, ns)`). Keyed in the globals by `TIME()` — a spelling no ST identifier can have, so no GVL variable
 *  can become the clock, or the clock a GVL variable. */
export const CLOCK = "__clock"

const CLOCK_KEY = "TIME()"

/**
 * `TIME()` / `LTIME()` — the clock; `null` for any other call. A CODESYS operator, not a library element: `cs_clock_reads`
 * builds with no library at all, and the Standard library's timers are written over it (`libraries/Standard`). What time
 * it is belongs to whoever runs the program, so it is a global the harness sets before a scan — `__clock`, an LTIME
 * counting nanoseconds — and never a wall clock, so a run is reproducible. TIME() is the same instant in milliseconds.
 */
export function lowerClock(lw: Lowering, e: Extract<Expr, { kind: "call" }>, name: string): IrExpr | null {
  if ((name !== "TIME" && name !== "LTIME") || e.args.length !== 0) return null
  const clock = elementaryRef("LTIME")
  if (!lw.shared.globals.byName.has(CLOCK_KEY)) {
    lw.shared.globals.byName.set(CLOCK_KEY, lw.shared.globals.slots.length)
    lw.shared.globals.slots.push({ name: CLOCK, type: clock, section: "VAR", init: 0n })
  }
  const now: IrExpr = { kind: "load", place: { slot: lw.shared.globals.byName.get(CLOCK_KEY)!, path: [], type: clock, span: e.span, root: "global" }, type: clock, span: e.span }
  if (name === "LTIME") return now
  const ns = elementaryRef("ULINT")
  const ms: IrExpr = { kind: "binary", op: "div", left: convert(now, ns), right: { kind: "const", value: 1_000_000n, type: ns, span: e.span }, type: ns, span: e.span }
  return { kind: "convert", value: ms, type: elementaryRef("TIME"), span: e.span }
}
