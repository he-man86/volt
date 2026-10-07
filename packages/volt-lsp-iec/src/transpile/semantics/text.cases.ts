/**
 * THE FORMATTERS' CASES (design.md P3; `cases.ts`). `LREAL_TO_STRING` — every cell measured on CODESYS SP21 (conformance
 * `fmt_lreal_*`, 2026-09-19), grouped by the rule each group shows. The emitter's `iec_lreal_text` mirrors `lrealText`
 * line for line; `text.test.ts` runs these against `semantics/text.ts`, and the twin harness (task 1.5.15) against the
 * Rust.
 */
import type { Case } from "./cases.js"

const lreal = (input: number, expected: string, name = String(input)): Case<number, string> => ({ name, input, expected })

/** `lrealText` cases, keyed by the rule they show. */
export const LREAL_TEXT_CASES: Readonly<Record<string, readonly Case<number, string>[]>> = {
  "fifteen significant digits, trailing zeros stripped, never fewer than one decimal": [
    lreal(0, "0.0"),
    lreal(-0, "0.0", "-0"),
    lreal(1, "1.0"),
    lreal(1.5, "1.5"),
    lreal(-2.25, "-2.25"),
    lreal(3.14159265, "3.14159265"),
    lreal(1234.5678, "1234.5678"),
    lreal(123456789, "123456789.0"),
    lreal(99999990, "99999990.0"),
  ],
  "fixed up to 1E13 and exponential from 1E14 — the boundary, measured a magnitude at a time": [
    lreal(1e12, "1000000000000.0"),
    lreal(1e13, "10000000000000.0"),
    lreal(1e14, "1.0e14"),
    lreal(1e20, "1.0e20"),
    lreal(-1e20, "-1.0e20"),
  ],
  "anything below one is exponential, which is where the REAL formatter parts company": [
    lreal(0.1, "1.0e-1"),
    lreal(0.0001, "1.0e-4"),
    lreal(1e-10, "1.0e-10"),
    lreal(-1e-20, "-1.0e-20"),
    lreal(0.000123456789, "1.23456789e-4"),
    lreal(1 / 3, "3.33333333333333e-1", "1/3"),
    lreal(2 / 3, "6.66666666666667e-1", "2/3 (the fifteenth digit rounds up)"),
    lreal(1 / 7, "1.42857142857143e-1", "1/7"),
  ],
  "the two non-numbers, and the sign that survives one of them": [
    lreal(NaN, "#NaN"),
    lreal(Infinity, "#Inf"),
    lreal(-Infinity, "-#Inf"),
  ],
}
