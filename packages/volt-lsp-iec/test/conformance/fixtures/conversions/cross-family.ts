/**
 * CONVERSIONS ACROSS THE ISOLATED FAMILIES — durations, dates and strings, which have no implicit path to anything
 * and must be converted by name.
 *
 * The numeric grids (`integer-to-integer.ts`, `real-to-integer.ts`, `integer-to-real.ts`) cover the types that meet
 * in a lattice. These are the four families that do not: `time`, `date`, `string`, and the boolean. Everything about
 * them has to be measured, because there is no rule to derive an answer from.
 *
 *   TIME <-> integer      TIME is 32-bit MILLISECONDS and LTIME 64-bit NANOSECONDS, so the same duration is a
 *                         different number in each, and converting between them is not a reinterpretation.
 *   DATE family           DATE and DT count SECONDS, TOD milliseconds, and the L variants nanoseconds — six types,
 *                         three units, and `date_width_wrap` already records that a DT is 32 bits and wraps in 2106.
 *   TO_STRING             every family has one, and the FORMAT is a fact no rule predicts: `T#1s500ms`,
 *                         `D#2026-05-09`, `TOD#07:05:03.250`. The prelude mirrors these line for line, so a format
 *                         drift is a silent divergence between the two backends.
 *   STRING_TO_            AND THE PARSE OF SOMETHING THAT IS NOT ONE. `STRING_TO_INT('abc')` has no right answer
 *                         and the vendor must do something; nothing recorded says what. Same for an empty string,
 *                         a number with trailing rubbish, and one far too large for the destination.
 *   BOOL                  both directions, since a BOOL is one bit of truth and any non-zero integer is TRUE.
 */
import type { LanguageTest } from "../../types.js"

function probe(slug: string, decls: string, setup: string, expr: string, outType: string, feature: string): LanguageTest {
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
      `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\n\tout : ${outType};\nEND_VAR\n${setup}\nout := ${expr};\nEND_FUNCTION_BLOCK\n`,
  }
}

/** A duration through every integer width, and back — the units are the question. */
const durations: LanguageTest[] = [
  ...["DINT", "UDINT", "DWORD", "LINT", "ULINT", "LWORD", "INT", "UINT"].map((d) =>
    probe(`xf_time_to_${d.toLowerCase()}`, "\tv : TIME;", "v := T#1S500MS;", `TIME_TO_${d}(v)`, d, `TIME_TO_${d} of 1s500ms — TIME counts milliseconds`),
  ),
  ...["DINT", "UDINT", "LINT", "ULINT"].map((d) =>
    probe(`xf_ltime_to_${d.toLowerCase()}`, "\tv : LTIME;", "v := LTIME#1S500MS;", `LTIME_TO_${d}(v)`, d, `LTIME_TO_${d} of 1s500ms — LTIME counts nanoseconds`),
  ),
  probe("xf_time_to_ltime", "\tv : TIME;", "v := T#1S500MS;", "TIME_TO_LTIME(v)", "LTIME", "TIME to LTIME — milliseconds into nanoseconds, so not a reinterpretation"),
  probe("xf_ltime_to_time", "\tv : LTIME;", "v := LTIME#1S500MS;", "LTIME_TO_TIME(v)", "TIME", "LTIME to TIME — nanoseconds down to milliseconds"),
  probe("xf_dint_to_time", "\tv : DINT;", "v := 1500;", "DINT_TO_TIME(v)", "TIME", "an integer into a TIME — read as milliseconds?"),
  probe("xf_dint_to_ltime", "\tv : DINT;", "v := 1500;", "DINT_TO_LTIME(v)", "LTIME", "an integer into an LTIME — read as nanoseconds?"),
]

/** The date family among itself, where three different units meet. */
const DATES: readonly string[] = ["DATE", "DT", "TOD", "LDATE", "LDT", "LTOD"]
const dates: LanguageTest[] = DATES.flatMap((src) =>
  DATES.filter((d) => d !== src).map((dst) =>
    probe(
      `xf_${src.toLowerCase()}_to_${dst.toLowerCase()}`,
      `\tv : ${src};`,
      `v := ${src === "DATE" ? "D#2026-05-09" : src === "LDATE" ? "LDATE#2026-05-09" : src === "TOD" ? "TOD#07:05:03.250" : src === "LTOD" ? "LTOD#07:05:03.250" : src === "DT" ? "DT#2026-05-09-07:05:03" : "LDT#2026-05-09-07:05:03"};`,
      `${src}_TO_${dst}(v)`,
      dst,
      `${src} to ${dst} — ${src} counts ${src === "TOD" ? "milliseconds" : src.startsWith("L") ? "nanoseconds" : "seconds"}`,
    ),
  ),
)

