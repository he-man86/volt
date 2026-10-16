/** THE TEXT FORMATTERS: a calendar value, a duration and an LREAL as CODESYS's `*_TO_STRING` prints them. Mirrored by the
 *  emitter's prelude (`iec_*_text`). */
import { DURATION_UNITS_NS } from "../../frontend/syntax/index.js"

/** Days since 1970 as a civil year, month and day — Hinnant's days-from-civil inverse, mirrored by the prelude's `iec_civil`. */
function civilDate(days: bigint): [bigint, bigint, bigint] {
  const z = days + 719468n
  const era = (z >= 0n ? z : z - 146096n) / 146097n
  const doe = z - era * 146097n
  const yoe = (doe - doe / 1460n + doe / 36524n - doe / 146096n) / 365n
  const doy = doe - (365n * yoe + yoe / 4n - yoe / 100n)
  const mp = (5n * doy + 2n) / 153n
  const d = doy - (153n * mp + 2n) / 5n + 1n
  const m = mp < 10n ? mp + 3n : mp - 9n
  return [yoe + era * 400n + (m <= 2n ? 1n : 0n), m, d]
}

const pad = (n: bigint, width: number): string => n.toString().padStart(width, "0")

/** A DATE, DT (seconds) or TOD (milliseconds) as its literal text, zero-padded; a TOD's milliseconds only when non-zero
 *  (conformance `temporal_conversions`) — mirrored by the prelude's `iec_date_text` / `iec_dt_text` / `iec_tod_text`. */
export function calendarText(name: "DATE" | "DT" | "TOD", v: bigint): string {
  if (name === "TOD") {
    const s = v / 1000n
    const clock = `${pad(s / 3600n, 2)}:${pad((s / 60n) % 60n, 2)}:${pad(s % 60n, 2)}`
    return `TOD#${clock}${v % 1000n === 0n ? "" : `.${pad(v % 1000n, 3)}`}`
  }
  const days = v >= 0n ? v / 86400n : (v - 86399n) / 86400n
  const [y, m, d] = civilDate(days)
  const date = `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`
  if (name === "DATE") return `D#${date}`
  const t = v - days * 86400n
  return `DT#${date}-${pad(t / 3600n, 2)}:${pad((t / 60n) % 60n, 2)}:${pad(t % 60n, 2)}`
}

/**
 * An LDT, LDATE or LTOD (nanoseconds) as its literal text — CODESYS's recorded answer (`tr_12_fmt_long_dates`):
 *
 *   'LDT#2024-02-29-13:05:09.000000001'   'LD#2024-02-29'   'LTOD#01:02:03.500000000'   'LTOD#00:00:00'
 *
 * a zero fraction omitted, any other printed with all nine digits. The u64 is read as a SIGNED i64: 2300-01-01
 * prints 'LDT#1715-06-13-00:25:26.290448384' — the date floored, the time of day positive — but an LDATE's day
 * TRUNCATES toward zero there, 'LD#1715-06-14'. Mirrored by the prelude's `iec_ldt_text` / `iec_ldate_text` /
 * `iec_ltod_text`.
 */
export function longCalendarText(name: "LDATE" | "LDT" | "LTOD", raw: bigint): string {
  const v = BigInt.asIntN(64, raw)
  const second = 1_000_000_000n
  const day = 86_400n * second
  const clock = (ns: bigint): string => {
    const s = ns / second
    const f = ns % second
    return `${pad(s / 3600n, 2)}:${pad((s / 60n) % 60n, 2)}:${pad(s % 60n, 2)}${f === 0n ? "" : `.${pad(f, 9)}`}`
  }
  if (name === "LTOD") return `LTOD#${clock(v)}`
  const days = name === "LDATE" ? v / day : v >= 0n ? v / day : (v - day + 1n) / day
  const [y, m, d] = civilDate(days)
  const date = `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`
  return name === "LDATE" ? `LD#${date}` : `LDT#${date}-${clock(v - days * day)}`
}

/**
 * The ladder at one type's own TICK: each unit as a count of ticks, and units finer than the tick dropped — a
 * TIME counts milliseconds, so it has no `us` or `ns` component, and an LTIME counts nanoseconds and has both.
 * Both printers had this written out by hand, in two different scales.
 */
