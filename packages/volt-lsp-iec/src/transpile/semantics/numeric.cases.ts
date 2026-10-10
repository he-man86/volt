/**
 * THE REAL → INTEGER TABLE (design.md P3; `cases.ts`): every cell CODESYS recorded for `conversions/real-to-integer.ts`
 * (both real types × every integer and bit-string destination × five out-of-range value classes) and
 * `conversions/real-to-integer-ladder.ts` (INT, DINT and LINT on a magnitude ladder, both signs) — 192 cells, each
 * naming its fixture and the recorded variable `inst.out`. `input.value` is the number the fixture's `v` holds (a REAL's
 * computed in single precision); `expected` is the recorded `out`, the conversion as its destination stores it.
 * `convert.test.ts` runs them through `coerce` (then `fit`); the twin harness (`test/conformance/runtime-twins.test.ts`) runs
 * them against the Rust runtime and holds every cell (and its input) to `codesys.run.json`. Data only: written once from
 * the fixtures and their recordings.
 */
import type { Case } from "./cases.js"

/** A REAL or LREAL value converted to an integer destination. */
export interface RealToIntInput {
  readonly from: "REAL" | "LREAL"
  readonly to: string
  readonly value: number
}

const r2i = (fixture: string, from: "REAL" | "LREAL", to: string, value: number, expected: bigint): Case<RealToIntInput, bigint> => ({
  name: fixture,
  input: { from, to, value },
  expected,
  recording: { fixture, variable: "inst.out", input: "inst.v" },
})

