/**
 * THE LITERALS, RULE BY RULE — design.md §4 2.2 of openspec `frontend-conformance` (N1–N25, S1–S13, A1–A2), each rule put to
 * the vendor by fixtures of its own: `record:language` for accept/refuse and the vendor's words, `record:exec` for the
 * VALUE the vendor gives the literal (every fixture below that builds assigns its literal to a variable of the FB, so
 * the run recording holds `inst_<name>.<var>` — the literal's value as CODESYS stored it). Rows already decided by a
 * recorded fixture elsewhere keep those fixtures; what is here is what no recording decided before task 2.2.
 *
 * ONE QUESTION PER FIXTURE, as in `lexer.ts`: the IDE stops after a few parse errors, so a fixture holding two
 * refusals measures the stop, not the rule. A refused literal stands alone in its fixture, as the right-hand side of
 * one assignment; an accepted one is assigned to a variable of the type it names (or the type a bare literal of its
 * kind is read into), so its value is recorded and nothing else is asked.
 */
import type { LanguageTest } from "../../types.js"

const doc = "frontend-conformance design.md §4 2.2 (literals)"

/** A function block `FB_LANG_<name>` with `decl` in its VAR block and `body` as its implementation. */
function fb(name: string, feature: string, decl: string, body: string): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `FUNCTION_BLOCK ${pouName}\nVAR\n${decl}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** One variable `v : <type>` assigned one literal: `v := <literal>;`. */
function assign(name: string, feature: string, type: string, literal: string): LanguageTest {
  return fb(name, feature, `\tv : ${type};`, `v := ${literal};`)
}

/** An enum variable beside `out`, so the enum a body's `Type#Value` names is pushed with the fixture. */
const ENUM_IN_SCOPE = "\tm : DUT_LANG_enum_simple;\n\tout : INT;"

/** Why an incomplete-address fixture has no run: measured, not assumed (`execSkip`). */
const INCOMPLETE_ADDRESS_NEVER_RUNS =
  "NOTHING TO MEASURE — recorded alone, each, as \"Login failed...\" (CODESYS 2026-10-01): an incomplete address is completed by a VAR_CONFIG, which the recording project does not have, so the application builds and never starts; its one question is what the build says"