const ladder = (tickNs: bigint): [bigint, string][] =>
  DURATION_UNITS_NS.filter(([, ns]) => ns >= tickNs).map(([unit, ns]) => [ns / tickNs, unit])

/** A TIME's text — mirrored by the emitter's `iec_time_text`. */
export function timeText(ms: bigint): string {
  return durationText(ms, "T", ladder(1_000_000n))
}

/**
 * AN LTIME'S TEXT — the same shape as a TIME's with the `LTIME#` prefix and three more units below a millisecond.
 * Measured at every component boundary (`conversions/to-string-format.ts`, 2026-09-19):
 *
 *   LTIME#0NS -> 'LTIME#0ns'     LTIME#1US -> 'LTIME#1us'
 *   LTIME#1D2H3M4S5MS6US7NS -> 'LTIME#1d2h3m4s5ms6us7ns'
 *
 * so the zero case names the SMALLEST unit, exactly as a TIME's names milliseconds. Mirrored by the emitter's
 * `iec_ltime_text`.
 */
export function ltimeText(ns: bigint): string {
  return durationText(ns, "LTIME", ladder(1n))
}

/** The shared body: each non-zero component largest first, and the smallest unit's name when every one is zero. */
function durationText(total: bigint, prefix: string, units: readonly (readonly [bigint, string])[]): string {
  let rest = total
  let out = ""
  for (const [unit, suffix] of units) {
    const n = rest / unit
    rest %= unit
    if (n !== 0n) out += `${n}${suffix}`
  }
  return `${prefix}#${out || `0${units[units.length - 1]![1]}`}`
}

/**
 * `LREAL_TO_STRING` — FIFTEEN significant digits, trailing zeros stripped but never the last decimal, FIXED while
 * the value's decimal exponent is 0..13 and EXPONENTIAL otherwise, with a lowercase `e` and an exponent carrying
 * neither a sign nor padding. Every one of 26 measured cells follows it (`conversions/to-string-format.ts`,
 * 2026-09-19):
 *
 *   0 -> '0.0'      1 -> '1.0'      1.5 -> '1.5'       -2.25 -> '-2.25'    123456789 -> '123456789.0'
 *   1/3 -> '3.33333333333333e-1'    2/3 -> '6.66666666666667e-1'           0.1 -> '1.0e-1'
 *   1E13 -> '10000000000000.0'      1E14 -> '1.0e14'   1E20 -> '1.0e20'    1.23456789012345E20 kept whole
 *   a NaN -> '#NaN'                 an infinity -> '#Inf', and '-#Inf' when it is negative
 *
 * `REAL_TO_STRING` is NOT this function and is still refused — see the note at the refusal. The widths do not
 * share a formatter: a REAL writes an UPPERCASE E, pads the exponent to two digits, drops the mantissa's '.0',
 * stays in fixed notation down to 1E-4 where an LREAL leaves it at 1, and prints seven digits where two of its
 * measured cells print eight. Reusing this one for it would be a guess with 60 measurements against it.
 */
export function lrealText(v: number): string {
  if (Number.isNaN(v)) return "#NaN"
  if (!Number.isFinite(v)) return v < 0 ? "-#Inf" : "#Inf"
  if (v === 0) return "0.0"
  const sign = v < 0 ? "-" : ""
  // `toExponential(14)` rounds to 15 significant digits FIRST, so the exponent that decides the notation is the
  // one the printed digits have — 9.999999999999999 belongs with 1E1, not with the 9s it started as.
  const [mantissa, exponentText] = Math.abs(v).toExponential(14).split("e")
  const digits = mantissa!.replace(".", "")
  const exponent = Number(exponentText)
  if (exponent < 0 || exponent > 13) return `${sign}${trim(digits.slice(0, 1), digits.slice(1))}e${exponent}`
  const point = exponent + 1
  return `${sign}${trim(digits.slice(0, point).padEnd(point, "0"), digits.slice(point))}`
}

/** The whole part and the fraction, with the fraction's trailing zeros gone and at least one digit left. */
function trim(whole: string, fraction: string): string {
  const kept = fraction.replace(/0+$/, "")
  return `${whole}.${kept === "" ? "0" : kept}`
}