/** The 192 recorded REAL → integer cells. */
export const REAL_TO_INT_CASES: readonly Case<RealToIntInput, bigint>[] = [
  r2i("r2i_real_to_byte_above_max", "REAL", "BYTE", 1020, 252n),
  r2i("r2i_real_to_byte_below_min", "REAL", "BYTE", -1020, 4n),
  r2i("r2i_real_to_byte_nan", "REAL", "BYTE", NaN, 0n),
  r2i("r2i_real_to_byte_pos_inf", "REAL", "BYTE", Infinity, 0n),
  r2i("r2i_real_to_byte_neg_inf", "REAL", "BYTE", -Infinity, 0n),
  r2i("r2i_real_to_word_above_max", "REAL", "WORD", 262140, 65532n),
  r2i("r2i_real_to_word_below_min", "REAL", "WORD", -262140, 4n),
  r2i("r2i_real_to_word_nan", "REAL", "WORD", NaN, 0n),
  r2i("r2i_real_to_word_pos_inf", "REAL", "WORD", Infinity, 0n),
  r2i("r2i_real_to_word_neg_inf", "REAL", "WORD", -Infinity, 0n),
  r2i("r2i_real_to_dword_above_max", "REAL", "DWORD", 17179869184, 0n),
  r2i("r2i_real_to_dword_below_min", "REAL", "DWORD", -17179869184, 2147483648n),
  r2i("r2i_real_to_dword_nan", "REAL", "DWORD", NaN, 0n),
  r2i("r2i_real_to_dword_pos_inf", "REAL", "DWORD", Infinity, 0n),
  r2i("r2i_real_to_dword_neg_inf", "REAL", "DWORD", -Infinity, 2147483648n),
  r2i("r2i_real_to_lword_above_max", "REAL", "LWORD", 73786976294838210000, 9223372036854775808n),
  r2i("r2i_real_to_lword_below_min", "REAL", "LWORD", -73786976294838210000, 9223372036854775808n),
  r2i("r2i_real_to_lword_nan", "REAL", "LWORD", NaN, 9223372036854775808n),
  r2i("r2i_real_to_lword_pos_inf", "REAL", "LWORD", Infinity, 9223372036854775808n),
  r2i("r2i_real_to_lword_neg_inf", "REAL", "LWORD", -Infinity, 9223372036854775808n),
  r2i("r2i_real_to_sint_above_max", "REAL", "SINT", 508, -4n),
  r2i("r2i_real_to_sint_below_min", "REAL", "SINT", -508, 4n),
  r2i("r2i_real_to_sint_nan", "REAL", "SINT", NaN, 0n),
  r2i("r2i_real_to_sint_pos_inf", "REAL", "SINT", Infinity, 0n),
  r2i("r2i_real_to_sint_neg_inf", "REAL", "SINT", -Infinity, 0n),
  r2i("r2i_real_to_int_above_max", "REAL", "INT", 131068, -4n),
  r2i("r2i_real_to_int_below_min", "REAL", "INT", -131068, 4n),
  r2i("r2i_real_to_int_nan", "REAL", "INT", NaN, 0n),
  r2i("r2i_real_to_int_pos_inf", "REAL", "INT", Infinity, 0n),
  r2i("r2i_real_to_int_neg_inf", "REAL", "INT", -Infinity, 0n),
  r2i("r2i_real_to_dint_above_max", "REAL", "DINT", 8589934592, 0n),
  r2i("r2i_real_to_dint_below_min", "REAL", "DINT", -8589934592, -2147483648n),
  r2i("r2i_real_to_dint_nan", "REAL", "DINT", NaN, 0n),
  r2i("r2i_real_to_dint_pos_inf", "REAL", "DINT", Infinity, 0n),
  r2i("r2i_real_to_dint_neg_inf", "REAL", "DINT", -Infinity, -2147483648n),
  r2i("r2i_real_to_lint_above_max", "REAL", "LINT", 36893488147419103000, -9223372036854775808n),
  r2i("r2i_real_to_lint_below_min", "REAL", "LINT", -36893488147419103000, -9223372036854775808n),
  r2i("r2i_real_to_lint_nan", "REAL", "LINT", NaN, -9223372036854775808n),
  r2i("r2i_real_to_lint_pos_inf", "REAL", "LINT", Infinity, -9223372036854775808n),
  r2i("r2i_real_to_lint_neg_inf", "REAL", "LINT", -Infinity, -9223372036854775808n),
  r2i("r2i_real_to_usint_above_max", "REAL", "USINT", 1020, 252n),
  r2i("r2i_real_to_usint_below_min", "REAL", "USINT", -1020, 4n),
  r2i("r2i_real_to_usint_nan", "REAL", "USINT", NaN, 0n),
  r2i("r2i_real_to_usint_pos_inf", "REAL", "USINT", Infinity, 0n),
  r2i("r2i_real_to_usint_neg_inf", "REAL", "USINT", -Infinity, 0n),
  r2i("r2i_real_to_uint_above_max", "REAL", "UINT", 262140, 65532n),
  r2i("r2i_real_to_uint_below_min", "REAL", "UINT", -262140, 4n),
  r2i("r2i_real_to_uint_nan", "REAL", "UINT", NaN, 0n),
  r2i("r2i_real_to_uint_pos_inf", "REAL", "UINT", Infinity, 0n),
  r2i("r2i_real_to_uint_neg_inf", "REAL", "UINT", -Infinity, 0n),
  r2i("r2i_real_to_udint_above_max", "REAL", "UDINT", 17179869184, 0n),
  r2i("r2i_real_to_udint_below_min", "REAL", "UDINT", -17179869184, 2147483648n),
  r2i("r2i_real_to_udint_nan", "REAL", "UDINT", NaN, 0n),
  r2i("r2i_real_to_udint_pos_inf", "REAL", "UDINT", Infinity, 0n),
  r2i("r2i_real_to_udint_neg_inf", "REAL", "UDINT", -Infinity, 2147483648n),
  r2i("r2i_real_to_ulint_above_max", "REAL", "ULINT", 73786976294838210000, 9223372036854775808n),
  r2i("r2i_real_to_ulint_below_min", "REAL", "ULINT", -73786976294838210000, 9223372036854775808n),
  r2i("r2i_real_to_ulint_nan", "REAL", "ULINT", NaN, 9223372036854775808n),
  r2i("r2i_real_to_ulint_pos_inf", "REAL", "ULINT", Infinity, 9223372036854775808n),
  r2i("r2i_real_to_ulint_neg_inf", "REAL", "ULINT", -Infinity, 9223372036854775808n),
  r2i("r2i_lreal_to_byte_above_max", "LREAL", "BYTE", 1020, 252n),
  r2i("r2i_lreal_to_byte_below_min", "LREAL", "BYTE", -1020, 4n),
  r2i("r2i_lreal_to_byte_nan", "LREAL", "BYTE", NaN, 0n),
  r2i("r2i_lreal_to_byte_pos_inf", "LREAL", "BYTE", Infinity, 0n),
  r2i("r2i_lreal_to_byte_neg_inf", "LREAL", "BYTE", -Infinity, 0n),
  r2i("r2i_lreal_to_word_above_max", "LREAL", "WORD", 262140, 65532n),
  r2i("r2i_lreal_to_word_below_min", "LREAL", "WORD", -262140, 4n),
  r2i("r2i_lreal_to_word_nan", "LREAL", "WORD", NaN, 0n),
  r2i("r2i_lreal_to_word_pos_inf", "LREAL", "WORD", Infinity, 0n),
  r2i("r2i_lreal_to_word_neg_inf", "LREAL", "WORD", -Infinity, 0n),
  r2i("r2i_lreal_to_dword_above_max", "LREAL", "DWORD", 17179870000, 816n),
  r2i("r2i_lreal_to_dword_below_min", "LREAL", "DWORD", -17179870000, 2147483648n),
  r2i("r2i_lreal_to_dword_nan", "LREAL", "DWORD", NaN, 0n),
  r2i("r2i_lreal_to_dword_pos_inf", "LREAL", "DWORD", Infinity, 0n),
  r2i("r2i_lreal_to_dword_neg_inf", "LREAL", "DWORD", -Infinity, 2147483648n),
  r2i("r2i_lreal_to_lword_above_max", "LREAL", "LWORD", 73786980000000000000, 9223372036854775808n),
  r2i("r2i_lreal_to_lword_below_min", "LREAL", "LWORD", -73786980000000000000, 9223372036854775808n),
  r2i("r2i_lreal_to_lword_nan", "LREAL", "LWORD", NaN, 9223372036854775808n),
  r2i("r2i_lreal_to_lword_pos_inf", "LREAL", "LWORD", Infinity, 9223372036854775808n),
  r2i("r2i_lreal_to_lword_neg_inf", "LREAL", "LWORD", -Infinity, 9223372036854775808n),
  r2i("r2i_lreal_to_sint_above_max", "LREAL", "SINT", 508, -4n),
  r2i("r2i_lreal_to_sint_below_min", "LREAL", "SINT", -508, 4n),
  r2i("r2i_lreal_to_sint_nan", "LREAL", "SINT", NaN, 0n),
  r2i("r2i_lreal_to_sint_pos_inf", "LREAL", "SINT", Infinity, 0n),
  r2i("r2i_lreal_to_sint_neg_inf", "LREAL", "SINT", -Infinity, 0n),
  r2i("r2i_lreal_to_int_above_max", "LREAL", "INT", 131068, -4n),
  r2i("r2i_lreal_to_int_below_min", "LREAL", "INT", -131068, 4n),
  r2i("r2i_lreal_to_int_nan", "LREAL", "INT", NaN, 0n),
  r2i("r2i_lreal_to_int_pos_inf", "LREAL", "INT", Infinity, 0n),
  r2i("r2i_lreal_to_int_neg_inf", "LREAL", "INT", -Infinity, 0n),
  r2i("r2i_lreal_to_dint_above_max", "LREAL", "DINT", 8589935000, 408n),
  r2i("r2i_lreal_to_dint_below_min", "LREAL", "DINT", -8589935000, -2147483648n),
  r2i("r2i_lreal_to_dint_nan", "LREAL", "DINT", NaN, 0n),
  r2i("r2i_lreal_to_dint_pos_inf", "LREAL", "DINT", Infinity, 0n),
  r2i("r2i_lreal_to_dint_neg_inf", "LREAL", "DINT", -Infinity, -2147483648n),
  r2i("r2i_lreal_to_lint_above_max", "LREAL", "LINT", 36893490000000000000, -9223372036854775808n),
  r2i("r2i_lreal_to_lint_below_min", "LREAL", "LINT", -36893490000000000000, -9223372036854775808n),
  r2i("r2i_lreal_to_lint_nan", "LREAL", "LINT", NaN, -9223372036854775808n),
  r2i("r2i_lreal_to_lint_pos_inf", "LREAL", "LINT", Infinity, -9223372036854775808n),
  r2i("r2i_lreal_to_lint_neg_inf", "LREAL", "LINT", -Infinity, -9223372036854775808n),
  r2i("r2i_lreal_to_usint_above_max", "LREAL", "USINT", 1020, 252n),
  r2i("r2i_lreal_to_usint_below_min", "LREAL", "USINT", -1020, 4n),
  r2i("r2i_lreal_to_usint_nan", "LREAL", "USINT", NaN, 0n),
  r2i("r2i_lreal_to_usint_pos_inf", "LREAL", "USINT", Infinity, 0n),
  r2i("r2i_lreal_to_usint_neg_inf", "LREAL", "USINT", -Infinity, 0n),
  r2i("r2i_lreal_to_uint_above_max", "LREAL", "UINT", 262140, 65532n),
  r2i("r2i_lreal_to_uint_below_min", "LREAL", "UINT", -262140, 4n),
  r2i("r2i_lreal_to_uint_nan", "LREAL", "UINT", NaN, 0n),
  r2i("r2i_lreal_to_uint_pos_inf", "LREAL", "UINT", Infinity, 0n),
  r2i("r2i_lreal_to_uint_neg_inf", "LREAL", "UINT", -Infinity, 0n),
  r2i("r2i_lreal_to_udint_above_max", "LREAL", "UDINT", 17179870000, 816n),
  r2i("r2i_lreal_to_udint_below_min", "LREAL", "UDINT", -17179870000, 2147483648n),
  r2i("r2i_lreal_to_udint_nan", "LREAL", "UDINT", NaN, 0n),
  r2i("r2i_lreal_to_udint_pos_inf", "LREAL", "UDINT", Infinity, 0n),
  r2i("r2i_lreal_to_udint_neg_inf", "LREAL", "UDINT", -Infinity, 2147483648n),
  r2i("r2i_lreal_to_ulint_above_max", "LREAL", "ULINT", 73786980000000000000, 9223372036854775808n),
  r2i("r2i_lreal_to_ulint_below_min", "LREAL", "ULINT", -73786980000000000000, 9223372036854775808n),
  r2i("r2i_lreal_to_ulint_nan", "LREAL", "ULINT", NaN, 9223372036854775808n),
  r2i("r2i_lreal_to_ulint_pos_inf", "LREAL", "ULINT", Infinity, 9223372036854775808n),
  r2i("r2i_lreal_to_ulint_neg_inf", "LREAL", "ULINT", -Infinity, 9223372036854775808n),
  r2i("r2ilad_int_pos_00", "LREAL", "INT", 100, 100n),
  r2i("r2ilad_int_neg_00", "LREAL", "INT", -100, -100n),
  r2i("r2ilad_int_pos_01", "LREAL", "INT", 32767, 32767n),
  r2i("r2ilad_int_neg_01", "LREAL", "INT", -32767, -32767n),
  r2i("r2ilad_int_pos_02", "LREAL", "INT", 32768, -32768n),
  r2i("r2ilad_int_neg_02", "LREAL", "INT", -32768, -32768n),
  r2i("r2ilad_int_pos_03", "LREAL", "INT", 65536, 0n),
  r2i("r2ilad_int_neg_03", "LREAL", "INT", -65536, 0n),
  r2i("r2ilad_int_pos_04", "LREAL", "INT", 2147483647, -1n),
  r2i("r2ilad_int_neg_04", "LREAL", "INT", -2147483647, 1n),
  r2i("r2ilad_int_pos_05", "LREAL", "INT", 2147483648, 0n),
  r2i("r2ilad_int_neg_05", "LREAL", "INT", -2147483648, 0n),
  r2i("r2ilad_int_pos_06", "LREAL", "INT", 3000000000, 24064n),
  r2i("r2ilad_int_neg_06", "LREAL", "INT", -3000000000, 0n),
  r2i("r2ilad_int_pos_07", "LREAL", "INT", 4294967296, 0n),
  r2i("r2ilad_int_neg_07", "LREAL", "INT", -4294967296, 0n),
  r2i("r2ilad_int_pos_08", "LREAL", "INT", 8589935000, 408n),
  r2i("r2ilad_int_neg_08", "LREAL", "INT", -8589935000, 0n),
  r2i("r2ilad_int_pos_09", "LREAL", "INT", 9223372036854775000, -1024n),
  r2i("r2ilad_int_neg_09", "LREAL", "INT", -9223372036854775000, 0n),
  r2i("r2ilad_int_pos_10", "LREAL", "INT", 10000000000000000000, 0n),
  r2i("r2ilad_int_neg_10", "LREAL", "INT", -10000000000000000000, 0n),
  r2i("r2ilad_int_pos_11", "LREAL", "INT", 1e+30, 0n),
  r2i("r2ilad_int_neg_11", "LREAL", "INT", -1e+30, 0n),
  r2i("r2ilad_dint_pos_00", "LREAL", "DINT", 100, 100n),
  r2i("r2ilad_dint_neg_00", "LREAL", "DINT", -100, -100n),
  r2i("r2ilad_dint_pos_01", "LREAL", "DINT", 32767, 32767n),
  r2i("r2ilad_dint_neg_01", "LREAL", "DINT", -32767, -32767n),
  r2i("r2ilad_dint_pos_02", "LREAL", "DINT", 32768, 32768n),
  r2i("r2ilad_dint_neg_02", "LREAL", "DINT", -32768, -32768n),
  r2i("r2ilad_dint_pos_03", "LREAL", "DINT", 65536, 65536n),
  r2i("r2ilad_dint_neg_03", "LREAL", "DINT", -65536, -65536n),
  r2i("r2ilad_dint_pos_04", "LREAL", "DINT", 2147483647, 2147483647n),
  r2i("r2ilad_dint_neg_04", "LREAL", "DINT", -2147483647, -2147483647n),
  r2i("r2ilad_dint_pos_05", "LREAL", "DINT", 2147483648, -2147483648n),
  r2i("r2ilad_dint_neg_05", "LREAL", "DINT", -2147483648, -2147483648n),
  r2i("r2ilad_dint_pos_06", "LREAL", "DINT", 3000000000, -1294967296n),
  r2i("r2ilad_dint_neg_06", "LREAL", "DINT", -3000000000, -2147483648n),
  r2i("r2ilad_dint_pos_07", "LREAL", "DINT", 4294967296, 0n),
  r2i("r2ilad_dint_neg_07", "LREAL", "DINT", -4294967296, -2147483648n),
  r2i("r2ilad_dint_pos_08", "LREAL", "DINT", 8589935000, 408n),
  r2i("r2ilad_dint_neg_08", "LREAL", "DINT", -8589935000, -2147483648n),
  r2i("r2ilad_dint_pos_09", "LREAL", "DINT", 9223372036854775000, -1024n),
  r2i("r2ilad_dint_neg_09", "LREAL", "DINT", -9223372036854775000, -2147483648n),
  r2i("r2ilad_dint_pos_10", "LREAL", "DINT", 10000000000000000000, 0n),
  r2i("r2ilad_dint_neg_10", "LREAL", "DINT", -10000000000000000000, -2147483648n),
  r2i("r2ilad_dint_pos_11", "LREAL", "DINT", 1e+30, 0n),
  r2i("r2ilad_dint_neg_11", "LREAL", "DINT", -1e+30, -2147483648n),
  r2i("r2ilad_lint_pos_00", "LREAL", "LINT", 100, 100n),
  r2i("r2ilad_lint_neg_00", "LREAL", "LINT", -100, -100n),
  r2i("r2ilad_lint_pos_01", "LREAL", "LINT", 32767, 32767n),
  r2i("r2ilad_lint_neg_01", "LREAL", "LINT", -32767, -32767n),
  r2i("r2ilad_lint_pos_02", "LREAL", "LINT", 32768, 32768n),
  r2i("r2ilad_lint_neg_02", "LREAL", "LINT", -32768, -32768n),
  r2i("r2ilad_lint_pos_03", "LREAL", "LINT", 65536, 65536n),
  r2i("r2ilad_lint_neg_03", "LREAL", "LINT", -65536, -65536n),
  r2i("r2ilad_lint_pos_04", "LREAL", "LINT", 2147483647, 2147483647n),
  r2i("r2ilad_lint_neg_04", "LREAL", "LINT", -2147483647, -2147483647n),
  r2i("r2ilad_lint_pos_05", "LREAL", "LINT", 2147483648, 2147483648n),
  r2i("r2ilad_lint_neg_05", "LREAL", "LINT", -2147483648, -2147483648n),
  r2i("r2ilad_lint_pos_06", "LREAL", "LINT", 3000000000, 3000000000n),
  r2i("r2ilad_lint_neg_06", "LREAL", "LINT", -3000000000, -3000000000n),
  r2i("r2ilad_lint_pos_07", "LREAL", "LINT", 4294967296, 4294967296n),
  r2i("r2ilad_lint_neg_07", "LREAL", "LINT", -4294967296, -4294967296n),
  r2i("r2ilad_lint_pos_08", "LREAL", "LINT", 8589935000, 8589935000n),
  r2i("r2ilad_lint_neg_08", "LREAL", "LINT", -8589935000, -8589935000n),
  r2i("r2ilad_lint_pos_09", "LREAL", "LINT", 9223372036854775000, 9223372036854774784n),
  r2i("r2ilad_lint_neg_09", "LREAL", "LINT", -9223372036854775000, -9223372036854774784n),
  r2i("r2ilad_lint_pos_10", "LREAL", "LINT", 10000000000000000000, -8446744073709551616n),
  r2i("r2ilad_lint_neg_10", "LREAL", "LINT", -10000000000000000000, -9223372036854775808n),
  r2i("r2ilad_lint_pos_11", "LREAL", "LINT", 1e+30, -9223372036854775808n),
  r2i("r2ilad_lint_neg_11", "LREAL", "LINT", -1e+30, -9223372036854775808n),
]