/** Every family's text form — the prelude mirrors each one, so a drift here is a silent backend divergence. */
const texts: LanguageTest[] = [
  probe("xf_time_to_string", "\tv : TIME;", "v := T#1S500MS;", "TIME_TO_STRING(v)", "STRING", "TIME as text"),
  probe("xf_time_zero_to_string", "\tv : TIME;", "v := T#0MS;", "TIME_TO_STRING(v)", "STRING", "a zero TIME as text"),
  probe("xf_ltime_to_string", "\tv : LTIME;", "v := LTIME#1S500MS;", "LTIME_TO_STRING(v)", "STRING", "LTIME as text"),
  probe("xf_date_to_string", "\tv : DATE;", "v := D#2026-05-09;", "DATE_TO_STRING(v)", "STRING", "DATE as text"),
  probe("xf_dt_to_string", "\tv : DT;", "v := DT#2026-05-09-07:05:03;", "DT_TO_STRING(v)", "STRING", "DT as text"),
  probe("xf_tod_to_string", "\tv : TOD;", "v := TOD#07:05:03.250;", "TOD_TO_STRING(v)", "STRING", "TOD as text, with milliseconds"),
  probe("xf_tod_round_to_string", "\tv : TOD;", "v := TOD#23:59:59;", "TOD_TO_STRING(v)", "STRING", "TOD as text, on a whole second"),
  probe("xf_dint_to_string", "\tv : DINT;", "v := 0 - 42;", "DINT_TO_STRING(v)", "STRING", "a negative integer as text"),
  probe("xf_real_to_string", "\tv : REAL;", "v := 1.5;", "REAL_TO_STRING(v)", "STRING", "a REAL as text"),
  probe("xf_bool_to_string", "\tv : BOOL;", "v := TRUE;", "BOOL_TO_STRING(v)", "STRING", "a BOOL as text"),
]

/** Parsing, including the inputs that are not a number at all. */
const PARSES: readonly [string, string][] = [
  ["'42'", "plain"],
  ["'-42'", "negative"],
  ["''", "empty"],
  ["'abc'", "not_a_number"],
  ["'42abc'", "trailing_rubbish"],
  ["'  42'", "leading_spaces"],
  ["'999999999999'", "far_too_large"],
]
const parses: LanguageTest[] = PARSES.flatMap(([literal, slug]) => [
  probe(`xf_string_to_int_${slug}`, `\tv : STRING := ${literal};`, "", "STRING_TO_INT(v)", "INT", `STRING_TO_INT(${literal})`),
  probe(`xf_string_to_real_${slug}`, `\tv : STRING := ${literal};`, "", "STRING_TO_REAL(v)", "REAL", `STRING_TO_REAL(${literal})`),
])

/** A BOOL is one bit of truth; every non-zero integer should be TRUE, and nothing had asked which ones. */
const bools: LanguageTest[] = [
  probe("xf_int_to_bool_zero", "\tv : INT;", "v := 0;", "INT_TO_BOOL(v)", "BOOL", "0 into a BOOL"),
  probe("xf_int_to_bool_one", "\tv : INT;", "v := 1;", "INT_TO_BOOL(v)", "BOOL", "1 into a BOOL"),
  probe("xf_int_to_bool_two", "\tv : INT;", "v := 2;", "INT_TO_BOOL(v)", "BOOL", "2 into a BOOL — non-zero but not one"),
  probe("xf_int_to_bool_negative", "\tv : INT;", "v := 0 - 1;", "INT_TO_BOOL(v)", "BOOL", "-1 into a BOOL"),
  probe("xf_bool_to_int_true", "\tv : BOOL;", "v := TRUE;", "BOOL_TO_INT(v)", "INT", "TRUE as an integer"),
  probe("xf_bool_to_real_true", "\tv : BOOL;", "v := TRUE;", "BOOL_TO_REAL(v)", "REAL", "TRUE as a REAL"),
]

export const CROSS_FAMILY_TESTS: readonly LanguageTest[] = [...durations, ...dates, ...texts, ...parses, ...bools]
