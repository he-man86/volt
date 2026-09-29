/**
 * A 64-bit integer converts to REAL with ONE rounding, straight to 24 significant bits — the way CODESYS and Rust's
 * `as f32` do it. Rounding through LREAL first (`Number(n)`, then `Math.fround`) rounds twice, and a value just
 * above REAL's halfway point lands exactly ON it in LREAL and then ties to even — downwards.
 *
 * 2^60 + 2^36 + 1: CODESYS says 1152921642045800448 (2^60 + 2^37), recorded as
 * `tr_47_i2r_lint_to_real_double_round` (transpile-review-2026-09-29 task 47).
 */
import { expect, test } from "bun:test"
import { elementaryRef } from "../../types/index.js"
import { coerce, fit } from "./values.js"

const toReal = (v: bigint, from: string) => fit(coerce(v, elementaryRef("REAL"), elementaryRef(from)), elementaryRef("REAL"))

test("LINT/ULINT/LWORD -> REAL rounds once, to 24 bits", () => {
  const v = 2n ** 60n + 2n ** 36n + 1n
  expect(toReal(v, "LINT")).toBe(1152921642045800448)
  expect(toReal(-v, "LINT")).toBe(-1152921642045800448)
  expect(toReal(v, "ULINT")).toBe(1152921642045800448)
  expect(toReal(v, "LWORD")).toBe(1152921642045800448)
})

test("an exact tie still rounds half to even, and LREAL is untouched", () => {
  expect(toReal(2n ** 60n + 2n ** 36n, "LINT")).toBe(2 ** 60)
  expect(toReal(2n ** 60n + 3n * 2n ** 36n, "LINT")).toBe(2 ** 60 + 2 ** 38)
  expect(toReal(16777217n, "DINT")).toBe(16777216)
  expect(coerce(2n ** 60n + 2n ** 36n + 1n, elementaryRef("LREAL"), elementaryRef("LINT"))).toBe(Number(2n ** 60n + 2n ** 36n + 1n))
})

/**
 * LDT / LDATE / LTOD -> STRING (transpile-review task 12): the interpreter printed the raw nanosecond count. CODESYS's
 * recorded text (`tr_12_fmt_long_dates`): prefixes LDT#, LD#, LTOD#; a zero fraction omitted, any other nine digits;
 * the u64 read as a SIGNED i64, so 2300-01-01 wraps to 1715 — and an LDATE's day then truncates toward zero
 * (1715-06-14) where the LDT's date floors (1715-06-13, its time of day positive).
 */
test("LDT, LDATE and LTOD print CODESYS's text", () => {
  const text = (v: bigint, from: string) => coerce(v, elementaryRef("STRING"), elementaryRef(from))
  const day = 86_400_000_000_000n
  const leap = 19782n * day + (13n * 3600n + 5n * 60n + 9n) * 1_000_000_000n
  const y2300 = BigInt.asUintN(64, 120_530n * day)
  expect(text(0n, "LDT")).toBe("LDT#1970-01-01-00:00:00")
  expect(text(leap + 1n, "LDT")).toBe("LDT#2024-02-29-13:05:09.000000001")
  expect(text(leap + 500_000_000n, "LDT")).toBe("LDT#2024-02-29-13:05:09.500000000")
  expect(text(y2300, "LDT")).toBe("LDT#1715-06-13-00:25:26.290448384")
  expect(text(0n, "LDATE")).toBe("LD#1970-01-01")
  expect(text(19782n * day, "LDATE")).toBe("LD#2024-02-29")
  expect(text(y2300, "LDATE")).toBe("LD#1715-06-14")
  expect(text(0n, "LTOD")).toBe("LTOD#00:00:00")
  expect(text(day - 1n, "LTOD")).toBe("LTOD#23:59:59.999999999")
  expect(text(3723n * 1_000_000_000n + 500_000_000n, "LTOD")).toBe("LTOD#01:02:03.500000000")
  expect(text(3723n * 1_000_000_000n + 1000n, "LTOD")).toBe("LTOD#01:02:03.000001000")
})
