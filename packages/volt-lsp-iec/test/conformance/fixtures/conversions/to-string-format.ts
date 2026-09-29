/**
 * WHAT A VALUE LOOKS LIKE AS TEXT — the exact format of `REAL_TO_STRING` and `LTIME_TO_STRING`, which are the two
 * conversions `conversions/cross-family.ts` left refused.
 *
 * Both were measured there, once each: `REAL_TO_STRING(1.5)` is '1.5' and `LTIME_TO_STRING(LTIME#1S500MS)` is
 * 'LTIME#1s500ms'. One value does not give a format. It does not say how many digits a REAL prints, what happens to
 * a whole number, where the exponent starts, or whether an LTIME prints `us` and `ns` components at all — and a
 * format guessed from one sample is a silent divergence between the interpreter and the emitted Rust, since the
 * prelude mirrors each of these line for line.
 *
 * So: every shape a number can take.
 *
 *   REAL / LREAL   zero, a whole number, one and many decimals, negative, very large, very small, and the two
 *                  non-numbers that are now known to be reachable — a NaN and an infinity
 *   LTIME          every component boundary, from nanoseconds up to days, and a zero
 *
 * The values are computed in the body wherever a literal would be folded, so the format is the RUNTIME one.
 */
import type { LanguageTest } from "../../types.js"

function probe(slug: string, decls: string, setup: string, expr: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "06-data-types.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source:
      `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\n\tout : STRING;\nEND_VAR\n${setup}\nout := ${expr};\nEND_FUNCTION_BLOCK\n`,
  }
}

/** Every shape a floating value takes, in both widths. */
const REALS: readonly [string, string][] = [
  ["0.0", "zero"],
  ["1.0", "whole"],
  ["1.5", "one_decimal"],
  ["3.14159265", "many_decimals"],
  ["-2.25", "negative"],
  ["100000.0", "large_whole"],
  ["1.0E20", "very_large"],
  ["1.0E-20", "very_small"],
  ["123456789.0", "more_digits_than_a_real_holds"],
]

const reals: LanguageTest[] = ["REAL", "LREAL"].flatMap((t) => [
  ...REALS.map(([value, slug]) =>
    probe(
      `fmt_${t.toLowerCase()}_${slug}`,
      `\tseed : ${t} := 1.0;\n\tv : ${t};`,
      `v := seed * ${value};`,
      `${t}_TO_STRING(v)`,
      `${t}_TO_STRING(${value})`,
    ),
  ),
  probe(
    `fmt_${t.toLowerCase()}_nan`,
    `\tseed : ${t} := 1.0;\n\tv : ${t};`,
    "v := SQRT(0.0 - seed);",
    `${t}_TO_STRING(v)`,
    `${t}_TO_STRING of a NaN — reachable, and nothing says how it prints`,
  ),
  probe(
    `fmt_${t.toLowerCase()}_infinity`,
    `\tbig : ${t};\n\tv : ${t};`,
    `big := ${t === "REAL" ? "3.0E38" : "1.0E308"};\nv := big * big;`,
    `${t}_TO_STRING(v)`,
    `${t}_TO_STRING of an infinity`,
  ),
  // The POSITIVE one prints '#Inf' and nothing says whether the sign survives — and a formatter that has to
  // decide is one cell away from inventing it.
  probe(
    `fmt_${t.toLowerCase()}_negative_infinity`,
    `\tbig : ${t};\n\tv : ${t};`,
    `big := ${t === "REAL" ? "3.0E38" : "1.0E308"};\nv := 0.0 - big * big;`,
    `${t}_TO_STRING(v)`,
    `${t}_TO_STRING of a NEGATIVE infinity — does the sign survive?`,
  ),
])

/** Every duration component, so the format's boundaries are visible rather than inferred from one. */
const DURATIONS: readonly [string, string][] = [
  ["LTIME#0NS", "zero"],
  ["LTIME#1NS", "one_nanosecond"],
  ["LTIME#1US", "one_microsecond"],
  ["LTIME#1MS", "one_millisecond"],
  ["LTIME#1S", "one_second"],
  ["LTIME#1M", "one_minute"],
  ["LTIME#1H", "one_hour"],
  ["LTIME#1D", "one_day"],
  ["LTIME#1D2H3M4S5MS6US7NS", "every_component"],
  ["LTIME#1S500MS", "the_one_already_measured"],
]

