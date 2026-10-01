/**
 * A CALENDAR LITERAL'S VALUE — a DATE, DT or TOD literal's text as nanoseconds (from the transpiler's constants, where
 * it was the one reader: openspec frontend-conformance 1.22).
 */

/**
 * Nanoseconds since the epoch (DATE/DT) or since midnight (TOD) for a literal's text, or undefined when malformed — and
 * when a FIELD is out of its range: a month past 12, a day its month does not have (a leap year's 29 February is one),
 * an hour past 23, a minute or second past 59, a date before 1970. Both vendors refuse each of those as "Constant '…' too
 * large for type '…'" (frontend-conformance 2.2.4, N24: `lit_date_month_13`, `_day_32`, `_feb_30`, `_before_epoch`,
 * `lit_tod_{hour_25,minute_60,second_60}`, `lit_dt_leap_day_non_leap`; `lit_dt_leap_day` builds).
 */
export function calendarNanoseconds(kind: "date" | "datetime" | "tod", text: string): bigint | undefined {
  const clock = (h: string, m: string, s: string, frac = ""): bigint | undefined =>
    Number(h) > 23 || Number(m) > 59 || Number(s) > 59
      ? undefined
      : ((BigInt(h) * 60n + BigInt(m)) * 60n + BigInt(s)) * 1_000_000_000n + BigInt(frac.padEnd(9, "0").slice(0, 9) || "0")
  if (kind === "tod") {
    const t = /^(\d+):(\d+):(\d+)(?:\.(\d+))?$/.exec(text)
    return t === null ? undefined : clock(t[1]!, t[2]!, t[3]!, t[4])
  }
  const d = /^(\d+)-(\d+)-(\d+)(?:-(\d+):(\d+):(\d+)(?:\.(\d+))?)?$/.exec(text)
  if (d === null) return undefined
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])]
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return undefined
  // `Date.UTC` answers NaN past its own range (about year 275760), and `BigInt(NaN)` THROWS — which broke the
  // totality contract that everything downstream rests on: `D#300000-01-01` came out of `lowerSource` as a bare
  // `RangeError: Not an integer`, with no diagnostic and no position. Answering `undefined` is all that is
  // needed, because this function already returns it for a malformed literal and the caller already reports
  // that — the machinery was there, the NaN just walked past it.
  const utc = Date.UTC(year, month - 1, day)
  if (!Number.isFinite(utc)) return undefined
  const days = BigInt(utc / 86_400_000)
  const midnight = days * 86_400n * 1_000_000_000n
  if (kind === "date" || d[4] === undefined) return midnight
  const time = clock(d[4], d[5]!, d[6]!, d[7])
  return time === undefined ? undefined : midnight + time
}

/** The days of `month` (1–12) in `year` — the Gregorian leap rule. */
function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
