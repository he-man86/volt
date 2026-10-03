/**
 * DATE AND TIME ARITHMETIC — which date/duration pairs an operator takes, and the type it yields. The same in the
 * run-time and the checked view.
 */
import { aliasElem, elementaryType } from "../elementary.js"
import { isDatetime, isDuration } from "../predicates.js"

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