const ltimes: LanguageTest[] = DURATIONS.map(([value, slug]) =>
  probe(`fmt_ltime_${slug}`, "\tv : LTIME;", `v := ${value};`, "LTIME_TO_STRING(v)", `LTIME_TO_STRING(${value})`),
)

/** And the TIME formatter beside it, at the same boundaries — it is already implemented, so this is the control. */
const times: LanguageTest[] = [
  ["T#0MS", "zero"],
  ["T#1MS", "one_millisecond"],
  ["T#1S", "one_second"],
  ["T#1D2H3M4S5MS", "every_component"],
].map(([value, slug]) =>
  probe(`fmt_time_${slug}`, "\tv : TIME;", `v := ${value};`, "TIME_TO_STRING(v)", `TIME_TO_STRING(${value})`),
)


/**
 * THE SWEEP THAT MAKES THE FORMAT DERIVABLE. The nine shapes above are enough to see that the two widths use
 * DIFFERENT formatters and not enough to write either:
 *
 *   REAL   3.14159274 -> '3.141593'     seven significant digits, so not the shortest round trip (3.1415927)
 *          123456792  -> '1.2345679E08' EIGHT, and an exponent padded to two digits with no sign
 *          1.0E20     -> '1E20'         and here the mantissa keeps no '.0' at all
 *   LREAL  123456789  -> '123456789.0'  no exponent at a magnitude where the REAL has one
 *          1.0E20     -> '1.0e20'       LOWERCASE e, and the '.0' the REAL dropped
 *
 * What is missing is every BOUNDARY: where each width leaves fixed notation for exponential, at the top and at the
 * bottom; how many digits survive a value that has more; what a repeating fraction rounds to; and whether the
 * exponent is padded the same way going down as going up. Each is a cell no reading of the nine can supply, and
 * the prelude mirrors this formatter line for line — so anything invented here is a silent divergence between the
 * two backends rather than a rough edge in one.
 */
const SWEEP: readonly [string, string][] = [
  // the fixed/exponential boundary on the way UP, an order of magnitude at a time
  ["seed * 1.0E4", "up_1e4"],
  ["seed * 1.0E5", "up_1e5"],
  ["seed * 1.0E6", "up_1e6"],
  ["seed * 1.0E7", "up_1e7"],
  ["seed * 1.0E8", "up_1e8"],
  ["seed * 1.0E15", "up_1e15"],
  ["seed * 1.0E16", "up_1e16"],
  ["seed * 1.0E17", "up_1e17"],
  // and on the way DOWN
  ["seed * 0.1", "down_1e_1"],
  ["seed * 0.01", "down_1e_2"],
  ["seed * 0.001", "down_1e_3"],
  ["seed * 0.0001", "down_1e_4"],
  ["seed * 0.00001", "down_1e_5"],
  ["seed * 0.000001", "down_1e_6"],
  ["seed * 1.0E-10", "down_1e_10"],
  // values with MORE digits than the format can keep, so the rounding shows
  ["seed / 3.0", "third"],
  ["seed * 2.0 / 3.0", "two_thirds"],
  ["seed * 1234.5678", "four_and_four"],
  ["seed * 9999999.0", "seven_nines"],
  ["seed * 9999999.0 * 10.0", "eight_nines_ish"],
  ["seed * 0.000123456789", "small_with_digits"],
  // the signs, and a negative exponent's padding
  ["0.0 - seed * 0.0", "negative_zero"],
  ["0.0 - seed * 1.0E20", "negative_very_large"],
  ["0.0 - seed * 1.0E-20", "negative_very_small"],
]

const sweep: LanguageTest[] = ["REAL", "LREAL"].flatMap((t) =>
  SWEEP.map(([expr, slug]) =>
    probe(
      `fmt_${t.toLowerCase()}_${slug}`,
      `\tseed : ${t} := 1.0;\n\tv : ${t};`,
      `v := ${expr};`,
      `${t}_TO_STRING(v)`,
      `${t}_TO_STRING of ${expr.replace("seed * ", "").replace("seed / ", "1/")} — a format boundary`,
    ),
  ),
)


