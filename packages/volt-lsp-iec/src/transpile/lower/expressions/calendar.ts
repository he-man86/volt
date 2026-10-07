/**
 * Date and time arithmetic, scaled between the units each type counts.
 */

import type { IrBinOp, IrExpr } from "../../ir/index.js"
import type { Span } from "../../../frontend/syntax/index.js"
import { elementaryRef, elemOf, temporalResultType, type Type } from "../../../frontend/types/index.js"
import { convert } from "../values/convert.js"

/**
 * Date/time arithmetic, scaled between the units each type counts. Measured (conformance `date_*`, `dt_*`, `tod_*`):
 *   - a date ± a duration, or a duration + a date, converts the duration into the DATE'S unit by truncating division —
 *     `DT#1970-01-01-00:00:00 + T#1500MS` is one second — and computes in the date's width: `DT max + T#1S` wraps to the
 *     epoch, `D#2024-02-28 + T#1D` is D#2024-02-29, `DT - T#1S` steps back across a leap day;
 *   - a date - a date of the same type is the difference scaled into TIME (LTIME for the L variants):
 *     `D#2024-03-01 - D#2024-02-28` is T#2D, and the reverse wraps as a UDINT (4122167296 ms);
 *   - TOD is NOT reduced modulo a day: TOD#12:30:15.5 + T#12H stores 88215500 ms (the IDE only DISPLAYS 0:30:15.500).
 * A duration finer than its date (a TIME on an LDT) was not measured: undefined, so lowering reports it.
 */
export function calendarArithmetic(op: IrBinOp, left: IrExpr, right: IrExpr, span: Span): IrExpr | undefined {
  if (op !== "add" && op !== "sub") return undefined
  const [l, r] = [elemOf(left.type), elemOf(right.type)]
  const result = l && r && temporalResultType(op === "add" ? "+" : "-", l.name, r.name)
  if (result === undefined) return undefined
  const unit = (x: IrExpr): bigint | undefined => elemOf(x.type)?.tickNs
  const scale = (x: IrExpr, by: bigint, as: Type, how: "div" | "mul"): IrExpr =>
    by === 1n ? x : { kind: "binary", op: how, left: x, right: { kind: "const", value: by, type: as, span }, type: as, span }

  const type = elementaryRef(result)
  // a date ± a duration: the result is the date's type, and the date is whichever operand has it
  if (l?.name !== r?.name) {
    const [date, duration] = l?.name === result ? [left, right] : [right, left]
    const [dateUnit, durationUnit] = [unit(date), unit(duration)]
    if (dateUnit === undefined || durationUnit === undefined || dateUnit % durationUnit !== 0n) return undefined
    const step = scale(convert(duration, date.type), dateUnit / durationUnit, date.type, "div")
    return { kind: "binary", op, left: date, right: step, type: date.type, span }
  }
  // a date − the same date: the difference, scaled into its duration's unit
  const [leftUnit, durationUnit] = [unit(left), elemOf(type)?.tickNs]
  if (leftUnit === undefined || durationUnit === undefined) return undefined
  const difference: IrExpr = { kind: "binary", op: "sub", left, right, type: left.type, span }
  return scale(convert(difference, type), leftUnit / durationUnit, type, "mul")
}