/** MAX, MIN or LIMIT (`mn, in, mx`) over REAL or LREAL arguments, NaN and the two zeros among them. */
export interface SelectInput {
  readonly fn: "max" | "min" | "limit"
  readonly type: "REAL" | "LREAL"
  readonly args: readonly number[]
}

/**
 * THE COMPARE-SELECT TABLE (transpile-restructure 6.7, RC 28): MAX(a, b) is `IF a > b THEN a ELSE b`, MIN(a, b)
 * `IF a < b THEN a ELSE b` — the SECOND argument on a tie or a NaN — and LIMIT(mn, in, mx) is MIN(MAX(mn, in), mx). Every
 * cell `tr_28_minmax_limit_nan_signed_zero_{real,lreal}` recorded, as the BITS of the result (`w1`…`w9`, read through a
 * pointer: NaN and -0 do not compare), each naming the recorded bits of the NaN or -0 it ran on (`wn`, `wnz`). The NaN is
 * CODESYS's SQRT(-1), sign bit set — which the Rust keeps and a JavaScript number cannot (`semantics/builtins.test.ts`
 * compares the value, the twin the bits; tasks 4.12 and 6.7: niche: accepted loss).
 */
export const SELECT_CASES: readonly Case<SelectInput, bigint>[] = (["REAL", "LREAL"] as const).flatMap((type) => {
  const fixture = `tr_28_minmax_limit_nan_signed_zero_${type.toLowerCase()}`
  const bits = type === "REAL"
    ? { one: 1065353216n, nan: 4290772992n, five: 1084227584n, zero: 0n, minusZero: 2147483648n }
    : { one: 4607182418800017408n, nan: 18444492273895866368n, five: 4617315517961601024n, zero: 0n, minusZero: 9223372036854775808n }
  const cell = (w: number, fn: SelectInput["fn"], args: number[], expected: bigint): Case<SelectInput, bigint> => ({
    name: `${fixture} w${w}`,
    input: { fn, type, args },
    expected,
    recording: { fixture, variable: `w${w}`, input: args.some((a) => Number.isNaN(a)) ? "wn" : "wnz" },
  })
  return [
    cell(1, "max", [NaN, 1], bits.one),
    cell(2, "max", [1, NaN], bits.nan),
    cell(3, "min", [NaN, 1], bits.one),
    cell(4, "min", [1, NaN], bits.nan),
    cell(5, "limit", [0, NaN, 5], bits.five),
    cell(6, "limit", [NaN, 1, 5], bits.one),
    cell(7, "limit", [0, 1, NaN], bits.nan),
    cell(8, "max", [-0, 0], bits.zero),
    cell(9, "max", [0, -0], bits.minusZero),
  ]
})