/**
 * ROUND TWO — the cells the first sweep showed were load-bearing and did not cover.
 *
 * The first 48 give most of both formatters. A REAL prints SEVEN significant digits, rounds half up, keeps at
 * least one decimal, and leaves fixed notation at 1E8 going up and below 1E-4 going down with an UPPERCASE E and
 * a two-digit exponent. An LREAL prints FIFTEEN, strips trailing zeros, and leaves fixed notation for ANY value
 * below one — 0.1 is '1.0e-1' — with a lowercase e and no padding.
 *
 * Three things they do not settle:
 *
 *   THE REAL'S EXPONENTIAL MANTISSA. Only one exponential cell has more than one digit, and it has EIGHT
 *   (`1.2345679E08`) where every fixed cell has seven. One of those is the rule and the other is a coincidence.
 *
 *   THE REAL'S SEVENTH DIGIT. `1/3` prints '0.3333334' where seven significant digits of 0.33333334326 rounds to
 *   '0.3333333'. Either the rounding is not what the other cells suggest or that one cell is a quirk, and one
 *   sample cannot say which.
 *
 *   THE LREAL'S UPPER BOUNDARY. 1E8 is fixed and 1E15 is exponential; the six magnitudes between are unasked.
 */
const SWEEP2: readonly [string, string, string][] = [
  // a REAL's exponential mantissa, with digits to spare
  ["REAL", "seed * 1.2345678E10", "exp_mantissa_ten"],
  ["REAL", "seed * 1.5E9", "exp_mantissa_one_half"],
  ["REAL", "seed * 3.14159265E10", "exp_mantissa_pi"],
  ["REAL", "seed * 1.23456789E-8", "exp_mantissa_small"],
  ["REAL", "seed * 9.87654321E20", "exp_mantissa_nines"],
  // a REAL's seventh digit, on four more fractions
  ["REAL", "seed / 7.0", "seventh"],
  ["REAL", "seed / 9.0", "ninth"],
  ["REAL", "seed / 11.0", "eleventh"],
  ["REAL", "seed * 0.1", "tenth"],
  ["REAL", "seed / 6.0", "sixth"],
  // an LREAL's upper boundary, one magnitude at a time
  ["LREAL", "seed * 1.0E9", "up_1e9"],
  ["LREAL", "seed * 1.0E10", "up_1e10"],
  ["LREAL", "seed * 1.0E11", "up_1e11"],
  ["LREAL", "seed * 1.0E12", "up_1e12"],
  ["LREAL", "seed * 1.0E13", "up_1e13"],
  ["LREAL", "seed * 1.0E14", "up_1e14"],
  // and the same two questions for an LREAL, so neither width is assumed to follow the other
  ["LREAL", "seed / 7.0", "seventh"],
  ["LREAL", "seed * 1.23456789012345E20", "exp_mantissa_fifteen"],
]

const sweep2: LanguageTest[] = SWEEP2.map(([t, expr, slug]) =>
  probe(
    `fmt_${t.toLowerCase()}_${slug}`,
    `	seed : ${t} := 1.0;
	v : ${t};`,
    `v := ${expr};`,
    `${t}_TO_STRING(v)`,
    `${t}_TO_STRING of ${expr} — a cell the first sweep left open`,
  ),
)

/**
 * transpile-review-2026-09-29 — one fixture per root cause, each a single FB whose variables are the cells, so one
 * recording answers the whole task. Every value is set at run time (a variable, or a `seed` product) so the format
 * recorded is the RUNTIME one, never a folded literal. The expected values are the recorder's to supply.
 */