export const LITERAL_RULE_TESTS: readonly LanguageTest[] = [
  // ─── N2 the `_` digit separator (task 2.2.1) ──────────────────────────────────────────────────────────────────────
  // In a decimal, a hex and a binary integer; each value is recorded, so the separator's MEANING is measured too.
  fb(
    "lit_int_underscore",
    "N2 — `_` between digits: `1_000_000`, `16#FFFF_FFFF`, `2#1010_1010`",
    "\td : DINT;\n\tw : DWORD;\n\tb : BYTE;",
    "d := 1_000_000;\nw := 16#FFFF_FFFF;\nb := 2#1010_1010;",
  ),
  // …and where a separator is NOT between two digits: doubled, trailing, and right after the base's `#`.
  assign("lit_int_underscore_double", "N2 — two separators in a row: `1__000`", "DINT", "1__000"),
  assign("lit_int_underscore_trailing", "N2 — a trailing separator: `1000_`", "DINT", "1000_"),
  assign("lit_int_underscore_after_base", "N2 — a separator right after the base: `16#_FF`", "DWORD", "16#_FF"),

  // ─── N6 a base other than 2, 8 and 16; a digit its base does not have (task 2.2.1) ───────────────────────────────
  assign("lit_invalid_base_3", "N6 — base 3: `3#12`", "DINT", "3#12"),
  assign("lit_invalid_base_10", "N6 — base 10 written out: `10#12`", "DINT", "10#12"),
  // …and the bases on either side of 8 and 10, so "which bases" is asked, not inferred from 3 and 10
  assign("lit_invalid_base_4", "N6 — base 4: `4#12`", "DINT", "4#12"),
  assign("lit_invalid_base_12", "N6 — base 12: `12#12`", "DINT", "12#12"),
  assign("lit_invalid_digit_binary", "N3/N6 — a digit base 2 does not have: `2#102`", "DINT", "2#102"),
  assign("lit_invalid_digit_octal", "N4/N6 — a digit base 8 does not have: `8#78`", "DINT", "8#78"),
  assign("lit_invalid_digit_hex", "N5/N6 — a letter base 16 does not have: `16#FG`", "DINT", "16#FG"),

  // ─── N8 typed bit strings, every width (task 2.2.1) ───────────────────────────────────────────────────────────────
  assign("lit_byte_typed", "N8 — `BYTE#200`", "BYTE", "BYTE#200"),
  assign("lit_word_typed", "N8 — `WORD#60000`", "WORD", "WORD#60000"),
  assign("lit_dword_typed", "N8 — `DWORD#4000000000`", "DWORD", "DWORD#4000000000"),
  assign("lit_lword_typed", "N8 — `LWORD#10000000000000000000`", "LWORD", "LWORD#10000000000000000000"),

  // ─── N9 a typed BASED literal, every base (task 2.2.1) ────────────────────────────────────────────────────────────
  assign("lit_word_16_ff", "N9 — `WORD#16#FF`", "WORD", "WORD#16#FF"),
  assign("lit_byte_2_typed", "N9 — `BYTE#2#1010_0101`", "BYTE", "BYTE#2#1010_0101"),
  assign("lit_dword_8_typed", "N9 — `DWORD#8#777`", "DWORD", "DWORD#8#777"),
  assign("lit_int_16_typed", "N9 — a typed based SIGNED integer: `INT#16#7FFF`", "INT", "INT#16#7FFF"),

  // ─── N10 a sign inside a typed literal (task 2.2.1) ───────────────────────────────────────────────────────────────
  assign("lit_int_typed_negative", "N10 — `INT#-5`", "INT", "INT#-5"),
  assign("lit_int_typed_plus", "N10 — `INT#+5`", "INT", "INT#+5"),
  assign("lit_uint_typed_negative", "N10 — a negative UNSIGNED typed literal: `UINT#-5`", "UINT", "UINT#-5"),
  assign("lit_int_typed_negative_based", "N9/N10 — a sign before a base: `INT#-16#10`", "INT", "INT#-16#10"),

  // ─── N12a/N12b the REAL spellings (task 2.2.2) ────────────────────────────────────────────────────────────────────
  assign("lit_real_exponent_capital", "N12a — a capital exponent: `1.5E3`", "REAL", "1.5E3"),
  assign("lit_real_exponent_plus", "N12a — a signed positive exponent: `1.5E+3`", "REAL", "1.5E+3"),
  assign("lit_real_exponent_no_point", "N12a — an exponent with no fraction: `2E3`", "REAL", "2E3"),
  assign("lit_real_no_leading_digit", "N12b — no digit before the point: `.5`", "REAL", ".5"),
  assign("lit_real_no_fraction_digit", "N12b — no digit after the point: `5.`", "REAL", "5."),
  assign("lit_real_underscore", "N2/N11 — `_` in a REAL: `1_000.25`", "REAL", "1_000.25"),

  // ─── N15 typed BOOL, every spelling (task 2.2.2) ──────────────────────────────────────────────────────────────────
  assign("lit_bool_typed_true", "N15 — `BOOL#TRUE`", "BOOL", "BOOL#TRUE"),
  assign("lit_bool_typed_false", "N15 — `BOOL#FALSE`", "BOOL", "BOOL#FALSE"),
  assign("lit_bool_typed_1", "N15 — `BOOL#1`", "BOOL", "BOOL#1"),
  assign("lit_bool_typed_0", "N15 — `BOOL#0`", "BOOL", "BOOL#0"),
  assign("lit_bool_typed_2", "N15 — a BOOL digit that is neither 0 nor 1: `BOOL#2`", "BOOL", "BOOL#2"),

  // ─── N20 durations: `_`, a fraction, a sign (task 2.2.3) ──────────────────────────────────────────────────────────
  assign("lit_time_underscore", "N20 — `_` between a duration's components: `T#1h_30m`", "TIME", "T#1h_30m"),
  assign("lit_time_underscore_digits", "N20 — `_` inside a duration's number: `T#1_000ms`", "TIME", "T#1_000ms"),
  assign("lit_time_fraction", "N20 — a fractional component: `T#1.5s`", "TIME", "T#1.5s"),
  // which units a fraction may stand on: the largest below a day, the smallest of each type, and the one above it
  assign("lit_time_fraction_minutes", "N20 — a fractional minute: `T#1.5m`", "TIME", "T#1.5m"),
  assign("lit_ltime_fraction_ms", "N20 — a fractional millisecond in an LTIME: `LTIME#1.5ms`", "LTIME", "LTIME#1.5ms"),
  assign("lit_time_fraction_ms", "N20 — a fraction below a TIME's resolution: `T#1.5ms`", "TIME", "T#1.5ms"),
  assign("lit_time_fraction_not_last", "N20 — a fraction on a component that is not the last: `T#1.5s100ms`", "TIME", "T#1.5s100ms"),
  assign("lit_time_negative", "N20 — a negative duration: `T#-10ms`", "TIME", "T#-10ms"),
  assign("lit_ltime_fraction_ns", "N20 — a fraction below an LTIME's resolution: `LTIME#1.5ns`", "LTIME", "LTIME#1.5ns"),
  assign("lit_ltime_fraction_us", "N20 — a fractional microsecond: `LTIME#1.5us`", "LTIME", "LTIME#1.5us"),

  // ─── N24 calendar fields out of range; the leap day (task 2.2.4) ──────────────────────────────────────────────────
  assign("lit_date_month_13", "N24 — month 13: `D#2024-13-01`", "DATE", "D#2024-13-01"),
  assign("lit_date_day_32", "N24 — day 32: `D#2024-01-32`", "DATE", "D#2024-01-32"),
  assign("lit_date_feb_30", "N24 — a day the month does not have: `D#2023-02-30`", "DATE", "D#2023-02-30"),
  assign("lit_date_before_epoch", "N24 — a date before 1970: `D#1969-12-31`", "DATE", "D#1969-12-31"),
  assign("lit_tod_hour_25", "N24 — hour 25: `TOD#25:00:00`", "TOD", "TOD#25:00:00"),
  assign("lit_tod_minute_60", "N24 — minute 60: `TOD#12:60:00`", "TOD", "TOD#12:60:00"),
  assign("lit_tod_second_60", "N24 — second 60: `TOD#12:00:60`", "TOD", "TOD#12:00:60"),
  assign("lit_tod_fraction", "N22 — a fractional second: `TOD#12:00:00.5`", "TOD", "TOD#12:00:00.5"),
  assign("lit_dt_leap_day", "N24 — a leap day: `DT#2024-02-29-12:00:00`", "DT", "DT#2024-02-29-12:00:00"),
  assign("lit_dt_leap_day_non_leap", "N24 — a leap day in a common year: `DT#2023-02-29-12:00:00`", "DT", "DT#2023-02-29-12:00:00"),
  assign("lit_ldt_nanoseconds", "N23 — nine fractional digits: `LDT#2024-01-01-00:00:00.123456789`", "LDT", "LDT#2024-01-01-00:00:00.123456789"),

  // ─── the 2.2 review (task 2.2a): the cells the first pass extrapolated ─────────────────────────────────────────────
  // A refused literal where the parser reads a TYPE, not an expression: an array bound and a subrange bound.
  fb("lit_malformed_array_bound", "N6 — a refused literal as an array bound: `ARRAY[0..3#1]`", "\ta : ARRAY[0..3#1] OF INT;", ""),
  fb("lit_malformed_array_bound_typed", "N10 — a refused typed literal as an array bound: `ARRAY[0..INT#+5]`", "\ta : ARRAY[0..INT#+5] OF INT;", ""),
  fb("lit_malformed_subrange_bound", "N15 — a refused literal as a subrange bound: `INT(0..BOOL#2)`", "\ta : INT(0..BOOL#2);", ""),
  // N2 inside a TYPED integer and a duration's number: a `_` with no digit after it
  assign("lit_int_typed_underscore_trailing", "N2 — a trailing separator in a typed integer: `INT#1000_`", "INT", "INT#1000_"),
  assign("lit_int_typed_underscore_leading", "N2 — a separator right after a type's `#`: `INT#_5`", "INT", "INT#_5"),
  assign("lit_time_underscore_before_unit", "N2/N20 — a separator before a duration's unit: `T#1_ms`", "TIME", "T#1_ms"),
  // a refused literal that does NOT lead the initializer, and one inside an aggregate initializer
  fb("lit_init_malformed_not_leading", "N6 — a refused literal after an operator in an initializer: `:= 1 + 3#12`", "\tv : INT := 1 + 3#12;", ""),
  fb("lit_init_bool_typed_true", "N15 — `BOOL#TRUE` as an initializer", "\tv : BOOL := BOOL#TRUE;", ""),
  fb("lit_init_malformed_in_aggregate", "N19 — a refused literal inside an aggregate initializer: `[T#1s, T#1500US]`", "\ta : ARRAY[0..1] OF TIME := [T#1s, T#1500US];", ""),
  // N24 the UPPER ends of the calendar types, and TOD's hour 24 and fraction precision
  assign("lit_date_year_2200", "N24 — a year past a 32-bit DATE: `D#2200-01-01`", "DATE", "D#2200-01-01"),
  assign("lit_date_last_32bit", "N24 — the last day a 32-bit DATE holds: `D#2106-02-07`", "DATE", "D#2106-02-07"),
  assign("lit_date_past_32bit", "N24 — the day after it: `D#2106-02-08`", "DATE", "D#2106-02-08"),
  assign("lit_dt_year_2200", "N24 — a year past a 32-bit DT: `DT#2200-01-01-00:00:00`", "DT", "DT#2200-01-01-00:00:00"),
  assign("lit_ldate_year_2200", "N24 — a year past a 32-bit DATE, in an LDATE: `LDATE#2200-01-01`", "LDATE", "LDATE#2200-01-01"),
  assign("lit_tod_hour_24", "N24 — hour 24: `TOD#24:00:00`", "TOD", "TOD#24:00:00"),
  assign("lit_tod_fraction_4", "N22 — four fractional digits on a TOD: `TOD#12:00:00.1234`", "TOD", "TOD#12:00:00.1234"),
  // N20 the order of a duration's components
  assign("lit_time_components_out_of_order", "N20 — a smaller unit before a larger one: `T#5s1h`", "TIME", "T#5s1h"),
  assign("lit_time_component_repeated", "N20 — the same unit twice: `T#1s1s`", "TIME", "T#1s1s"),

  // ─── S8 a WSTRING's named escapes, each (task 2.2.5) ──────────────────────────────────────────────────────────────
  // Every named escape a STRING takes (S3), in a WSTRING, each in its own variable and each compared with the code
  // unit it would name, so the recording says both that it is accepted and what it stands for.
  fb(
    "lit_wstring_named_escapes",
    "S8 — every named escape in a WSTRING: `$N $L $R $P $T $$ $' $\"`, each compared with its code unit",
    [
      '\tn : WSTRING := "$N";', '\tl : WSTRING := "$L";', '\tcr : WSTRING := "$R";', '\tp : WSTRING := "$P";',
      '\tt : WSTRING := "$T";', '\td : WSTRING := "$$";', '\tq : WSTRING := "$\'";', '\tdq : WSTRING := "$"";',
      "\tnIs0A : BOOL;", "\tlIs0A : BOOL;", "\trIs0D : BOOL;", "\tpIs0C : BOOL;", "\ttIs09 : BOOL;", "\tdIs24 : BOOL;",
      "\tqIs27 : BOOL;", "\tdqIs22 : BOOL;",
    ].join("\n"),
    [
      'nIs0A := n = "$000A";', 'lIs0A := l = "$000A";', 'rIs0D := cr = "$000D";', 'pIs0C := p = "$000C";',
      'tIs09 := t = "$0009";', 'dIs24 := d = "$0024";', 'qIs27 := q = "$0027";', 'dqIs22 := dq = "$0022";',
    ].join("\n"),
  ),
  // S3/S8 the named escapes written in LOWER case — `$t` is measured (`string_escapes_named`), the other four are not.
  fb(
    "lit_string_lowercase_escapes",
    "S3 — the named escapes in lower case in a STRING: `$n $l $r $p $t`, each compared with its byte",
    "\tn : STRING := '$n';\n\tl : STRING := '$l';\n\tcr : STRING := '$r';\n\tp : STRING := '$p';\n\tt : STRING := '$t';\n\tnIs0A : BOOL;\n\tlIs0A : BOOL;\n\trIs0D : BOOL;\n\tpIs0C : BOOL;\n\ttIs09 : BOOL;",
    "nIs0A := n = '$0A';\nlIs0A := l = '$0A';\nrIs0D := cr = '$0D';\npIs0C := p = '$0C';\ntIs09 := t = '$09';",
  ),
  fb(
    "lit_wstring_lowercase_escapes",
    "S8 — the named escapes in lower case in a WSTRING: `$n $l $r $p $t`, each compared with its code unit",
    '\tn : WSTRING := "$n";\n\tl : WSTRING := "$l";\n\tcr : WSTRING := "$r";\n\tp : WSTRING := "$p";\n\tt : WSTRING := "$t";\n\tnIs0A : BOOL;\n\tlIs0A : BOOL;\n\trIs0D : BOOL;\n\tpIs0C : BOOL;\n\ttIs09 : BOOL;',
    'nIs0A := n = "$000A";\nlIs0A := l = "$000A";\nrIs0D := cr = "$000D";\npIs0C := p = "$000C";\ntIs09 := t = "$0009";',
  ),

  // ─── S9 the other quote inside a string (task 2.2.5) ──────────────────────────────────────────────────────────────
  fb(
    "lit_string_double_quote_inside",
    "S9 — a bare `\"` inside a STRING: `'a\"b'`",
    "\tstr : STRING;\n\tn : INT;",
    "str := 'a\"b';\nn := LEN(str);",
  ),
  fb(
    "lit_wstring_single_quote_inside",
    "S9 — a bare `'` inside a WSTRING: `\"a'b\"`",
    "\tw : WSTRING;",
    "w := \"a'b\";",
  ),
  // ─── S10 typed characters: CHAR#, WCHAR#, UCHAR# (task 2.2.6) ─────────────────────────────────────────────────────
  // Each prefix with the quote of each string width, into the integer its width names; then one probe per prefix into a
  // BOOL, so the vendor's "Cannot convert" message NAMES the literal's type instead of the fixture guessing it.
  assign("lit_char_typed", "S10 — `CHAR#'A'` into a BYTE", "BYTE", "CHAR#'A'"),
  assign("lit_char_typed_double_quote", "S10 — `CHAR#\"A\"`: a CHAR in a WSTRING's quote", "BYTE", "CHAR#\"A\""),
  assign("lit_char_typed_into_bool", "S10 — `CHAR#'A'` into a BOOL: the literal's type, in the vendor's words", "BOOL", "CHAR#'A'"),
  assign("lit_char_typed_two_chars", "S10 — two characters: `CHAR#'AB'`", "BYTE", "CHAR#'AB'"),
  assign("lit_wchar_typed", "S10 — `WCHAR#\"A\"` into a WORD", "WORD", "WCHAR#\"A\""),
  assign("lit_wchar_typed_single_quote", "S10 — `WCHAR#'A'`: a WCHAR in a STRING's quote", "WORD", "WCHAR#'A'"),
  assign("lit_wchar_typed_into_bool", "S10 — `WCHAR#\"A\"` into a BOOL: the literal's type, in the vendor's words", "BOOL", "WCHAR#\"A\""),
  assign("lit_uchar_typed_udint", "S10 — `UCHAR#'A'` into a UDINT (LT5: a UCHAR# is a UDINT)", "UDINT", "UCHAR#'A'"),
  assign("lit_uchar_typed_into_bool", "S10 — `UCHAR#'A'` into a BOOL: the literal's type, in the vendor's words", "BOOL", "UCHAR#'A'"),
  assign("lit_uchar_non_ascii", "S10 — a character beyond Latin-1: `UCHAR#'€'` (U+20AC)", "UDINT", "UCHAR#'€'"),
  assign("lit_uchar_escape", "S10 — an escape as the character: `UCHAR#'$41'`", "UDINT", "UCHAR#'$41'"),
  assign("lit_uchar_two_chars", "S10 — two characters: `UCHAR#'AB'`", "UDINT", "UCHAR#'AB'"),
  assign("lit_uchar_empty", "S10 — no character: `UCHAR#''`", "UDINT", "UCHAR#''"),
  assign("lit_uchar_double_quote", "S10 — `UCHAR#\"A\"`: a UCHAR in a WSTRING's quote", "UDINT", "UCHAR#\"A\""),
  assign("lit_uchar_lowercase_prefix", "S10 — the prefix in lower case: `uchar#'A'`", "UDINT", "uchar#'A'"),
  // The first recording (2026-10-01) answered `CHAR#'A'` "is no component of 'CHAR'" and `UCHAR#'AB'` / `UCHAR#''` /
  // `uchar#'A'` "Cannot convert type 'STRING(INT#n)'" with n the token's length less its two quotes. What that STRING
  // HOLDS, what an unknown word before `#'…'` is, and a CHAR#/WCHAR# with a number body:
  assign("lit_char_typed_number", "S10 — a number after `CHAR#`: `CHAR#65`", "BYTE", "CHAR#65"),
  assign("lit_wchar_typed_number", "S10 — a number after `WCHAR#`: `WCHAR#65`", "WORD", "WCHAR#65"),
  assign("lit_char_typed_lowercase_prefix", "S10 — `char#'A'`, the CHAR prefix in lower case", "BYTE", "char#'A'"),
  assign("lit_uchar_two_chars_into_string", "S10 — `UCHAR#'AB'` into a STRING: what the STRING it is holds", "STRING", "UCHAR#'AB'"),
  assign("lit_unknown_prefix_quoted", "S10–S13 — an unknown word before a quoted body, into a STRING: `XYZ#'abc'`", "STRING", "XYZ#'abc'"),
  assign("lit_uchar_two_escapes", "S10 — two escapes: `UCHAR#'$41$42'` — is the STRING sized by the text or by what it decodes to?", "UDINT", "UCHAR#'$41$42'"),
  assign("lit_unknown_prefix_quoted_into_udint","S10–S13 — `XYZ#'abc'` into a UDINT: its type, in the vendor's words", "UDINT", "XYZ#'abc'"),

  // ─── S11 typed strings: STRING#, WSTRING# (task 2.2.6) ────────────────────────────────────────────────────────────
  assign("lit_string_typed", "S11 — `STRING#'abc'` into a STRING", "STRING", "STRING#'abc'"),
  assign("lit_wstring_typed", "S11 — `WSTRING#\"abc\"` into a WSTRING", "WSTRING", "WSTRING#\"abc\""),
  assign("lit_string_typed_double_quote", "S11 — `STRING#\"abc\"`: a STRING# in a WSTRING's quote", "STRING", "STRING#\"abc\""),
  assign("lit_wstring_typed_single_quote", "S11 — `WSTRING#'abc'`: a WSTRING# in a STRING's quote", "WSTRING", "WSTRING#'abc'"),
  assign("lit_string_typed_escape", "S11 — an escape inside `STRING#'a$Nb'`", "STRING", "STRING#'a$Nb'"),
  assign("lit_string_typed_into_bool", "S11 — `STRING#'abc'` into a BOOL: the literal's type, in the vendor's words", "BOOL", "STRING#'abc'"),

  // ─── S12 the IEC typed enum literal `Type#Value` (task 2.2.6) ─────────────────────────────────────────────────────
  // Against enums recorded elsewhere: `type_dut_enum_simple`, and the qualified_only `xo_mode_enum`.
  assign("lit_enum_typed_value", "S12 — `DUT_LANG_enum_simple#Running`", "DUT_LANG_enum_simple", "DUT_LANG_enum_simple#Running"),
  assign("lit_enum_typed_unknown_value", "S12 — a value the enum does not have: `DUT_LANG_enum_simple#Missing`", "DUT_LANG_enum_simple", "DUT_LANG_enum_simple#Missing"),
  assign("lit_enum_typed_qualified_only", "S12 — a qualified_only enum: `DUT_XO_mode#Warming`", "DUT_XO_mode", "DUT_XO_mode#Warming"),

  // ─── S13 `UTF8#'…'` (task 2.2.6) ──────────────────────────────────────────────────────────────────────────────────
  // Its type is asked by assignment into a STRING and a WSTRING; its BYTES by LEN and by comparison with the escapes
  // that spell them — a STRING literal is otherwise Latin-1, so `ä` is one byte there and two here if the doc holds.
  fb("lit_utf8_string", "S13 — `UTF8#'abc'` into a STRING, and its length", "\tstr : STRING;\n\tn : INT;", "str := UTF8#'abc';\nn := LEN(str);"),
  fb(
    "lit_utf8_non_ascii",
    "S13 — `UTF8#'ä'`: its length and whether its bytes are `$C3$A4`",
    "\tstr : STRING;\n\tn : INT;\n\tisUtf8 : BOOL;",
    "str := UTF8#'ä';\nn := LEN(str);\nisUtf8 := str = '$C3$A4';",
  ),
  fb(
    "lit_utf8_escape",
    "S13 — an escape inside a UTF8# literal: `UTF8#'$21'` (the doc: decodes to `!`)",
    "\tstr : STRING;\n\tisBang : BOOL;",
    "str := UTF8#'$21';\nisBang := str = '!';",
  ),
  assign("lit_utf8_double_quote", "S13 — `UTF8#\"a\"`: a UTF8# in a WSTRING's quote", "STRING", "UTF8#\"a\""),
  assign("lit_utf8_into_wstring", "S13 — `UTF8#'a'` into a WSTRING: the literal's type, in the vendor's words", "WSTRING", "UTF8#'a'"),
  assign("lit_utf8_lowercase_prefix", "S13 — the prefix in lower case: `utf8#'a'`", "STRING", "utf8#'a'"),
  assign("lit_utf8_non_ascii_into_wstring", "S13 — `UTF8#'ä'` into a WSTRING: its STRING length, in the vendor's words", "WSTRING", "UTF8#'ä'"),
  assign("lit_utf8_lowercase_into_wstring","S13 — `utf8#'a'` into a WSTRING: its type, in the vendor's words", "WSTRING", "utf8#'a'"),

  // ─── A1/A2 direct addresses (task 2.2.7) ──────────────────────────────────────────────────────────────────────────
  // A2: the incomplete `*` address on each area, and with a size; an address with no size letter, with and without a
  // bit. A1: the spellings the existing AT fixtures do not write — an address as an operand in a body, the L size, a
  // lower-case address, a bit past a byte's last, the documented multi-segment form.
  { ...fb("lit_address_incomplete", "A2 — an incomplete input `AT %I*` in a function block", "\tb AT %I* : BOOL;\n\tout : BOOL;", "out := b;"), execSkip: INCOMPLETE_ADDRESS_NEVER_RUNS },
  { ...fb("lit_address_incomplete_output", "A2 — an incomplete output `AT %Q*`", "\tb AT %Q* : BOOL;", "b := TRUE;"), execSkip: INCOMPLETE_ADDRESS_NEVER_RUNS },
  { ...fb("lit_address_incomplete_memory", "A2 — an incomplete marker `AT %M*`", "\tb AT %M* : BOOL;\n\tout : BOOL;", "out := b;"), execSkip: INCOMPLETE_ADDRESS_NEVER_RUNS },
  fb("lit_address_incomplete_sized", "A2 — an incomplete address with a size: `AT %IW*`", "\tw AT %IW* : WORD;\n\tout : WORD;", "out := w;"),
  fb("lit_address_unsized", "A2 — an input bit with no size letter: `AT %I0.0`", "\tb AT %I0.0 : BOOL;\n\tout : BOOL;", "out := b;"),
  fb("lit_address_unsized_marker", "A2 — a marker bit with no size letter, written and read: `AT %M0.1`", "\tb AT %M0.1 : BOOL;\n\tout : BOOL;", "b := TRUE;\nout := b;"),
  fb("lit_address_unsized_no_bit", "A2 — no size letter and no bit: `AT %M0`", "\tb AT %M0 : BOOL;\n\tout : BOOL;", "b := TRUE;\nout := b;"),
  fb("lit_address_in_body", "A1 — an address as an operand in a body: `out := %MW6`", "\tout : WORD;", "%MW6 := 4660;\nout := %MW6;"),
  fb("lit_address_bit_in_body", "A1 — a bit address as an operand in a body: `out := %MX7.3`", "\tout : BOOL;", "%MX7.3 := TRUE;\nout := %MX7.3;"),
  fb("lit_address_lword", "A1 — the L size: `AT %ML1`", "\tv AT %ML1 : LWORD;\n\tout : LWORD;", "v := 16#1122334455667788;\nout := v;"),
  fb("lit_address_lowercase", "A1 — an address in lower case: `AT %mx9.2`", "\tb AT %mx9.2 : BOOL;\n\tout : BOOL;", "b := TRUE;\nout := b;"),
  fb("lit_address_bit_8", "A1 — a bit past a byte's last: `AT %MX10.8`", "\tb AT %MX10.8 : BOOL;\n\tout : BOOL;", "b := TRUE;\nout := b;"),
  fb("lit_address_bit_no_bit", "A1 — the X size with no bit: `AT %MX3`", "\tb AT %MX3 : BOOL;\n\tout : BOOL;", "b := TRUE;\nout := b;"),
  fb("lit_address_bit_three_segments", "A1 — the X size with three segments: `AT %MX1.2.3`", "\tb AT %MX1.2.3 : BOOL;\n\tout : BOOL;", "b := TRUE;\nout := b;"),
  fb("lit_address_incomplete_in_body", "A2 — an incomplete address as an operand in a body: `out := %I*`", "\tout : BOOL;", "out := %I*;"),
  fb("lit_address_unsized_in_body", "A2 — an unsized address as an operand in a body: `out := %M0.1`", "\tout : BOOL;", "out := %M0.1;"),
  fb("lit_address_no_position", "A2 — a size letter and no position: `AT %MW`", "\tw AT %MW : WORD;\n\tout : WORD;", "out := w;"),
  fb("lit_address_two_segments", "A1 — two segments on a word: `AT %MW2.5`", "\tw AT %MW2.5 : WORD;\n\tout : WORD;", "w := 7;\nout := w;"),
  fb("lit_address_multi_segment","A1 — the documented multi-segment form: `AT %IW2.5.7.1`", "\tw AT %IW2.5.7.1 : WORD;\n\tout : WORD;", "out := w;"),

  // ─── 2.2b: the positions the first cells did not ask (review of 2.2.6–2.2.7) ──────────────────────────────────────
  // A malformed address and an enum `Type#Value` were recorded only as `out := <expr>`; a sized address with no position
  // only after AT. Each other position the LSP reaches them in, one per fixture.
  fb("lit_address_unsized_as_argument", "A2 — an unsized address as a function's argument: `ABS(%M0.1)`", "\tout : INT;", "out := ABS(%M0.1);"),
  fb("lit_address_unsized_as_conversion_argument", "A2 — an unsized address as a conversion's argument: `TO_INT(%M0.1)`", "\tout : INT;", "out := TO_INT(%M0.1);"),
  fb("lit_address_unsized_under_not", "A2 — an unsized address under a unary operator: `NOT %M0.1`", "\tout : BOOL;", "out := NOT %M0.1;"),
  fb("lit_address_unsized_under_adr", "A2 — an unsized address as ADR's operand: `ADR(%M0.1)` — and its echo", "\tp : POINTER TO BOOL;", "p := ADR(%M0.1);"),
  fb("lit_address_no_position_in_body", "A2 — a size letter and no position as an operand: `out := %MW`", "\tout : WORD;", "out := %MW;"),
  fb("lit_address_no_position_as_target", "A2 — a size letter and no position as a target: `%MW := 1`", "\tout : WORD;", "%MW := 1;"),
  fb("lit_address_sized_star_in_body", "A2 — `%IW*2` in a body: `%IW` then `*`?", "\tout : WORD;", "out := %IW*2;"),
  // (each declares a variable of the enum, so the enum is a DEPENDENCY the recorder pushes: a name read only inside a
  // `<word>#<operand>` token is no reference `withDependencies` sees)
  fb("lit_enum_typed_as_argument", "S12 — an enum `Type#Value` as a function's argument: `ABS(DUT_LANG_enum_simple#Running)`", ENUM_IN_SCOPE, "out := ABS(DUT_LANG_enum_simple#Running);"),
  fb("lit_enum_typed_as_conversion_argument", "S12 — an enum `Type#Value` as a conversion's argument: `TO_INT(DUT_LANG_enum_simple#Running)`", ENUM_IN_SCOPE, "out := TO_INT(DUT_LANG_enum_simple#Running);"),
  fb("lit_enum_typed_under_minus", "S12 — an enum `Type#Value` under a unary minus", ENUM_IN_SCOPE, "out := -DUT_LANG_enum_simple#Running;"),
  // S10–S13's "no component" in the initializer positions the first cells did not ask: an aggregate, a STRUCT field, an
  // enum value.
  fb("lit_char_typed_in_array_init", "S10 — `CHAR#'A'` in an array initializer", "\ta : ARRAY[0..1] OF BYTE := [CHAR#'A', 1];", "a[1] := 2;"),
  {
    name: "lit_char_typed_in_struct_field",
    pouName: "DUT_LANG_lit_char_struct_field",
    kind: "struct",
    feature: "S10 — `CHAR#'A'` as a STRUCT field's initializer",
    fromDoc: doc,
    plcPrgVar: "s_lit_char_struct_field : DUT_LANG_lit_char_struct_field;",
    plcPrgBody: "s_lit_char_struct_field.b := 1;",
    source: "TYPE DUT_LANG_lit_char_struct_field :\nSTRUCT\n\ta : BYTE := CHAR#'A';\n\tb : BYTE;\nEND_STRUCT\nEND_TYPE\n",
  },
  {
    name: "lit_char_typed_in_enum_value",
    pouName: "DUT_LANG_lit_char_enum_value",
    kind: "enum",
    feature: "S10 — `CHAR#'A'` as an enum value's initializer",
    fromDoc: doc,
    plcPrgVar: "e_lit_char_enum_value : DUT_LANG_lit_char_enum_value;",
    plcPrgBody: "e_lit_char_enum_value := DUT_LANG_lit_char_enum_value.B;",
    source: "TYPE DUT_LANG_lit_char_enum_value :\n(\n\tA := CHAR#'A',\n\tB\n);\nEND_TYPE\n",
  },
  // S10: a UCHAR# whose one escape decodes past ASCII — one byte, or a STRING?
  assign("lit_uchar_high_escape", "S10 — an escape past ASCII as the character: `UCHAR#'$C4'`", "UDINT", "UCHAR#'$C4'"),
  // …and one where the byte and its Windows-1252 character differ (`$80` is `€`, U+20AC): which does UCHAR# give?
  assign("lit_uchar_escape_80", "S10 — `UCHAR#'$80'`: the byte 128, or CP1252's `€` (8364)?", "UDINT", "UCHAR#'$80'"),
  // A2: AN INCOMPLETE ADDRESS IN A GVL, INITIALIZED, IS NOT A FIXTURE, and needs the owner — as the `__VECTOR` alias
  // (`support/divergences.ts` `TWINCAT_VECTOR_REFUSAL_CASCADE`). It is the shape `transpile/lower/init-sequence.test.ts`
  // stands on: `VAR_GLOBAL gIncompleteAddressed AT %I* : BYTE := 2; END_VAR` (GVL_LANG_lit_address_incomplete), read in
  // PLC_PRG, was recorded 2026-10-01 as `lit_address_incomplete_in_gvl_with_init`: CODESYS and TwinCAT both BUILD it
  // clean, and the LSP agrees on both; CODESYS's run is "Login failed..." recorded alone (no VAR_CONFIG, as
  // `INCOMPLETE_ADDRESS_NEVER_RUNS`). It could not be kept: a GVL binds no scope, so its initializer is one more
  // `fixtures <vendor>: literal NOSCOPE` (0.4) and `decl NOSCOPE` (fold) than the ceilings allow on each vendor, and a
  // ceiling may only fall. The fixture and its three recordings go back together once the owner accepts that rise or a
  // GVL binds a scope.
  // A typed literal as a CASE label: a typed integer, and an enum `Type#Value`.
  fb("lit_typed_int_case_label", "N10 — a typed integer as a CASE label: `INT#5:`", "\tout : INT;", "CASE out OF\nINT#5: out := 1;\nEND_CASE"),
  fb("lit_enum_typed_case_label", "S12 — an enum `Type#Value` as a CASE label", "\tm : DUT_LANG_enum_simple;\n\tout : INT;", "CASE m OF\nDUT_LANG_enum_simple#Running: out := 1;\nEND_CASE"),
]