/** EXPT's base and exponent, in REAL or LREAL. */
export interface ExptInput {
  readonly type: "REAL" | "LREAL"
  readonly x: number
  readonly y: number
}

const expt = (fixture: string, type: ExptInput["type"], x: number, y: number, expected: number | "stop"): Case<ExptInput, number | "stop"> => ({
  name: fixture,
  input: { type, x, y },
  expected,
  recording: { fixture, variable: "res", input: "e" },
})

/**
 * THE EXPT TABLE (transpile-restructure 6.18, RC 46): C's `pow`, correctly rounded, at every domain edge CODESYS recorded
 * (`tr_46_exptdom_*`): 1 to a NaN, -1 to ±inf and a NaN to 0 are 1; 0 to -inf is +inf; an exact huge power (1E19 ** 8 is
 * 1E+152, where repeated multiplication is ULPs out — the exact integer-exponent path `semantics/math.ts` `integerPower`
 * answers it); 0 to a finite negative STOPS the task (`stop`: the recording's "The operation has timed out.", as LN(0)).
 * `math.test.ts` runs them against `expt`; the twin harness against the Rust runtime's `iec_pow`.
 */
export const EXPT_CASES: readonly Case<ExptInput, number | "stop">[] = [
  expt("tr_46_exptdom_one_pow_nan", "LREAL", 1, NaN, 1),
  expt("tr_46_exptdom_real_one_pow_nan", "REAL", 1, NaN, 1),
  expt("tr_46_exptdom_minus_one_pow_inf", "LREAL", -1, Infinity, 1),
  expt("tr_46_exptdom_minus_one_pow_minus_inf", "LREAL", -1, -Infinity, 1),
  expt("tr_46_exptdom_nan_pow_zero", "LREAL", NaN, 0, 1),
  expt("tr_46_exptdom_zero_pow_minus_inf", "LREAL", 0, -Infinity, Infinity),
  expt("tr_46_exptdom_1e19_pow_8", "LREAL", 1e19, 8, 1e152),
  expt("tr_46_exptdom_zero_pow_minus_one", "LREAL", 0, -1, "stop"),
  expt("tr_46_exptdom_zero_pow_minus_half", "LREAL", 0, -0.5, "stop"),
]