function cells(slug: string, feature: string, decls: readonly string[], body: readonly string[], types = ""): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "06-data-types.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `${types}FUNCTION_BLOCK ${pou}\nVAR\n${decls.map((d) => `\t${d}`).join("\n")}\nEND_VAR\n${body.join("\n")}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** One `v<i> : T; s<i> : STRING;` pair per row, with `v<i> := value; s<i> := CONV(v<i>);` in the body. */
function textCells(slug: string, feature: string, rows: readonly (readonly [string, string, string])[]): LanguageTest {
  return cells(
    slug,
    feature,
    rows.flatMap(([t], i) => [`v${i} : ${t};`, `s${i} : STRING;`]),
    rows.flatMap(([, value, conv], i) => [`v${i} := ${value};`, `s${i} := ${conv}(v${i});`]),
  )
}

/**
 * Task 12: LDT / LDATE / LTOD -> STRING. The interpreter prints the raw count (`values.ts` falls through to
 * `String(v)`) and the Rust emitter calls `iec_<type>_text` helpers the prelude never defines (E0425). What the
 * review saw LIVE: prefixes LDT#/LD#/LTOD#, a zero fraction omitted, any other printed with 9 digits, and a date
 * past 2262 wrapping as signed i64 nanoseconds (2300-01-01 prints 1715-06-13).
 * The edges: the epoch, a one-nanosecond fraction, a half-second fraction (are its trailing zeros kept?), the last
 * nanosecond of a day, a microsecond fraction, midnight, a leap day, and the post-2262 wrap on both LDT and LDATE.
 */
const trLongDates = textCells(
  "tr_12_fmt_long_dates",
  "LDT_TO_STRING / LDATE_TO_STRING / LTOD_TO_STRING at every fraction shape and past 2262 (transpile-review 12)",
  [
    ["LDT", "LDT#1970-01-01-00:00:00", "LDT_TO_STRING"],
    ["LDT", "LDT#2024-02-29-13:05:09.000000001", "LDT_TO_STRING"],
    ["LDT", "LDT#2024-02-29-13:05:09.5", "LDT_TO_STRING"],
    ["LDT", "LDT#2300-01-01-00:00:00", "LDT_TO_STRING"],
    ["LDATE", "LDATE#1970-01-01", "LDATE_TO_STRING"],
    ["LDATE", "LDATE#2024-02-29", "LDATE_TO_STRING"],
    ["LDATE", "LDATE#2300-01-01", "LDATE_TO_STRING"],
    ["LTOD", "LTOD#00:00:00", "LTOD_TO_STRING"],
    ["LTOD", "LTOD#23:59:59.999999999", "LTOD_TO_STRING"],
    ["LTOD", "LTOD#01:02:03.5", "LTOD_TO_STRING"],
    ["LTOD", "LTOD#01:02:03.000001", "LTOD_TO_STRING"],
  ],
)

/**
 * Task 31: a BIT converts by its FAMILY ("bitstring") while its Rust type is `bool` — `TO_STRING(s.b0)` prints
 * 'true', and BIT_TO_REAL / TO_LREAL / INT_TO_BIT do not compile (E0606/E0054). CODESYS reads a BIT as a BOOL
 * (`type_dut_struct_with_bit_fields`, `ct_bit_fields`), and `xf_bool_to_string` is 'TRUE'. BIT exists only as a
 * STRUCT field, so the probe is a struct. Each conversion is taken from a TRUE field and a FALSE one; INT_TO_BIT
 * from 0, 1 and 2 (does 2 read as TRUE, or as its low bit?), each stored into its own BIT field and read back.
 */
const trBitConversions = cells(
  "tr_31_bit_conversions",
  "TO_STRING / BIT_TO_REAL / TO_LREAL / INT_TO_BIT on BIT struct fields (transpile-review 31)",
  [
    "bits : DUT_LANG_tr_31_bits;",
    "i0 : INT := 0;",
    "i1 : INT := 1;",
    "i2 : INT := 2;",
    "strTrue : STRING;",
    "strFalse : STRING;",
    "realTrue : REAL;",
    "realFalse : REAL;",
    "lrealTrue : LREAL;",
    "lrealFalse : LREAL;",
    "fromInt0 : BOOL;",
    "fromInt1 : BOOL;",
    "fromInt2 : BOOL;",
  ],
  [
    "bits.bTrue := TRUE;",
    "bits.bFalse := FALSE;",
    "strTrue := TO_STRING(bits.bTrue);",
    "strFalse := TO_STRING(bits.bFalse);",
    "realTrue := BIT_TO_REAL(bits.bTrue);",
    "realFalse := BIT_TO_REAL(bits.bFalse);",
    "lrealTrue := TO_LREAL(bits.bTrue);",
    "lrealFalse := TO_LREAL(bits.bFalse);",
    "bits.b0 := INT_TO_BIT(i0);",
    "bits.b1 := INT_TO_BIT(i1);",
    "bits.b2 := INT_TO_BIT(i2);",
    "fromInt0 := bits.b0;",
    "fromInt1 := bits.b1;",
    "fromInt2 := bits.b2;",
  ],
  "TYPE DUT_LANG_tr_31_bits :\nSTRUCT\n\tbTrue : BIT;\n\tbFalse : BIT;\n\tb0 : BIT;\n\tb1 : BIT;\n\tb2 : BIT;\nEND_STRUCT\nEND_TYPE\n\n",
)

