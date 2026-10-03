/**
 * DATE AND TIME ARITHMETIC — which date/duration pairs an operator takes, and the type it yields. The same in the
 * run-time and the checked view.
 */
import { aliasElem, elementaryType } from "../elementary.js"
import { isDatetime, isDuration } from "../predicates.js"
import type { Type } from "../type.js"
import { integerOfWidth } from "../width.js"

/** The duration a date type's difference is: LTIME for a 64-bit date type, TIME otherwise. */
function durationFor(dateName: string): string {
  return elementaryType(dateName)?.bits === 64 ? "LTIME" : "TIME"
}

/**
 * A 32-bit date (DATE, DT, TOD) beside an LTIME, either order: no temporal pair. CODESYS computes it as ULINT and
 * refuses it — "Cannot convert type 'LTIME' to type 'ULINT'" (`tr_40_*`, every form, recorded 2026-09-29).
 */
export function narrowDateWideDuration(left: string, right: string): boolean {
  const narrowDate = (n: string): boolean => isDatetime(n) && elementaryType(n)?.bits === 32
  const wideDuration = (n: string): boolean => isDuration(n) && elementaryType(n)?.bits === 64
  return (narrowDate(left) && wideDuration(right)) || (wideDuration(left) && narrowDate(right))
}

/**
 * Date/time arithmetic's result type name, or undefined when the operands are not a temporal pair: a date − the same
 * date is its duration (`durationFor`), a date ± a duration and a duration + a date are the date.
 */
export function temporalResultType(op: "+" | "-", left: string, right: string): string | undefined {
  const [l, r] = [aliasElem(left), aliasElem(right)]
  if (narrowDateWideDuration(l, r)) return undefined
  if (op === "-") {
    if (isDatetime(l) && l === r) return durationFor(l)
    if (isDatetime(l) && isDuration(r)) return l
  }
  if (op === "+") {
    if (isDatetime(l) && isDuration(r)) return l
    if (isDuration(l) && isDatetime(r)) return r
  }
  return undefined
}

/**
 * A DURATION SCALED BY AN INTEGER IS THE DURATION: `t * n` and `n * t` (TIME × INT, LTIME × LINT) and `t / n` (TIME ÷ DINT,
 * LTIME ÷ INT) are named TIME / LTIME by the compiler (`ar_time_times_int_type`, `ar_time_div_int_type`,
 * `ar_ltime_div_int_type`, `ar_ltime_times_lint_type`, both vendors 2026-10-03, rule AR18; the values are
 * `time_multiply_divide`'s) — for an integer NO WIDER than the duration, signed or not: TIME × UINT, TIME × SINT
 * (`ar_time_scaled_by_wide_or_unsigned_int_type`), and the same-width unsigned TIME × UDINT, TIME ÷ UDINT, LTIME × ULINT,
 * ULINT × LTIME (`ar_duration_scaled_by_same_width_unsigned_type`, both vendors 2026-10-03). A 64-bit integer beside a
 * TIME is the INTEGER — TIME × LINT and LINT × TIME are LINT, TIME ÷ ULINT ULINT, the TIME refused into it
 * (`durationScaleConversion`). An integer ÷ a duration, MOD, a bit string or a REAL beside a duration were not asked:
 * undefined.
 */
export function durationScaleResultType(op: string, left: string, right: string): string | undefined {
  return durationScale(op, left, right)?.result
}

/**
 * THE ONE OPERAND CONVERSION A DURATION SCALED BY AN INTEGER MAKES, or undefined when `l <op> r` is no such scaling:
 *
 *   AN INTEGER WIDER THAN THE DURATION   the duration converts into it, and is refused — "Cannot convert type 'TIME' to
 *                                        type 'LINT'" for `t * li` and `li * t`, 'TIME' to 'ULINT' for `t / ul`
 *                                        (`ar_time_scaled_by_wide_or_unsigned_int_type`, `ar_duration_scaled_stores`, both
 *                                        vendors 2026-10-03);
 *   ONE NO WIDER                         the integer converts into the SIGNED integer of the duration's width (DINT beside
 *                                        a TIME, LINT beside an LTIME): CODESYS warns "unsigned Type 'UDINT' to signed Type
 *                                        'DINT'" for a same-width unsigned one and TwinCAT is silent
 *                                        (`ar_duration_scaled_by_same_width_unsigned_type`); a narrower one widens silently.
 *
 * `side` is the operand that converts.
 */
export function durationScaleConversion(
  op: string,
  left: string,
  right: string,
): { side: "left" | "right"; from: string; to: string } | undefined {
  const s = durationScale(op, left, right)
  if (s === undefined) return undefined
  const [duration, integer] = s.durationSide === "left" ? [left, right] : [right, left]
  const integerSide = s.durationSide === "left" ? "right" : "left"
  if (s.result !== s.duration) return { side: s.durationSide, from: aliasElem(duration), to: s.result }
  return { side: integerSide, from: aliasElem(integer), to: integerOfWidth(elementaryType(s.duration)!.bits, true).name }
}

function durationScale(op: string, left: string, right: string): { result: string; duration: string; durationSide: "left" | "right" } | undefined {
  const [l, r] = [aliasElem(left), aliasElem(right)]
  const scaled = (duration: string, n: string): string | undefined => {
    const [d, e] = [elementaryType(duration), elementaryType(n)]
    if (d === undefined || e?.family !== "int") return undefined
    return e.bits <= d.bits ? duration : n
  }
  const of = (duration: string, n: string, durationSide: "left" | "right") => {
    const result = scaled(duration, n)
    return result === undefined ? undefined : { result, duration, durationSide }
  }
  if ((op === "*" || op === "/") && isDuration(l)) return of(l, r, "left")
  if (op === "*" && isDuration(r)) return of(r, l, "right")
  return undefined
}

/** Date/time arithmetic's result type name for `l <op> r` — a date difference or offset (`temporalResultType`) or a
 *  duration scaled by an integer (`durationScaleResultType`) — or undefined when the pair is no temporal arithmetic. Its
 *  operands convert into nothing. */
export function temporalArithmeticType(op: string, l: Type, r: Type): string | undefined {
  if (l.kind !== "elementary" || r.kind !== "elementary") return undefined
  return op === "+" || op === "-" ? temporalResultType(op, l.name, r.name) : durationScaleResultType(op, l.name, r.name)
}