/** A 64-bit integer converted to REAL. */
interface IntToRealInput {
  readonly from: "LINT" | "ULINT" | "LWORD"
  readonly value: bigint
}

const i2r = (variable: string, input: string, from: IntToRealInput["from"], value: bigint, expected: number): Case<IntToRealInput, number> => ({
  name: `tr_47 ${from} ${value}`,
  input: { from, value },
  expected,
  recording: { fixture: "tr_47_i2r_lint_to_real_double_round", variable, input },
})

/**
 * THE 64-BIT INTEGER → REAL CELLS (transpile-restructure 6.19, RC 47): rounded ONCE, straight to 24 bits. 2^60 + 2^36 + 1
 * sits where rounding through LREAL first lands exactly on REAL's halfway point and ties down; CODESYS says 2^60 + 2^37
 * (`tr_47_i2r_lint_to_real_double_round`). `convert.test.ts` runs them through `coerce`; the twin through Rust's `as f32`.
 */
export const INT_TO_REAL_CASES: readonly Case<IntToRealInput, number>[] = [
  i2r("out", "v", "LINT", 1152921573326323713n, 1152921642045800448),
  i2r("outNeg", "vn", "LINT", -1152921573326323713n, -1152921642045800448),
  i2r("outU", "vu", "ULINT", 1152921573326323713n, 1152921642045800448),
  i2r("outW", "vw", "LWORD", 1152921573326323713n, 1152921642045800448),
]

