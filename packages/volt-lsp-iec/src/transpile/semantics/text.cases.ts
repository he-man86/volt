/**
 * THE FORMATTERS' CASES (design.md P3; `cases.ts`). `LREAL_TO_STRING` — every cell but -0 measured on CODESYS SP21
 * (conformance `fmt_lreal_*`, 2026-09-19) and naming its recording, grouped by the rule each group shows. The emitter's
 * `iec_lreal_text` mirrors `lrealText` line for line; `text.test.ts` runs these against `semantics/text.ts`, and the twin
 * harness (`test/conformance/runtime-twins.test.ts`) against the Rust and — text and input — against the recordings.
 */
import type { Case } from "./cases.js"

/** A cell recorded by `conversions/to-string-format.ts`'s `fmt_lreal_<slug>`: the text in `inst.out`, the value it ran in
 *  `inst.v`. */
const lreal = (input: number, expected: string, slug: string, name = String(input)): Case<number, string> => ({
  name,
  input,
  expected,
  recording: { fixture: `fmt_lreal_${slug}`, variable: "inst.out", input: "inst.v" },
})

/** -0 has no recording: `fmt_lreal_negative_zero` computes `0.0 - seed * 0.0`, which IEEE 754 rounds to +0 (its `v` is
 *  `LREAL#0`), so no fixture ever ran a negative zero. The cell states what `lrealText` does with one, unmeasured. */
const unrecorded = (input: number, expected: string, name: string): Case<number, string> => ({ name, input, expected })

/** `lrealText` cases, keyed by the rule they show. */
export const LREAL_TEXT_CASES: Readonly<Record<string, readonly Case<number, string>[]>> = {
  "fifteen significant digits, trailing zeros stripped, never fewer than one decimal": [
    lreal(0, "0.0", "zero"),
    unrecorded(-0, "0.0", "-0"),
    lreal(1, "1.0", "whole"),
    lreal(1.5, "1.5", "one_decimal"),
    lreal(-2.25, "-2.25", "negative"),
    lreal(3.14159265, "3.14159265", "many_decimals"),
    lreal(1234.5678, "1234.5678", "four_and_four"),
    lreal(123456789, "123456789.0", "more_digits_than_a_real_holds"),
    lreal(99999990, "99999990.0", "eight_nines_ish"),
  ],
  "fixed up to 1E13 and exponential from 1E14 — the boundary, measured a magnitude at a time": [
    lreal(1e12, "1000000000000.0", "up_1e12"),
    lreal(1e13, "10000000000000.0", "up_1e13"),
    lreal(1e14, "1.0e14", "up_1e14"),
    lreal(1e20, "1.0e20", "very_large"),
    lreal(-1e20, "-1.0e20", "negative_very_large"),
  ],
  "anything below one is exponential, which is where the REAL formatter parts company": [
    lreal(0.1, "1.0e-1", "down_1e_1"),
    lreal(0.0001, "1.0e-4", "down_1e_4"),
    lreal(1e-10, "1.0e-10", "down_1e_10"),
    lreal(-1e-20, "-1.0e-20", "negative_very_small"),
    lreal(0.000123456789, "1.23456789e-4", "small_with_digits"),
    lreal(1 / 3, "3.33333333333333e-1", "third", "1/3"),
    lreal(2 / 3, "6.66666666666667e-1", "two_thirds", "2/3 (the fifteenth digit rounds up)"),
    lreal(1 / 7, "1.42857142857143e-1", "seventh", "1/7"),
  ],
  "the two non-numbers, and the sign that survives one of them": [
    lreal(NaN, "#NaN", "nan"),
    lreal(Infinity, "#Inf", "infinity"),
    lreal(-Infinity, "-#Inf", "negative_infinity"),
  ],
}

/** An LREAL tie on the 16th significant digit, as CODESYS recorded it (`tr_33_fmt_lreal_tie`, transpile-review 33): every
 *  value exact in an f64, three ties half-even would round down, one it rounds up, and non-tie controls either side. */
const tie = (i: number, input: number, expected: string): Case<number, string> => ({
  name: `tr_33 ${input}`,
  input,
  expected,
  recording: { fixture: "tr_33_fmt_lreal_tie", variable: `inst.s${i}`, input: `inst.v${i}` },
})

/** The 16th-digit ties, a group of their own (`LREAL_TEXT_CASES` holds the `fmt_lreal_*` sweep). */
export const LREAL_TIE_CASES: readonly Case<number, string>[] = [
  tie(0, 1234567890123445, "1.23456789012345e15"),
  tie(1, 1000000000000005, "1.00000000000001e15"),
  tie(2, 2500000000000005, "2.50000000000001e15"),
  tie(3, 1234567890123455, "1.23456789012346e15"),
  tie(4, 1234567890123444, "1.23456789012344e15"),
  tie(5, 1234567890123446, "1.23456789012345e15"),
  tie(6, 1000000000000006, "1.00000000000001e15"),
]

/** An LDT, LDATE or LTOD value: its nanoseconds as the u64 the IEC type holds. */
export interface LongCalendarInput {
  readonly name: "LDT" | "LDATE" | "LTOD"
  readonly ns: bigint
}

const DAY = 86_400_000_000_000n
const LEAP = 19782n * DAY + (13n * 3600n + 5n * 60n + 9n) * 1_000_000_000n
const Y2300 = 120_530n * DAY
const long = (i: number, name: LongCalendarInput["name"], ns: bigint, expected: string): Case<LongCalendarInput, string> => ({
  name: `tr_12 ${name} ${ns}`,
  input: { name, ns },
  expected,
  recording: { fixture: "tr_12_fmt_long_dates", variable: `inst.s${i}`, input: `inst.v${i}` },
})

/** LDT / LDATE / LTOD → STRING at every fraction shape and past 2262, where CODESYS reads the u64 signed (`tr_12_fmt_long_dates`,
 *  transpile-review 12). */
export const LONG_CALENDAR_TEXT_CASES: readonly Case<LongCalendarInput, string>[] = [
  long(0, "LDT", 0n, "LDT#1970-01-01-00:00:00"),
  long(1, "LDT", LEAP + 1n, "LDT#2024-02-29-13:05:09.000000001"),
  long(2, "LDT", LEAP + 500_000_000n, "LDT#2024-02-29-13:05:09.500000000"),
  long(3, "LDT", Y2300, "LDT#1715-06-13-00:25:26.290448384"),
  long(4, "LDATE", 0n, "LD#1970-01-01"),
  long(5, "LDATE", 19782n * DAY, "LD#2024-02-29"),
  long(6, "LDATE", Y2300, "LD#1715-06-14"),
  long(7, "LTOD", 0n, "LTOD#00:00:00"),
  long(8, "LTOD", DAY - 1n, "LTOD#23:59:59.999999999"),
  long(9, "LTOD", 3723n * 1_000_000_000n + 500_000_000n, "LTOD#01:02:03.500000000"),
  long(10, "LTOD", 3723n * 1_000_000_000n + 1000n, "LTOD#01:02:03.000001000"),
]
