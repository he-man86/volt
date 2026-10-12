/**
 * the fixtures of `execution.ts` — part E: array initializers: no fixture held one. A list shorter than the array (is the rest 0?), a repeat count, a REAL.
 *
 * One slice of `execution.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { ExecCase } from "./execution-shared.js"

export const CASES_E: readonly ExecCase[] = [
  // ── array initializers: no fixture held one. A list shorter than the array (is the rest 0?), a repeat count, a REAL
  //    array given integers, a 2D array in row order, a STRING array, and a negative element ──
  {
    name: "array_initializers",
    vars: [
      "partial : ARRAY[1..5] OF INT := [1, 2, 3];",
      "repeated : ARRAY[0..5] OF INT := [2(7), 3(9), 4];",
      "reals : ARRAY[0..2] OF REAL := [1, 2.5, -3];",
      "grid : ARRAY[0..1, 0..2] OF INT := [1, 2, 3, 4, 5, 6];",
      "texts : ARRAY[0..2] OF STRING(4) := ['a', 'bcdef'];",
      "negatives : ARRAY[-1..1] OF DINT := [-1, 0, 1];",
    ].join("\n"),
    body: "partial[5] := partial[5] + 0;",
  },
  // (No math-domain-error case: `SQRT(-1.0)` / `LN(0.0)` stop the simulated application — the recorder's read
  //  times out, measured 2026-09-14 — so there is no state to compare. A runtime exception, like division by zero;
  //  neither backend models runtime exceptions yet, and the oracle cannot record one.)

  // ════ transpile-review-2026-09-29 — the confirmed root causes still open, one question each (tasks 6–47). Nothing
  //      here states an answer: the recorder does (record:exec), and each comment says only what the case exposes. ════

  // task 6: an untyped integer literal beside a variable — does it adopt the NEIGHBOUR's type (and wrap), or its own
  // (the smallest type that holds it: just past DINT, past UDINT)? Compare, sum, product and MAX, the literal on either
  // side. `cc_literal_3e9_into_dint` (an ASSIGNMENT, which wraps) is the control beside it.
  {
    name: "tr_6_literal_beyond_dint_neighbour",
    vars: [
      "x : DINT := 5; ud : UDINT := 3;",
      "gNegLint : BOOL; sumNegLint : LINT; sumUdLint : LINT; gUdLint : BOOL;",
      "gUdintLit : BOOL; gUdintLitRev : BOOL; mulUdintLit : LINT; mx : LINT;",
    ].join("\n"),
    body: [
      "gNegLint := x > -3000000000;",
      "sumNegLint := x + -3000000000;",
      "sumUdLint := ud + 5000000000;",
      "gUdLint := ud > 5000000000;",
      "gUdintLit := x > 3000000000;",
      "gUdintLitRev := 3000000000 < x;",
      "mulUdintLit := ud * 5000000000;",
      "mx := MAX(ud, 5000000000);",
    ].join(" "),
  },
  // transpile-restructure 6.2 gate: rule LT12 (`lt_literal_negative_in_comparison_unsigned`) was recorded for -1 only, a
  // SINT literal, bare. Does a negative literal of another class — INT (-200), DINT (-40000), LINT (-3000000000) —
  // beside a narrower UNSIGNED variable convert into UDINT too, and does a parenthesised -1 or a constant expression
  // (0 - 1)? One question per fixture, so a refusal of one does not hide the others' values.
  {
    name: "tr_6_negative_int_beside_unsigned",
    vars: "u : USINT := 255; ui : UINT := 3; b1 : BOOL; b2 : BOOL;",
    body: "b1 := u > -200; b2 := ui > -200;",
  },
  {
    name: "tr_6_negative_dint_beside_unsigned",
    vars: "ui : UINT := 3; b : BOOL;",
    body: "b := ui > -40000;",
  },
  {
    name: "tr_6_negative_lint_beside_unsigned",
    vars: "ui : UINT := 3; b : BOOL;",
    body: "b := ui > -3000000000;",
  },
  {
    name: "tr_6_negative_paren_beside_unsigned",
    vars: "ui : UINT := 3; b : BOOL;",
    body: "b := ui > (-1);",
  },
  {
    name: "tr_6_negative_expression_beside_unsigned",
    vars: "ui : UINT := 3; b : BOOL;",
    body: "b := ui > 0 - 1;",
  },
  // task 14: S= / R= through a pointer that MAY point at one of two places (assigned on both arms of an IF) — still a
  // conditional set/reset of the target, or does it store the condition? The `c` group leaves each pointer on its
  // first target (R= TRUE on a TRUE bool, S= FALSE on a FALSE one); the `ct` group takes the other arm, so both targets
  // are reached. Compare `set_reset_basic`.
  {
    name: "tr_14_set_reset_through_multi_target_pointer",
    vars: [
      "c : BOOL := FALSE; a : BOOL := TRUE; b : BOOL; a2 : BOOL; b2 : BOOL; p : POINTER TO BOOL; q : POINTER TO BOOL;",
      "ct : BOOL := TRUE; ta : BOOL; tb : BOOL := TRUE; ta2 : BOOL; tb2 : BOOL; pt : POINTER TO BOOL; qt : POINTER TO BOOL;",
    ].join("\n"),
    body: [
      "p := ADR(a); IF c THEN p := ADR(b); END_IF; p^ R= TRUE;",
      "q := ADR(a2); IF c THEN q := ADR(b2); END_IF; q^ S= FALSE;",
      "pt := ADR(ta); IF ct THEN pt := ADR(tb); END_IF; pt^ R= TRUE;",
      "qt := ADR(ta2); IF ct THEN qt := ADR(tb2); END_IF; qt^ S= FALSE;",
    ].join("\n"),
  },
  // task 27: is there a pass cap on a loop? Exactly 1,000,000 passes and one past it, for FOR and REPEAT, and a WHILE
  // far beyond.
  { name: "tr_27_loop_cap_for_1000000", vars: "i : DINT; cnt : DINT;", body: "FOR i := 1 TO 1000000 DO cnt := cnt + 1; END_FOR" },
  { name: "tr_27_loop_cap_for_1000001", vars: "i : DINT; cnt : DINT;", body: "FOR i := 1 TO 1000001 DO cnt := cnt + 1; END_FOR" },
  { name: "tr_27_loop_cap_repeat_1000001", vars: "cnt : DINT;", body: "REPEAT cnt := cnt + 1; UNTIL cnt >= 1000001 END_REPEAT" },
  { name: "tr_27_loop_cap_while_5000000", vars: "cnt : DINT;", body: "WHILE cnt < 5000000 DO cnt := cnt + 1; END_WHILE" },
  // transpile-restructure 2.1 (model 1, loops). A FOR to its INT counter's maximum: does the counter wrap past 32767
  // so the loop never ends (the EXIT guard stops it at 32800 passes, `last` = -32737), or does it end after 32768
  // passes (`last` = 32767)? Decides whether a FOR may be printed as a Rust `for` range (lean 5.4). Compare
  // `for_at_type_max` (the SINT case).
  {
    name: "for_counter_at_type_max",
    vars: "i : INT; cnt : DINT; last : INT;",
    body: "FOR i := 0 TO 32767 DO cnt := cnt + 1; last := i; IF cnt >= 32800 THEN EXIT; END_IF END_FOR",
  },
  // The body changes the step VARIABLE on every pass (stride = 1, 3, 5, …). Read every pass: i = 1, 4, 9, 16 — 4
  // passes, `last` 16, the counter left at 25. Read once: 20 passes, `last` 20, the counter left at 21. (Not `s`:
  // CODESYS reads a lone `S` as the set operator — "Unexpected token 's' found", record:exec 2026-10-08.)
  {
    name: "for_runtime_step_changed_in_body",
    vars: "i : INT; stride : INT := 1; cnt : INT; last : INT;",
    body: "FOR i := 1 TO 20 BY stride DO cnt := cnt + 1; last := i; stride := stride + 2; END_FOR",
  },
  // An INT variable step on an INT counter, up and down (the step type is the counter type, so nothing converts):
  // up 0, 3, 6, 9 (4 passes, left at 12); down 10, 6, 2 (3 passes, left at -2).
  {
    name: "for_runtime_step_same_type",
    vars: "i : INT; upStep : INT := 3; up : INT; lastUp : INT; j : INT; downStep : INT := -4; down : INT; lastDown : INT;",
    body: [
      "FOR i := 0 TO 10 BY upStep DO up := up + 1; lastUp := i; END_FOR",
      "FOR j := 10 TO 0 BY downStep DO down := down + 1; lastDown := j; END_FOR",
    ].join("\n"),
  },
  // task 28: MAX / MIN / LIMIT given a NaN or a signed zero, both argument orders, LREAL and REAL. NaN is SQRT of a
  // computed negative and -0.0 is +0.0 times a computed -1 — never folded, and never 1.0/0.0 (it stops the runtime).
  // NaN and -0 do not compare, so every result is also read as its BITS through a pointer (`wN`).
  {
    name: "tr_28_minmax_limit_nan_signed_zero_lreal",
    vars: [
      "seed : LREAL := 1.0; n : LREAL; pz : LREAL := 0.0; nz : LREAL;",
      "r1 : LREAL; r2 : LREAL; r3 : LREAL; r4 : LREAL; r5 : LREAL; r6 : LREAL; r7 : LREAL; r8 : LREAL; r9 : LREAL;",
      "pw : POINTER TO LWORD; wn : LWORD; wnz : LWORD;",
      "w1 : LWORD; w2 : LWORD; w3 : LWORD; w4 : LWORD; w5 : LWORD; w6 : LWORD; w7 : LWORD; w8 : LWORD; w9 : LWORD;",
    ].join("\n"),
    body: [
      "n := SQRT(0.0 - seed); nz := pz * (0.0 - seed);",
      "r1 := MAX(n, 1); r2 := MAX(1, n); r3 := MIN(n, 1); r4 := MIN(1, n);",
      "r5 := LIMIT(0, n, 5); r6 := LIMIT(n, 1, 5); r7 := LIMIT(0, 1, n);",
      "r8 := MAX(nz, pz); r9 := MAX(pz, nz);",
      "pw := ADR(n); wn := pw^; pw := ADR(nz); wnz := pw^;",
      "pw := ADR(r1); w1 := pw^; pw := ADR(r2); w2 := pw^; pw := ADR(r3); w3 := pw^;",
      "pw := ADR(r4); w4 := pw^; pw := ADR(r5); w5 := pw^; pw := ADR(r6); w6 := pw^;",
      "pw := ADR(r7); w7 := pw^; pw := ADR(r8); w8 := pw^; pw := ADR(r9); w9 := pw^;",
    ].join("\n"),
  },
  {
    name: "tr_28_minmax_limit_nan_signed_zero_real",
    vars: [
      "seed : REAL := 1.0; n : REAL; pz : REAL := 0.0; nz : REAL;",
      "r1 : REAL; r2 : REAL; r3 : REAL; r4 : REAL; r5 : REAL; r6 : REAL; r7 : REAL; r8 : REAL; r9 : REAL;",
      "pw : POINTER TO DWORD; wn : DWORD; wnz : DWORD;",
      "w1 : DWORD; w2 : DWORD; w3 : DWORD; w4 : DWORD; w5 : DWORD; w6 : DWORD; w7 : DWORD; w8 : DWORD; w9 : DWORD;",
    ].join("\n"),
    body: [
      "n := SQRT(0.0 - seed); nz := pz * (0.0 - seed);",
      "r1 := MAX(n, 1); r2 := MAX(1, n); r3 := MIN(n, 1); r4 := MIN(1, n);",
      "r5 := LIMIT(0, n, 5); r6 := LIMIT(n, 1, 5); r7 := LIMIT(0, 1, n);",
      "r8 := MAX(nz, pz); r9 := MAX(pz, nz);",
      "pw := ADR(n); wn := pw^; pw := ADR(nz); wnz := pw^;",
      "pw := ADR(r1); w1 := pw^; pw := ADR(r2); w2 := pw^; pw := ADR(r3); w3 := pw^;",
      "pw := ADR(r4); w4 := pw^; pw := ADR(r5); w5 := pw^; pw := ADR(r6); w6 := pw^;",
      "pw := ADR(r7); w7 := pw^; pw := ADR(r8); w8 := pw^; pw := ADR(r9); w9 := pw^;",
    ].join("\n"),
  },
  // task 35: a constant FOR step taken in an UNSIGNED counter's type — is -1 on a BYTE a step down, or 255 up? One loop
  // each; a runtime INT step on a BYTE counter and an out-of-range step on a SINT are the build's questions.
  { name: "tr_35_for_byte_step_minus_one", vars: "b : BYTE; n : INT;", body: "FOR b := 5 TO 1 BY -1 DO n := n + 1; END_FOR" },
  { name: "tr_35_for_uint_step_minus_two", vars: "u : UINT; n : INT;", body: "FOR u := 10 TO 2 BY -2 DO n := n + 1; END_FOR" },
  { name: "tr_35_for_byte_step_255", vars: "b : BYTE; n : INT;", body: "FOR b := 1 TO 10 BY 255 DO n := n + 1; END_FOR" },
  {
    name: "tr_35_for_byte_runtime_int_step",
    vars: "b : BYTE; n : INT; stp : INT := -1;",
    body: "FOR b := 5 TO 1 BY stp DO n := n + 1; END_FOR",
    rejects: "Cannot convert type 'INT' to type 'BYTE'",
  },
  {
    name: "tr_35_for_sint_step_300",
    vars: "sc : SINT; n : INT;",
    body: "FOR sc := 1 TO 10 BY 300 DO n := n + 1; END_FOR",
    rejects: "Cannot convert type 'INT' to type 'SINT'",
  },
  // task 36: a literal FOR limit beyond the counter's type (200 on a SINT) — compared as 200 (the counter wraps and only
  // EXIT ends the loop) or narrowed into SINT first (-56, no pass)? The recordable twin of `cc6_loop_cannot_exit`; the
  // second loop is the control, its limit a constant EXPRESSION of the same value.
  {
    name: "tr_36_for_literal_limit_beyond_counter",
    vars: "small : SINT; n : INT; small2 : SINT; n2 : INT;",
    body: [
      "FOR small := 1 TO 200 DO n := n + 1; IF n >= 300 THEN EXIT; END_IF END_FOR",
      "FOR small2 := 1 TO (100 + 100) DO n2 := n2 + 1; IF n2 >= 300 THEN EXIT; END_IF END_FOR",
    ].join("\n"),
  },
  // task 37: CASE labels outside the selector's type — does a label whose WRAPPED value equals the selector (300 and
  // -212 are both 44 as a SINT) match? The inverted range and the range past the type are the build's questions.
  { name: "tr_37_case_label_wraps_300", vars: "sv : SINT := 44; r1 : INT;", body: "CASE sv OF 300: r1 := 1; ELSE r1 := 2; END_CASE" },
  { name: "tr_37_case_label_wraps_minus_212", vars: "sv : SINT := 44; r2 : INT;", body: "CASE sv OF -212: r2 := 1; ELSE r2 := 2; END_CASE" },
  {
    name: "tr_37_case_range_inverted",
    vars: "sv : SINT := 3; r3 : INT;",
    body: "CASE sv OF 5..1: r3 := 1; ELSE r3 := 2; END_CASE",
    rejects: "Lower border must be lower than upper border",
  },
  {
    name: "tr_37_case_range_beyond_type",
    vars: "sv : SINT := 44; r4 : INT;",
    body: "CASE sv OF 0..200: r4 := 1; ELSE r4 := 2; END_CASE",
    rejects: "Lower border must be lower than upper border",
  },
  // task 40: DATE / DT / TOD plus or minus an LTIME — taken, or refused? One form each, and LTIME on the left.
  { name: "tr_40_date_plus_ltime", vars: "d : DATE; dur : LTIME := LTIME#1D;", body: "d := d + dur;", rejects: "Cannot convert type 'LTIME' to type 'ULINT'" },
  { name: "tr_40_dt_plus_ltime", vars: "dt1 : DT; dur : LTIME := LTIME#1D;", body: "dt1 := dt1 + dur;", rejects: "Cannot convert type 'LTIME' to type 'ULINT'" },
  { name: "tr_40_tod_minus_ltime", vars: "t : TOD; dur : LTIME := LTIME#1H;", body: "t := t - dur;", rejects: "Cannot convert type 'LTIME' to type 'ULINT'" },
  { name: "tr_40_ltime_plus_date", vars: "d : DATE; dur : LTIME := LTIME#1D;", body: "d := dur + d;", rejects: "Cannot convert type 'LTIME' to type 'ULINT'" },
  // task 46: EXPT's domain edges — the IEEE pow special cases (1^NaN, (-1)^±inf, NaN^0) in LREAL and REAL, an exact
  // huge power, and a zero base to a negative exponent (does it stop the scan like `mathdom_ln_zero`, or answer
  // infinity?). Base and exponent are computed from `seed` so nothing folds: NaN is SQRT of a negative, ±inf is
  // ±EXP(1000) (which completes — `mathdom_exp_overflow`), never a division by zero. The topical home is
  // operators/math-domain.ts (its header says it omits EXPT).
  { name: "tr_46_exptdom_one_pow_nan", vars: "seed : LREAL := 1.0; b : LREAL; e : LREAL; res : LREAL;", body: "b := seed; e := SQRT(0.0 - seed); res := EXPT(b, e);" },
  { name: "tr_46_exptdom_minus_one_pow_inf", vars: "seed : LREAL := 1.0; b : LREAL; e : LREAL; res : LREAL;", body: "b := 0.0 - seed; e := EXP(seed * 1000.0); res := EXPT(b, e);" },
  { name: "tr_46_exptdom_minus_one_pow_minus_inf", vars: "seed : LREAL := 1.0; b : LREAL; e : LREAL; res : LREAL;", body: "b := 0.0 - seed; e := 0.0 - EXP(seed * 1000.0); res := EXPT(b, e);" },
  { name: "tr_46_exptdom_nan_pow_zero", vars: "seed : LREAL := 1.0; b : LREAL; e : LREAL; res : LREAL;", body: "b := SQRT(0.0 - seed); e := seed - seed; res := EXPT(b, e);" },
  { name: "tr_46_exptdom_real_one_pow_nan", vars: "seed : REAL := 1.0; b : REAL; e : REAL; res : REAL;", body: "b := seed; e := SQRT(0.0 - seed); res := EXPT(b, e);" },
  { name: "tr_46_exptdom_1e19_pow_8", vars: "seed : LREAL := 1.0; b : LREAL; e : LREAL; res : LREAL;", body: "b := seed * 1.0E19; e := seed * 8.0; res := EXPT(b, e);" },
  { name: "tr_46_exptdom_zero_pow_minus_inf", vars: "seed : LREAL := 1.0; b : LREAL; e : LREAL; res : LREAL;", body: "b := seed - seed; e := 0.0 - EXP(seed * 1000.0); res := EXPT(b, e);" },
  { name: "tr_46_exptdom_zero_pow_minus_one", vars: "seed : LREAL := 1.0; b : LREAL; e : LREAL; res : LREAL;", body: "b := seed - seed; e := 0.0 - seed; res := EXPT(b, e);" },
  { name: "tr_46_exptdom_zero_pow_minus_half", vars: "seed : LREAL := 1.0; b : LREAL; e : LREAL; res : LREAL;", body: "b := seed - seed; e := 0.0 - seed * 0.5; res := EXPT(b, e);" },
  // task 47: a 64-bit integer to REAL — rounded once, or twice (via LREAL first)? 2^60 + 2^36 + 1 sits where the two
  // differ (the round to LREAL lands exactly on REAL's halfway point); the extremes `i2r_*_max` round identically and
  // cannot tell. LINT, its negative, ULINT and LWORD. The topical home is conversions/integer-to-real.ts.
  {
    name: "tr_47_i2r_lint_to_real_double_round",
    vars: [
      "v : LINT := 1152921573326323713; vn : LINT := -1152921573326323713; vu : ULINT := 1152921573326323713;",
      "vw : LWORD := 1152921573326323713; out : REAL; outNeg : REAL; outU : REAL; outW : REAL;",
    ].join("\n"),
    body: "out := LINT_TO_REAL(v); outNeg := LINT_TO_REAL(vn); outU := ULINT_TO_REAL(vu); outW := LWORD_TO_REAL(vw);",
  },
  // transpile-restructure 6.A.1 (Appendix A): a conversion from a finer tick to a coarser one — LTIME to TIME, and every
  // long date type to a 32-bit one — drops the sub-unit remainder: truncated, or rounded? Each source holds a remainder
  // just below one target unit (…999999 ns), exactly half of one (…500 µs) and below half; one question per pair.
  {
    name: "tr_a1_ltime_to_time_subunit",
    vars: "below : LTIME := LTIME#1S500MS999US999NS; half : LTIME := LTIME#2MS500US; tiny : LTIME := LTIME#999US999NS; t1 : TIME; t2 : TIME; t3 : TIME;",
    body: "t1 := LTIME_TO_TIME(below); t2 := LTIME_TO_TIME(half); t3 := LTIME_TO_TIME(tiny);",
  },
  {
    name: "tr_a1_ldt_to_dt_subunit",
    vars: "below : LDT := LDT#2024-02-29-13:05:09.999999999; half : LDT := LDT#2024-02-29-13:05:09.5; d1 : DT; d2 : DT;",
    body: "d1 := LDT_TO_DT(below); d2 := LDT_TO_DT(half);",
  },
  {
    name: "tr_a1_ldt_to_tod_date_subunit",
    vars: "below : LDT := LDT#2024-02-29-23:59:59.999999999; half : LDT := LDT#2024-02-29-13:05:09.0005; tod1 : TOD; tod2 : TOD; day1 : DATE;",
    body: "tod1 := LDT_TO_TOD(below); tod2 := LDT_TO_TOD(half); day1 := LDT_TO_DATE(below);",
  },
  {
    name: "tr_a1_ltod_to_tod_dt_subunit",
    vars: "below : LTOD := LTOD#23:59:59.999999999; half : LTOD := LTOD#00:00:00.0005; tod1 : TOD; tod2 : TOD; dt1 : DT;",
    body: "tod1 := LTOD_TO_TOD(below); tod2 := LTOD_TO_TOD(half); dt1 := LTOD_TO_DT(below);",
  },
  // transpile-restructure 6.A.2 (Appendix A): is a REAL expression's intermediate rounded to a 32-bit float at every step
  // (SSE), or carried wider (x87) until the store? `(big + one) - big` is 0 per step and 1 carried; `huge * three / three`
  // is Infinity per step and 3E38 carried; a REAL sum stored into an LREAL shows whether the sum was a REAL at all.
  {
    name: "tr_a2_real_intermediate_per_step",
    vars: [
      "big : REAL := 1.0E8; one : REAL := 1.0; huge : REAL := 3.0E38; three : REAL := 3.0; lrZero : LREAL;",
      "d1 : REAL; d2 : REAL; lr1 : LREAL; lr2 : LREAL; lr3 : LREAL;",
    ].join(" "),
    body: "d1 := (big + one) - big; d2 := huge * three / three; lr1 := big + one; lr2 := huge * three; lr3 := (big + one) + lrZero;",
  },
  // transpile-restructure 6.A.10 (Appendix A): STRING_TO_<int> of text written as a based or typed literal — does the
  // parse read '16#FF' as 255 or stop at the '#' (16)? Every base, a type prefix, a typed based one, lower-case hex
  // digits, an underscore separator, a sign before a base and a leading space; then the bit-string targets.
  {
    name: "tr_a10_string_to_int_literal_forms",
    vars: [
      "sHex : STRING := '16#FF'; sBin : STRING := '2#101'; sOct : STRING := '8#17'; sTyped : STRING := 'INT#5';",
      "sTypedHex : STRING := 'INT#16#1F'; sLowerHex : STRING := '16#ff'; sUnder : STRING := '1_000'; sNegHex : STRING := '-16#F';",
      "sSpaceHex : STRING := ' 16#FF'; sBadHex : STRING := '16#G';",
      "iHex : INT; iBin : INT; iOct : INT; iTyped : INT; iTypedHex : INT; iLowerHex : INT; iUnder : INT; iNegHex : INT; iSpaceHex : INT; iBadHex : INT;",
    ].join(" "),
    body: [
      "iHex := STRING_TO_INT(sHex); iBin := STRING_TO_INT(sBin); iOct := STRING_TO_INT(sOct); iTyped := STRING_TO_INT(sTyped);",
      "iTypedHex := STRING_TO_INT(sTypedHex); iLowerHex := STRING_TO_INT(sLowerHex); iUnder := STRING_TO_INT(sUnder);",
      "iNegHex := STRING_TO_INT(sNegHex); iSpaceHex := STRING_TO_INT(sSpaceHex); iBadHex := STRING_TO_INT(sBadHex);",
    ].join(" "),
  },
  {
    name: "tr_a10_string_to_bits_literal_forms",
    vars: [
      "sHex : STRING := '16#FF'; sWide : STRING := '16#FFFFFF'; sBin : STRING := '2#1010'; sTyped : STRING := 'DWORD#16#10';",
      "wHex : WSTRING := \"16#FF\"; b : BYTE; dw : DWORD; d : DINT; w : WORD; dwTyped : DWORD; iWide : INT;",
    ].join(" "),
    body: "b := STRING_TO_BYTE(sHex); dw := STRING_TO_DWORD(sWide); d := STRING_TO_DINT(sWide); w := STRING_TO_WORD(sBin); dwTyped := STRING_TO_DWORD(sTyped); iWide := WSTRING_TO_INT(wHex);",
  },
  // transpile-restructure 6.A.21 (Appendix A): where a TYPED REAL literal stops fitting. f32's largest is
  // 3.4028234663852886E38; 3.4028235E38 lies above it but rounds to it, 3.4028236E38 rounds to Infinity. One per case.
  { name: "tr_a21_typed_real_below_max", vars: "rl : REAL := REAL#3.4028234E38; back : REAL;", body: "back := rl;" },
  { name: "tr_a21_typed_real_rounds_to_max", vars: "rl : REAL := REAL#3.4028235E38; back : REAL;", body: "back := rl;" },
  { name: "tr_a21_typed_real_rounds_to_infinity", vars: "rl : REAL := REAL#3.4028236E38; back : REAL;", body: "back := rl;" },
  { name: "tr_a21_typed_real_negative_rounds_to_max", vars: "rl : REAL := REAL#-3.4028235E38; back : REAL;", body: "back := rl;" },
  // transpile-restructure 6.A.18 (uniform write guards): the store kinds whose guard list (1.7.5) left a check out, asked
  // where the left-out check could matter — a character stored through a REFERENCE TO STRING (`s[i] :=` checks
  // `constant` only, not `through-reference`), and a FOR loop counting a REFERENCE TO INT (the FOR variable checks `union`
  // and `constant`, not `through-reference`). Does each write the referenced variable?
  {
    name: "tr_a18_char_store_through_reference",
    vars: "txt : STRING := 'abc'; rs : REFERENCE TO STRING; back : STRING;",
    body: "rs REF= txt; rs[1] := 88; back := txt;",
  },
  {
    name: "tr_a18_for_counter_through_reference",
    vars: "v : INT; rv : REFERENCE TO INT; n : INT; after : INT;",
    body: "rv REF= v; FOR rv := 1 TO 3 DO n := n + 1; END_FOR; after := v;",
  },
  // transpile-restructure 6.A.20 (Appendix A): MOD of two REAL constants in a declaration's initializer, where the
  // constant fold runs — refused as `MOD` on a REAL operand is in a body (`meet_*_mod_real`)?
  { name: "tr_a20_real_mod_in_initializer", vars: "rl : REAL := 5.5 MOD 2.0; back : REAL;", body: "back := rl;" },
  // transpile-restructure 6.A.23 (Appendix A): a NEGATED or PARENTHESISED untyped real literal handed to SIN / SQRT —
  // typed as the bare literal is (LREAL)? The values, and the same calls stored into an INT, which names the type.
  {
    name: "tr_a23_signed_real_literal_in_math",
    vars: "sn : REAL; q : LREAL; c : LREAL; e : REAL;",
    body: "sn := SIN(-1.5); q := SQRT((2.0)); c := COS(-(0.5)); e := EXP((-1.0));",
  },
  { name: "tr_a23_bare_real_literal_sin_into_int", vars: "i : INT;", body: "i := SIN(1.5);" },
  { name: "tr_a23_negated_real_literal_sin_into_int", vars: "i : INT;", body: "i := SIN(-1.5);" },
  { name: "tr_a23_parenthesised_real_literal_sqrt_into_int", vars: "i : INT;", body: "i := SQRT((2.0));" },
  // 6.A.10's second round (the first answered '16#FF' 255, '-16#F' -16, '16#G' 0, '1_000' 1000, 'INT#5' 0): where does
  // the based form stop — an underscore inside hex digits, doubled or at either end of a decimal, a base with no digits,
  // a digit outside its base, a '+' before a base, a base CODESYS has no literal for — read into a DINT, so no width cuts.
  {
    name: "tr_a10_string_to_dint_based_edges",
    vars: [
      "sHexUnder : STRING := '16#FF_FF'; sDoubleUnder : STRING := '1__0'; sLeadUnder : STRING := '_5'; sTrailUnder : STRING := '5_';",
      "sNoDigits : STRING := '16#'; sOctNine : STRING := '8#19'; sPlusHex : STRING := '+16#F'; sBase3 : STRING := '3#12';",
      "sBase10 : STRING := '10#99'; sHexTail : STRING := '16#1FZ'; sZeroHex : STRING := '016#F';",
      "dHexUnder : DINT; dDoubleUnder : DINT; dLeadUnder : DINT; dTrailUnder : DINT; dNoDigits : DINT; dOctNine : DINT; dPlusHex : DINT;",
      "dBase3 : DINT; dBase10 : DINT; dHexTail : DINT; dZeroHex : DINT;",
    ].join(" "),
    body: [
      "dHexUnder := STRING_TO_DINT(sHexUnder); dDoubleUnder := STRING_TO_DINT(sDoubleUnder); dLeadUnder := STRING_TO_DINT(sLeadUnder);",
      "dTrailUnder := STRING_TO_DINT(sTrailUnder); dNoDigits := STRING_TO_DINT(sNoDigits); dOctNine := STRING_TO_DINT(sOctNine);",
      "dPlusHex := STRING_TO_DINT(sPlusHex); dBase3 := STRING_TO_DINT(sBase3); dBase10 := STRING_TO_DINT(sBase10);",
      "dHexTail := STRING_TO_DINT(sHexTail); dZeroHex := STRING_TO_DINT(sZeroHex);",
    ].join(" "),
  },
  // …and a based number wider than its target: wrapped as a decimal one is (`xf_string_to_int_far_too_large`), or held?
  {
    name: "tr_a10_string_to_int_based_wider_than_target",
    vars: "sFFFF : STRING := '16#FFFF'; s8000 : STRING := '16#8000'; sBig : STRING := '16#123456789'; i1 : INT; i2 : INT; u1 : UINT; si : SINT; d1 : DINT;",
    body: "i1 := STRING_TO_INT(sFFFF); i2 := STRING_TO_INT(s8000); u1 := STRING_TO_UINT(sFFFF); si := STRING_TO_SINT(sFFFF); d1 := STRING_TO_DINT(sBig);",
  },
  // 6.A.10's third round (the second: '_5' 5, '1__0' 10, '16#FF_FF' 65535, '+16#F' 16, '016#F' 16, '3#12' 3): an
  // underscore after a sign or a space, alone, doubled before a digit, first in a based number's digits, and a space
  // inside the digits; then the 64-bit targets of a based number that fills or passes 64 bits.
  {
    name: "tr_a10_string_to_dint_underscore_sign_edges",
    vars: [
      "sNegUnder : STRING := '-1_0'; sPlusLead : STRING := '+_5'; sSpaceLead : STRING := ' _5'; sOnly : STRING := '_';",
      "sNegLead : STRING := '-_5'; sHexLead : STRING := '16#_F'; sBinUnder : STRING := '2#1_0'; sDoubleLead : STRING := '__5';",
      "sSpaceInside : STRING := '1 0'; sTabLead : STRING := '$T16#F';",
      "dNegUnder : DINT; dPlusLead : DINT; dSpaceLead : DINT; dOnly : DINT; dNegLead : DINT; dHexLead : DINT; dBinUnder : DINT;",
      "dDoubleLead : DINT; dSpaceInside : DINT; dTabLead : DINT;",
    ].join(" "),
    body: [
      "dNegUnder := STRING_TO_DINT(sNegUnder); dPlusLead := STRING_TO_DINT(sPlusLead); dSpaceLead := STRING_TO_DINT(sSpaceLead);",
      "dOnly := STRING_TO_DINT(sOnly); dNegLead := STRING_TO_DINT(sNegLead); dHexLead := STRING_TO_DINT(sHexLead);",
      "dBinUnder := STRING_TO_DINT(sBinUnder); dDoubleLead := STRING_TO_DINT(sDoubleLead); dSpaceInside := STRING_TO_DINT(sSpaceInside);",
      "dTabLead := STRING_TO_DINT(sTabLead);",
    ].join(" "),
  },
  {
    name: "tr_a10_string_to_64bit_based",
    vars: [
      "sAllOnes : STRING := '16#FFFFFFFFFFFFFFFF'; sSign : STRING := '16#8000000000000000'; sPast : STRING := '16#1FFFFFFFFFFFFFFFF';",
      "sDecMax : STRING := '18446744073709551615'; lw : LWORD; ul : ULINT; li : LINT; lPast : LWORD; ulDec : ULINT; liDec : LINT;",
    ].join(" "),
    body: "lw := STRING_TO_LWORD(sAllOnes); ul := STRING_TO_ULINT(sAllOnes); li := STRING_TO_LINT(sSign); lPast := STRING_TO_LWORD(sPast); ulDec := STRING_TO_ULINT(sDecMax); liDec := STRING_TO_LINT(sDecMax);",
  },
]