/** TRUNC's argument, as the REAL or LREAL its fixture holds it. */
interface TruncInput {
  readonly from: "REAL" | "LREAL"
  readonly value: number
}

const trunc = (fixture: string, variable: string, input: string, from: TruncInput["from"], value: number, expected: bigint): Case<TruncInput, bigint> => ({
  name: `${fixture} ${variable}`,
  input: { from, value: from === "REAL" ? Math.fround(value) : value },
  expected,
  recording: { fixture, variable, input },
})

/**
 * THE TRUNC TABLE (transpile-restructure 7.9.2): toward zero into a DINT whose out-of-range answer is DINT's minimum —
 * TRUNC(3.0E9) is -2147483648, not a wrap and not a saturation (`trunc_out_of_range`, `trunc_beyond_dint`) — every TRUNC
 * into a DINT the fixtures recorded. `semantics/builtins.test.ts` runs them through `builtinValue("trunc")`; the twin
 * harness through the runtime's `iec_trunc_i32`.
 */
export const TRUNC_CASES: readonly Case<TruncInput, bigint>[] = [
  trunc("trunc_functions", "t27", "p27", "REAL", 2.7, 2n),
  trunc("trunc_functions", "tn27", "n27", "REAL", -2.7, -2n),
  trunc("trunc_out_of_range", "toDint", "giant", "LREAL", 3e9, -2147483648n),
  trunc("trunc_beyond_dint", "toDint", "negGiant", "LREAL", -3e9, -2147483648n),
  trunc("conversion_trunc_real_to_dint", "fb_tr.diTruncated", "fb_tr.rValue", "REAL", 7.9, 7n),
]

