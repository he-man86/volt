/**
 * the fixtures of `execution.ts` — part D: FOR with a negative step — including where the counter is left afterwards; MOD by zero: `cc_mod_udint_dint` (0 MOD 0) recorded 0 where `/` by zero stopped the application. Is the answer 0,; NOT's result width: `cc_not_int_into_dint` recorded NOT of INT 0 into a DINT as 65535 — zero-extended, as if NOT; conversions between temporal types, to text, and to/from REAL: `conversion_date_to_string` and.
 *
 * One slice of `execution.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { ExecCase } from "./execution-shared.js"

export const CASES_D: readonly ExecCase[] = [
  // ── FOR with a negative step — including where the counter is left afterwards ──
  {
    name: "for_negative_step",
    vars: "i : INT; runs : INT; sum : INT;",
    body: "FOR i := 10 TO 1 BY -3 DO runs := runs + 1; sum := sum + i; END_FOR",
  },
  // transpile-review-2026-09-29 task 13: a FOR whose limit is WIDER than its counter — a DINT variable, a DINT expression,
  // UPPER_BOUND (a DINT), a UINT `n - 1` — and a negative step. Does CODESYS take each, how many passes, where is the
  // counter left?
  {
    name: "for_limit_wider_than_counter_dint_var",
    vars: "hi : DINT := 3; i : INT; runs : INT;",
    body: "FOR i := 1 TO hi DO runs := runs + 1; END_FOR",
  },
  {
    name: "for_limit_wider_than_counter_dint_expr",
    vars: "k : DINT := 4; i : INT; runs : INT;",
    body: "FOR i := 1 TO k - 1 DO runs := runs + 1; END_FOR",
  },
  {
    name: "for_limit_wider_than_counter_upper_bound",
    vars: "arr : ARRAY[0..4] OF INT; j : INT; runs : INT;",
    body: "FOR j := 0 TO UPPER_BOUND(arr, 1) DO runs := runs + 1; END_FOR",
  },
  {
    name: "for_limit_wider_than_counter_uint_expr",
    vars: "n : UINT := 3; u : UINT; runs : INT;",
    body: "FOR u := 0 TO n - 1 DO runs := runs + 1; END_FOR",
  },
  {
    name: "for_limit_wider_than_counter_negative_step",
    vars: "sc : SINT; runs : INT; sum : INT;",
    body: "FOR sc := 5 TO -5 BY -1 DO runs := runs + 1; sum := sum + sc; END_FOR",
  },
  // transpile-restructure 2.6 (gate 2b): the classes `for-limit-type` and the step rule would decide with no recording
  // of their own — FOR-limit conversion is not assignment conversion (an untyped 200 is a SINT counter's limit,
  // `tr_36_*`; 300 is no SINT CASE label, `tr_37_case_label_wraps_300`). Does CODESYS take each, and how many passes?
  // A named DINT CONSTANT limit on an INT counter (the DINT variable is refused: `_dint_var`).
  {
    name: "for_limit_wider_than_counter_dint_constant",
    vars: "i : INT; runs : INT; END_VAR VAR CONSTANT hi : DINT := 3;",
    body: "FOR i := 1 TO hi DO runs := runs + 1; END_FOR",
  },
  // A TYPED literal limit: a DINT#5 on an INT counter.
  {
    name: "for_limit_wider_than_counter_typed_literal",
    vars: "i : INT; runs : INT;",
    body: "FOR i := 1 TO DINT#5 DO runs := runs + 1; END_FOR",
  },
  // Same width, other sign: an INT variable limit on a UINT counter, and a UINT one on an INT counter.
  {
    name: "for_limit_sign_change_int_on_uint",
    vars: "hi : INT := 3; u : UINT; runs : INT;",
    body: "FOR u := 1 TO hi DO runs := runs + 1; END_FOR",
  },
  {
    name: "for_limit_sign_change_uint_on_int",
    vars: "hi : UINT := 3; i : INT; runs : INT;",
    body: "FOR i := 1 TO hi DO runs := runs + 1; END_FOR",
  },
  // A typed STEP that is not a bare variable: a DINT expression, and UPPER_BOUND (a DINT), on an INT counter. Recorded
  // (record:exec 2026-10-08): none of the three is taken. `_dint_paren` and `_upper_bound` do not compile, "Cannot convert
  // type 'DINT' to type 'INT'"; `BY k - 1` unparenthesised (`_dint_expr`) is a PARSE error, "'DO' expected instead of
  // '-'" — which is why `_dint_paren` was added to ask the type question.
  {
    name: "for_step_wider_than_counter_dint_expr",
    vars: "k : DINT := 3; i : INT; runs : INT; last : INT;",
    body: "FOR i := 0 TO 10 BY k - 1 DO runs := runs + 1; last := i; END_FOR",
    rejects: "'DO' expected instead of '-'",
    // lsp-transpile-review-gaps 2.2: the parser takes a binary BY operand, so the LSP refuses the step by its type
    // (`for-bound-type`, "Cannot convert type 'DINT' to type 'INT'") where CODESYS stops at the parse
    lspDeferred:
      "niche: accepted loss (0 occurrences in the corpora) — `BY k - 1` unparenthesised is a CODESYS parse error the parser accepts; which binary operators a BY operand admits is unrecorded",
  },
  {
    name: "for_step_wider_than_counter_dint_paren",
    vars: "k : DINT := 3; i : INT; runs : INT; last : INT;",
    body: "FOR i := 0 TO 10 BY (k - 1) DO runs := runs + 1; last := i; END_FOR",
  },
  {
    name: "for_step_wider_than_counter_upper_bound",
    vars: "arr : ARRAY[0..3] OF INT; i : INT; runs : INT; last : INT;",
    body: "FOR i := 0 TO 10 BY UPPER_BOUND(arr, 1) DO runs := runs + 1; last := i; END_FOR",
  },
  // transpile-restructure gate 2c: the same-width sign-change pair (`for_limit_sign_change_*`) was recorded inside the INT
  // range only, where comparing in INT, in UINT or promoted all answer alike. Outside it they part: a UINT counter from
  // 40000 to an INT limit of 100 runs 0 passes compared promoted or in UINT, 25637 compared in INT (40000 is -25536);
  // an INT counter to a UINT limit of 40000 runs 0 compared in INT (-25536), 40001 in UINT (the counter wraps to
  // -32768 = 32768 and stops past 40000), and never stops promoted (an INT never exceeds 40000) — the EXIT guard ends
  // that at 50000 passes.
  {
    name: "for_limit_sign_change_uint_counter_out_of_int_range",
    vars: "hi : INT := 100; u : UINT; runs : DINT;",
    body: "FOR u := 40000 TO hi DO runs := runs + 1; END_FOR",
  },
  {
    name: "for_limit_sign_change_uint_limit_out_of_int_range",
    vars: "hi : UINT := 40000; i : INT; runs : DINT;",
    body: "FOR i := 0 TO hi DO runs := runs + 1; IF runs >= 50000 THEN EXIT; END_IF END_FOR",
  },
  // A TYPED literal step that does not convert into the counter, its value fitting: INT#-1 on a BYTE counter (the untyped
  // `BY -1` on a BYTE is taken, `tr_35_for_byte_step_minus_one`).
  {
    name: "for_step_typed_literal_on_narrower_counter",
    vars: "b : BYTE; runs : INT;",
    body: "FOR b := 5 TO 0 BY INT#-1 DO runs := runs + 1; END_FOR",
  },
  // ── MOD by zero: `cc_mod_udint_dint` (0 MOD 0) recorded 0 where `/` by zero stopped the application. Is the answer 0,
  //    or the dividend — in each signedness and width? ──
  {
    name: "mod_by_zero",
    vars: "i7 : INT := 7; iz : INT; dn7 : DINT := -7; dz : DINT; u7 : UDINT := 7; uz : UDINT; l7 : LINT := 7; lz : LINT; mi : INT; md : DINT; mu : UDINT; ml : LINT;",
    body: "mi := i7 MOD iz; md := dn7 MOD dz; mu := u7 MOD uz; ml := l7 MOD lz;",
  },
  // ── NOT's result width: `cc_not_int_into_dint` recorded NOT of INT 0 into a DINT as 65535 — zero-extended, as if NOT
  //    of an INT were a WORD. Does that hold for every width, a non-zero operand, a negative one, a store of the same width? ──
  {
    name: "not_result_width",
    vars: "i5 : INT := 5; s0 : SINT; sn6 : SINT := -6; d0 : DINT; w0 : WORD; fromInt5 : DINT; fromSint0 : INT; fromNegSint : INT; fromDint0 : LINT; fromWord0 : DINT; sameInt : INT; intToLreal : LREAL;",
    body: "fromInt5 := NOT i5; fromSint0 := NOT s0; fromNegSint := NOT sn6; fromDint0 := NOT d0; fromWord0 := NOT w0; sameInt := NOT i5; intToLreal := NOT i5;",
  },
  // ── conversions between temporal types, to text, and to/from REAL: `conversion_date_to_string` and
  //    `conversion_dt_to_date` hold one value each, too few for a rule — single-digit fields, milliseconds, a date at the
  //    epoch, a REAL that is not a whole number of milliseconds ──
  {
    name: "temporal_conversions",
    vars: [
      "dt1 : DT := DT#2026-05-29-12:30:45; d1 : DATE := D#2026-05-09; tod1 : TOD := TOD#07:05:03.250; tod0 : TOD := TOD#23:59:59;",
      "t1 : TIME := T#1H2M3S4MS; epoch : DATE := D#1970-01-01; rHalf : REAL := 2.5; rBig : REAL := 1500.7;",
      "toDate : DATE; toTod : TOD; dateToDt : DT; todToTime : TIME; timeToTod : TOD;",
      "dtText : STRING; dateText : STRING; todText : STRING; tod0Text : STRING; epochText : STRING;",
      "timeToReal : REAL; realHalfToTime : TIME; realBigToTime : TIME; dateToReal : LREAL;",
    ].join("\n"),
    body: [
      "toDate := DT_TO_DATE(dt1); toTod := DT_TO_TOD(dt1); dateToDt := DATE_TO_DT(d1);",
      "todToTime := TOD_TO_TIME(tod1); timeToTod := TIME_TO_TOD(t1);",
      "dtText := DT_TO_STRING(dt1); dateText := DATE_TO_STRING(d1); todText := TOD_TO_STRING(tod1); tod0Text := TOD_TO_STRING(tod0); epochText := DATE_TO_STRING(epoch);",
      "timeToReal := TIME_TO_REAL(t1); realHalfToTime := REAL_TO_TIME(rHalf); realBigToTime := REAL_TO_TIME(rBig); dateToReal := DATE_TO_LREAL(d1);",
    ].join("\n"),
  },
]
