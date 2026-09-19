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

export const TO_STRING_FORMAT_TESTS: readonly LanguageTest[] = [...reals, ...ltimes, ...times]