/** SQRT of a REAL — computed in f32 by both backends (transpile-restructure 7.3.6). */
interface SqrtInput {
  readonly value: number
}

const sqrtCell = (fixture: string, variable: string, input: string, value: number, expected: number): Case<SqrtInput, number> => ({
  name: `${fixture} ${variable}`,
  input: { value },
  expected,
  recording: { fixture, variable, input },
})

/**
 * THE REAL SQRT CELLS: SQRT(REAL 2.0) into a REAL and into an LREAL (`sqrt_precision`: float32's 1.4142135381698608 —
 * the REAL computes in REAL) and SQRT(REAL -1.0) (`domain_sqrt_negative`: NaN, the task carries on). The emitter prints a
 * REAL SQRT as `f32::sqrt`, which equals the f64 round trip on every one of the 2^32 REAL inputs (7.3.6: IEEE sqrt rounds
 * correctly and 53 >= 2·24 + 2, so the double rounding is innocuous; measured exhaustively 2026-10-10, 0 differences).
 */
export const SQRT_CASES: readonly Case<SqrtInput, number>[] = [
  sqrtCell("sqrt_precision", "ofRealIntoReal", "r2", 2, Math.fround(Math.SQRT2)),
  sqrtCell("sqrt_precision", "ofReal", "r2", 2, Math.fround(Math.SQRT2)),
  sqrtCell("domain_sqrt_negative", "fb_domain_sqrt_negative.out", "fb_domain_sqrt_negative.x", -1, NaN),
]
