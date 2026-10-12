/**
 * the fixtures of `execution.ts` — part F.
 *
 * One slice of `execution.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import { CONSTANT_PAST_64_BITS, ExecCase } from "./execution-shared.js"

export const CASES_F: readonly ExecCase[] = [
  // 6.A.14's second round (the first: SHL(1, 40) into an LWORD or LINT is 2^40, into a DWORD 0): is that the CONSTANT
  // fold (every operand a literal) or the literal's type? The same literal with a COUNT that is a variable, a constant
  // count past 63, and into a DWORD with a variable count.
  {
    name: "tr_a14_shift_untyped_literal_variable_count",
    vars: "n40 : INT := 40; n33 : INT := 33; lw5 : LWORD; dw2 : DWORD; lw6 : LWORD; lw7 : LWORD; li2 : LINT;",
    body: "lw5 := SHL(1, n40); dw2 := SHL(1, n33); lw6 := SHL(1, 65); lw7 := SHR(SHL(1, 40), 8); li2 := SHL(1, n40);",
  },
  // transpile-restructure 6.A.14 (Appendix A): SHL / SHR of an UNTYPED literal stored into a 64-bit destination — is the
  // literal shifted as a DINT (the count masked to 31, so SHL(1, 40) is 256) or in the destination's width (2^40)?
  {
    name: "tr_a14_shift_untyped_literal_wide",
    vars: "lw1 : LWORD; lw2 : LWORD; li : LINT; uli : ULINT; dw : DWORD; lw3 : LWORD; lw4 : LWORD;",
    body: "lw1 := SHL(1, 40); lw2 := SHL(1, 33); li := SHL(1, 40); uli := SHL(3, 62); dw := SHL(1, 40); lw3 := SHR(16#80000000, 4); lw4 := SHL(16#FF, 28);",
  },
  // transpile-restructure 6.A.27 (Appendix A: "FOR with an unsigned counter and a negative constant step emits `-1u8`",
  // closed by RC 35 for BYTE and UINT — `tr_35_for_byte_step_minus_one`, `_uint_step_minus_two`): every other unsigned
  // counter, a step larger than one, a named CONSTANT step and a negated parenthesised one. Each loop's last decrement
  // stays at or above 0, so no reading of the wrap can loop forever.
  {
    name: "tr_a27_for_unsigned_counters_negative_step",
    vars: "us : USINT; w : WORD; ud : UDINT; dw : DWORD; ul : ULINT; lw : LWORD; nUs : INT; nW : INT; nUd : INT; nDw : INT; nUl : INT; nLw : INT;",
    body: [
      "FOR us := 5 TO 1 BY -1 DO nUs := nUs + 1; END_FOR FOR w := 9 TO 2 BY -3 DO nW := nW + 1; END_FOR",
      "FOR ud := 100 TO 50 BY -45 DO nUd := nUd + 1; END_FOR FOR dw := 7 TO 3 BY -2 DO nDw := nDw + 1; END_FOR",
      "FOR ul := 20 TO 5 BY -5 DO nUl := nUl + 1; END_FOR FOR lw := 4 TO 1 BY -1 DO nLw := nLw + 1; END_FOR",
    ].join(" "),
  },
  {
    name: "tr_a27_for_byte_named_constant_step",
    vars: "b : BYTE; n : INT; END_VAR VAR CONSTANT STEPB : SINT := -2;",
    body: "FOR b := 8 TO 3 BY STEPB DO n := n + 1; END_FOR",
  },
  {
    name: "tr_a27_for_uint_negated_parenthesised_step",
    vars: "u : UINT; n : INT;",
    body: "FOR u := 9 TO 1 BY -(3) DO n := n + 1; END_FOR",
  },
  // transpile-restructure 6.A.29 (Appendix A, grouped: "a named DINT/LINT constant folds unbounded in an initializer but
  // wraps at run time"). `named_const_expression_keeps` measured a SINT/USINT constant EXPRESSION that overflows: it is
  // its unwrapped fold (D : SINT := 127 + 1 is SINT#128). Asked here where no wider slot exists or the fold passes 64
  // bits: each constant read in an initializer (`x1`), at run time (`x2`), and through another constant (`F`).
  {
    name: "tr_a29_lint_constant_expression_overflow",
    execSkip: CONSTANT_PAST_64_BITS,
    vars: "x1 : LINT := D; x2 : LINT; f1 : LINT := F; f2 : LINT; END_VAR VAR CONSTANT K : LINT := 9223372036854775807; D : LINT := K + 1; F : LINT := D - 1;",
    body: "x2 := D; f2 := F;",
  },
  {
    name: "tr_a29_ulint_constant_expression_overflow",
    execSkip: CONSTANT_PAST_64_BITS,
    vars: "x1 : ULINT := D; x2 : ULINT; END_VAR VAR CONSTANT K : ULINT := 18446744073709551615; D : ULINT := K + 1;",
    body: "x2 := D;",
  },
  {
    name: "tr_a29_dint_constant_expression_overflow",
    vars: "x1 : LINT := D; x2 : LINT; f1 : LINT := F; f2 : LINT; END_VAR VAR CONSTANT K : DINT := 2147483647; D : DINT := K + 1; F : DINT := D - 1;",
    body: "x2 := D; f2 := F;",
  },
  {
    name: "tr_a29_dint_constant_overflow_into_dint",
    vars: "y1 : DINT := D; y2 : DINT; END_VAR VAR CONSTANT K : DINT := 2147483647; D : DINT := K + 1;",
    body: "y2 := D;",
  },
  {
    name: "tr_a29_dint_constant_overflow_past_lint",
    execSkip: CONSTANT_PAST_64_BITS,
    vars: "q1 : LINT := Q; q2 : LINT; END_VAR VAR CONSTANT K : DINT := 2147483647; Q : DINT := K * K * 4;",
    body: "q2 := Q;",
  },
  {
    name: "tr_a29_int_constant_expression_overflow",
    vars: "x1 : DINT := I; x2 : DINT; END_VAR VAR CONSTANT K : INT := 32767; I : INT := K + 1;",
    body: "x2 := I;",
  },
  {
    name: "tr_a29_byte_constant_expression_overflow",
    vars: "x1 : WORD := B; x2 : WORD; END_VAR VAR CONSTANT K : BYTE := 255; B : BYTE := K + 1;",
    body: "x2 := B;",
  },
  {
    name: "tr_a29_dword_constant_expression_overflow",
    vars: "x1 : LWORD := W; x2 : LWORD; END_VAR VAR CONSTANT K : DWORD := 16#FFFFFFFF; W : DWORD := K + 1;",
    body: "x2 := W;",
  },
  {
    name: "tr_a29_udint_constant_expression_overflow",
    vars: "x1 : ULINT := D; x2 : ULINT; END_VAR VAR CONSTANT K : UDINT := 4294967295; D : UDINT := K + 1;",
    body: "x2 := D;",
  },
  // transpile-restructure 6.A.30 (Appendix B, rotate-in-promoted-width; 6.A.14 left ROL / ROR of an untyped literal to
  // it): in what width does ROL / ROR rotate an UNTYPED literal — its own narrowest type, or the destination's? 129
  // rotated left by 1 is 3 in 8 bits and 258 wider; 1 rotated right by 1 is 2^(width - 1). With a literal count and a
  // variable one.
  {
    name: "tr_a30_rotate_untyped_literal",
    vars: "b1 : BYTE; w1 : WORD; d1 : DWORD; l1 : LWORD; b2 : BYTE; w2 : WORD; d2 : DWORD; l2 : LWORD; d3 : DWORD; l3 : LWORD;",
    body: "b1 := ROL(129, 1); w1 := ROL(129, 1); d1 := ROL(129, 1); l1 := ROL(129, 1); b2 := ROR(1, 1); w2 := ROR(1, 1); d2 := ROR(1, 1); l2 := ROR(1, 1); d3 := ROL(16#80000001, 1); l3 := ROL(16#80000001, 1);",
  },
  {
    name: "tr_a30_rotate_untyped_literal_variable_count",
    vars: "n1 : INT := 1; b1 : BYTE; w1 : WORD; d1 : DWORD; l1 : LWORD; b2 : BYTE; w2 : WORD; d2 : DWORD; l2 : LWORD;",
    body: "b1 := ROL(129, n1); w1 := ROL(129, n1); d1 := ROL(129, n1); l1 := ROL(129, n1); b2 := ROR(1, n1); w2 := ROR(1, n1); d2 := ROR(1, n1); l2 := ROR(1, n1);",
  },
  // …the same rotations as a VARIABLE's initializer and a CONSTANT's (read back at run time), as an operand beside a
  // WORD / DWORD, and stored into a signed integer
  {
    name: "tr_a30_rotate_untyped_literal_initializer",
    vars: "w1 : WORD := ROL(129, 1); d1 : DWORD := ROR(1, 1); l1 : LWORD := ROL(16#80000001, 1); w2 : WORD; d2 : DWORD; l2 : LWORD; END_VAR VAR CONSTANT CW : WORD := ROL(129, 1); CD : DWORD := ROR(1, 1); CL : LWORD := ROL(16#80000001, 1);",
    body: "w2 := CW; d2 := CD; l2 := CL;",
  },
  {
    name: "tr_a30_rotate_untyped_literal_in_expression",
    vars: "w0 : WORD; d0 : DWORD; w3 : WORD; d3 : DWORD;",
    body: "w3 := ROL(129, 1) OR w0; d3 := d0 OR ROR(1, 1);",
  },
  // 6Af gate review: `_in_expression` cannot tell the destination's width from the other operand's (both are WORD, both
  // DWORD). Here they differ: ROR(1, 1) is 2^31 in a DWORD and 32768 in a WORD — beside a WORD into a DWORD (d4, d6),
  // beside a DWORD into an LWORD (l7: 2^31, or 2^63). (`w5 := ROR(1, 1) OR d0` into a WORD does not build on CODESYS:
  // "Cannot convert type 'UDINT' to type 'WORD'", recorded 2026-10-10 and dropped from the case.)
  {
    name: "tr_a30_rotate_untyped_literal_operand_width",
    vars: "w0 : WORD; d0 : DWORD; d4 : DWORD; d6 : DWORD; l7 : LWORD;",
    body: "d4 := ROR(1, 1) OR w0; d6 := w0 OR ROR(1, 1); l7 := ROR(1, 1) OR d0;",
  },
  // 6Af gate review (6.A.29): a BYTE / DINT CONSTANT held past its type (B 256, D 2^31) under SIZEOF and the
  // width-sensitive operations — in a body and in an initializer, directly and through another CONSTANT
  {
    name: "tr_a29_widened_constant_reads",
    vars: "s1 : ULINT; s2 : ULINT; r1 : DWORD; r2 : DWORD; n1 : DWORD; h1 : DWORD; r3 : DWORD := ROL(B, 1); r4 : DWORD; END_VAR VAR CONSTANT K : DINT := 2147483647; D : DINT := K + 1; KB : BYTE := 255; B : BYTE := KB + 1; RB : DWORD := ROL(B, 1);",
    body: "s1 := SIZEOF(D); s2 := SIZEOF(B); r1 := ROL(B, 1); r2 := ROR(B, 1); n1 := NOT B; h1 := SHR(B, 1); r4 := RB;",
  },
  {
    name: "tr_a30_rotate_untyped_literal_into_int",
    vars: "i1 : INT; di : DINT;",
    body: "i1 := ROL(129, 1); di := ROR(1, 1);",
  },
  // 6Bb gate review (6.B.5): a duration scaled by a BIT STRING — one shape per case, so a refusal of one does not hide
  // the others. `big` (all bits set) tells an unsigned divisor from a signed -1.
  ...(
    [
      ["tr_b5_time_times_byte", "TIME", "BYTE", "res := t * n; res2 := t * big;"],
      ["tr_b5_time_times_word", "TIME", "WORD", "res := t * n; res2 := t * big;"],
      ["tr_b5_time_times_dword", "TIME", "DWORD", "res := t * n; res2 := t * big;"],
      ["tr_b5_time_times_lword", "TIME", "LWORD", "res := t * n; res2 := t * big;"],
      ["tr_b5_dword_times_time", "TIME", "DWORD", "res := n * t; res2 := big * t;"],
      ["tr_b5_lword_times_time", "TIME", "LWORD", "res := n * t; res2 := big * t;"],
      ["tr_b5_time_div_word", "TIME", "WORD", "res := t / n; res2 := t / big;"],
      ["tr_b5_time_div_dword", "TIME", "DWORD", "res := t / n; res2 := t / big;"],
      ["tr_b5_time_div_lword", "TIME", "LWORD", "res := t / n; res2 := t / big;"],
      ["tr_b5_ltime_times_dword", "LTIME", "DWORD", "res := t * n; res2 := t / big;"],
      ["tr_b5_ltime_times_lword", "LTIME", "LWORD", "res := t * n; res2 := t / big;"],
    ] as const
  ).map(([name, duration, bits, body]) => ({
    name,
    vars: `t : ${duration} := ${duration === "TIME" ? "T" : "LTIME"}#3S; n : ${bits} := 3; big : ${bits} := ${
      { BYTE: "16#FF", WORD: "16#FFFF", DWORD: "16#FFFFFFFF", LWORD: "16#FFFFFFFFFFFFFFFF" }[bits]
    }; res : ${duration}; res2 : ${duration};`,
    body,
  })),
  // 6Bb gate review (6.B.5): an untyped integer LITERAL beside a TIME — one past 32 bits, one past DINT but within UDINT
  {
    name: "tr_b5_time_times_wide_literal",
    vars: "t : TIME := T#1MS; res : TIME;",
    body: "res := t * 5000000000;",
    lspDeferred:
      "niche: accepted loss (0 occurrences in the corpora) — both vendors refuse an untyped literal past 32 bits beside a TIME (\"Cannot convert type 'TIME' to type 'ULINT'\", recorded 2026-10-10); the LSP passes it (lowering refuses it, naming the literal's LINT)",
  },
  { name: "tr_b5_time_times_udint_literal", vars: "t : TIME := T#1MS; res : TIME;", body: "res := t * 3000000000;" },
  // 6Bb gate review (6.B.5): a duration divided (and multiplied) by a NEGATIVE signed integer no wider than it
  {
    name: "tr_b5_time_by_negative_signed",
    vars: "t : TIME := T#3S; si : SINT := -1; i : INT := -2; d : DINT := -1; r1 : TIME; r2 : TIME; r3 : TIME; r4 : TIME; r5 : TIME;",
    body: "r1 := t / si; r2 := t / i; r3 := t / d; r4 := t * si; r5 := t * d;",
  },
  // 6Bb gate review (6.B.1): REAL_TO_BIT into a BOOL (0.4, 0.0, -1.5)
  {
    name: "tr_b1_real_to_bit_into_bool",
    vars: "x : REAL := 0.4; z : REAL := 0.0; m : REAL := -1.5; b1 : BOOL; b2 : BOOL; b3 : BOOL;",
    body: "b1 := REAL_TO_BIT(x); b2 := REAL_TO_BIT(z); b3 := REAL_TO_BIT(m);",
  },
]
