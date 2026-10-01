/**
 * A CALENDAR LITERAL'S VALUE — and, where a field is out of its range, no value: CODESYS and TwinCAT refuse such a
 * literal as "Constant '…' too large for type '…'" (frontend-conformance 2.2.4, N24, `lit_date_*`, `lit_tod_*`,
 * `lit_dt_*`, 2026-10-01).
 */
import { test, expect } from "bun:test"
import { calendarNanoseconds } from "./calendar.js"

const DAY = 86_400n * 1_000_000_000n

test("a date, a time of day and a date-and-time decode to nanoseconds", () => {
  expect(calendarNanoseconds("date", "1970-01-02")).toBe(DAY)
  expect(calendarNanoseconds("tod", "12:00:00.5")).toBe(43_200_500_000_000n)
  // `lit_dt_leap_day` builds: 2024 is a leap year
  expect(calendarNanoseconds("datetime", "2024-02-29-12:00:00")).toBeDefined()
  // `lit_ldt_nanoseconds`: nine fractional digits are all kept
  expect(calendarNanoseconds("datetime", "2024-01-01-00:00:00.123456789")! % 1_000_000_000n).toBe(123_456_789n)
})

test("a field out of its range is no value — month, day of the month, hour, minute, second, a date before 1970 (N24)", () => {
  expect(calendarNanoseconds("date", "2024-13-01")).toBeUndefined() // `lit_date_month_13`
  expect(calendarNanoseconds("date", "2024-01-32")).toBeUndefined() // `lit_date_day_32`
  expect(calendarNanoseconds("date", "2023-02-30")).toBeUndefined() // `lit_date_feb_30`
  expect(calendarNanoseconds("date", "1969-12-31")).toBeUndefined() // `lit_date_before_epoch`
  expect(calendarNanoseconds("tod", "25:00:00")).toBeUndefined() // `lit_tod_hour_25`
  expect(calendarNanoseconds("tod", "12:60:00")).toBeUndefined() // `lit_tod_minute_60`
  expect(calendarNanoseconds("tod", "12:00:60")).toBeUndefined() // `lit_tod_second_60`
  expect(calendarNanoseconds("datetime", "2023-02-29-12:00:00")).toBeUndefined() // `lit_dt_leap_day_non_leap`
})