/**
 * Task 32: LTIME_TO_STRING casts the UNSIGNED 64-bit LTIME to i64 in the Rust emitter (`castTo(..., "i64")`,
 * `iec_ltime_text(ns: i64)`), so LTIME#106752d prints 'LTIME#-106751d-23h-...'; the interpreter is right. Extends
 * `fmt_ltime_every_component` past 2^63 ns: 2^63-1 as the control both readings agree on, 2^63 exactly, the first
 * whole day past it, and the maximum LTIME (2^64-1 ns).
 */
const trLtimePastI64 = textCells(
  "tr_32_fmt_ltime_past_i64",
  "LTIME_TO_STRING at and beyond 2^63 ns, up to the maximum LTIME (transpile-review 32)",
  [
    ["LTIME", "LTIME#106751D23H47M16S854MS775US807NS", "LTIME_TO_STRING"],
    ["LTIME", "LTIME#106751D23H47M16S854MS775US808NS", "LTIME_TO_STRING"],
    ["LTIME", "LTIME#106752D", "LTIME_TO_STRING"],
    ["LTIME", "LTIME#213503D23H34M33S709MS551US615NS", "LTIME_TO_STRING"],
  ],
)

/**
 * Task 33: LREAL_TO_STRING keeps 15 significant digits; at an EXACT tie on the 16th the Rust prelude used to
 * (`format!("{:.*e}", 14, ...)`) round half-to-even where the interpreter (`toExponential(14)`) rounds half-up, and
 * the review saw half-up LIVE. Three ties half-even rounds DOWN (…445, …005, …005), one tie both rules round up
 * (…455), and non-tie controls either side (…444, …446, …006). Every value is below 2^53, so each is exact.
 */
const TIES = [
  "1234567890123445.0",
  "1000000000000005.0",
  "2500000000000005.0",
  "1234567890123455.0",
  "1234567890123444.0",
  "1234567890123446.0",
  "1000000000000006.0",
]
const trLrealTie = cells(
  "tr_33_fmt_lreal_tie",
  "LREAL_TO_STRING at an exact 16th-digit tie — half-up or half-even (transpile-review 33)",
  ["seed : LREAL := 1.0;", ...TIES.flatMap((_, i) => [`v${i} : LREAL;`, `s${i} : STRING;`])],
  TIES.flatMap((value, i) => [`v${i} := seed * ${value};`, `s${i} := LREAL_TO_STRING(v${i});`]),
)

/** transpile-review-2026-09-29 tasks 12, 31, 32, 33 — registered beside `TO_STRING_FORMAT_TESTS` in `index.ts`. */
export const TRANSPILE_REVIEW_TO_STRING_TESTS: readonly LanguageTest[] = [
  {
    ...trLongDates,
    deferred: {
      transpile:
        "transpile-review-2026-09-29 task 12: CODESYS prints LDT#/LD#/LTOD# text; the interpreter prints the raw count and the emitted Rust calls format helpers that do not exist (measured 2026-09-29)",
    },
  },
  trBitConversions,
  trLtimePastI64,
  trLrealTie,
]

export const TO_STRING_FORMAT_TESTS: readonly LanguageTest[] = [...reals, ...sweep, ...sweep2, ...ltimes, ...times]
