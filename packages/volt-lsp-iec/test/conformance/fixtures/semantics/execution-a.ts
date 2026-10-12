/**
 * the fixtures of `execution.ts` — part A: arithmetic at type boundaries; the width arithmetic happens IN: wrap in the operand type, or promote first? A store into the SAME type; integer division and MOD signs; REAL / LREAL precision; design §4's unverified corner: an all-constant expression in a REAL context; …and the moment ONE side of a division is REAL — a literal or a variable, in a body or an initializer; bit strings: do BYTE/WORD promote like SINT/INT, or wrap in their own width?; bitwise operators on narrow types, stored WIDER — so a sign extension shows; unary minus at the edge: -(-128) has no SINT answer.
 *
 * One slice of `execution.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { ExecCase } from "./execution-shared.js"

export const CASES_A: readonly ExecCase[] = [
{ name: "counter_across_cycles", cycles: 5, vars: "count : INT;", body: "count := count + 2;" },
  // ── arithmetic at type boundaries ──
  {
    name: "signed_overflow",
    vars: "si : SINT := 127; i : INT := 32767; di : DINT := 2147483647;",
    body: "si := si + 1; i := i + 1; di := di + 1;",
  },
  {
    name: "unsigned_underflow",
    vars: "us : USINT; ui : UINT; ud : UDINT;",
    body: "us := us - 1; ui := ui - 1; ud := ud - 1;",
  },
  // ── the width arithmetic happens IN: wrap in the operand type, or promote first? A store into the SAME type
  //    cannot tell (both give -128); a store into a WIDER one can. ──
  {
    name: "arithmetic_width",
    vars: "si : SINT := 127; us : USINT; i : INT := 32767; di : DINT := 2147483647; toInt : INT; toDint : DINT; fromInt : DINT; fromDint : LINT;",
    body: "toInt := si + 1; toDint := us - 1; fromInt := i + 1; fromDint := di + 1;",
  },
  {
    name: "constant_arithmetic_width",
    vars: "i : INT; di : DINT; li : LINT;",
    body: "i := 100 + 100; di := 30000 + 30000; li := 2000000000 + 2000000000;",
  },
  // transpile-review-2026-09-29 task 5: an all-constant expression whose literal needs ULINT/LWORD (≥ 2^63) — does
  // it fold at that width, a comparison, a division and MAX alike, decimal and hex?
  {
    name: "const_literal_wider_than_lint",
    vars: "isgt : BOOL; half : ULINT; mx : ULINT; hexgt : BOOL; hexdiv : LWORD; signbit : BOOL;",
    body: [
      "isgt := 18446744073709551615 > 5;",
      "half := 18446744073709551615 / 2;",
      "mx := MAX(18446744073709551615, 5);",
      "hexgt := 16#FFFFFFFFFFFFFFFF > 16#7FFFFFFFFFFFFFFF;",
      "hexdiv := 16#FFFFFFFFFFFFFFFF / 16;",
      "signbit := 16#8000000000000000 > 1;",
    ].join(" "),
  },
  // transpile-review-2026-09-29 task 7: is a negative literal a CONSTANT (the all-constant fold and MIN/MAX's meet
  // apply) or a runtime negation of one?
  {
    name: "negative_literal_constant_fold",
    vars: "a : LINT; b : LINT; c : LINT; d : LINT; e : LINT; f : LINT; h : LINT;",
    body: [
      "a := MAX(-5, 3000000000);",
      "b := MAX(-1, 3000000000, 7);",
      "c := -5 + 3000000000;",
      "d := 3000000000 + -5;",
      "e := 3000000000 - 5;",
      "f := -2000000000 - 2000000000;",
      "h := MIN(-5, 3000000000);",
    ].join(" "),
  },
  // ── integer division and MOD signs ──
  {
    name: "division_and_mod_signs",
    vars: "a : INT := -7; b : INT := 2; c : INT := 7; d : INT := -2; q1 : INT; q2 : INT; m1 : INT; m2 : INT;",
    body: "q1 := a / b; q2 := c / d; m1 := a MOD b; m2 := c MOD d;",
  },
  // ── REAL / LREAL precision ──
  {
    name: "real_precision",
    // Not `r`: CODESYS reserves `R` (and `S`) — the set/reset keywords — so `r : REAL` does not compile.
    vars: "sum32 : REAL; sum64 : LREAL; third : REAL; lthird : LREAL;",
    body: "sum32 := 0.1 + 0.2; sum64 := 0.1 + 0.2; third := 1.0 / 3.0; lthird := 1.0 / 3.0;",
  },
  // ── design §4's unverified corner: an all-constant expression in a REAL context ──
  {
    name: "all_constant_division_in_real_context",
    vars: "init : REAL := 7 / 2; half32 : REAL; half64 : LREAL; n : INT := 7; rn : REAL;",
    body: "half32 := 7 / 2; half64 := 7 / 2; rn := n / 2;",
  },
  // ── …and the moment ONE side of a division is REAL — a literal or a variable, in a body or an initializer ──
  {
    name: "division_with_a_real_operand",
    vars: [
      "real7 : REAL := 7; int7 : INT := 7; int2 : INT := 2;",
      "initLitOverReal : REAL := 7 / 2.0; initRealOverLit : REAL := 7.0 / 2;",
      "litOverReal : REAL; realOverLit : REAL; realVarOverLit : REAL; realVarOverIntVar : REAL;",
      "intVarOverReal : REAL; lrealLitOverReal : LREAL; intVarOverIntVar : REAL;",
    ].join("\n"),
    body: [
      "litOverReal := 7 / 2.0;",
      "realOverLit := 7.0 / 2;",
      "realVarOverLit := real7 / 2;",
      "realVarOverIntVar := real7 / int2;",
      "intVarOverReal := int7 / 2.0;",
      "lrealLitOverReal := 7 / 2.0;",
      "intVarOverIntVar := int7 / int2;",
    ].join("\n"),
  },
  // (No implicit REAL → INT case: `i := someReal` does not compile — "Cannot convert type 'REAL' to type 'INT'",
  //  measured 2026-09-14. REAL → INT only happens through a built-in, so its rounding is measured in phase 2.)

  // ── bit strings: do BYTE/WORD promote like SINT/INT, or wrap in their own width? ──
  {
    name: "bit_string_arithmetic",
    vars: "b255 : BYTE := 255; b0 : BYTE; w0 : WORD; toWord : WORD; toDint : DINT; sameByte : BYTE; wordUnder : DINT;",
    body: "toWord := b255 + 1; toDint := b0 - 1; sameByte := b255 + 1; wordUnder := w0 - 1;",
  },
  // ── bitwise operators on narrow types, stored WIDER — so a sign extension shows ──
  {
    name: "bitwise_on_narrow_types",
    vars: [
      "minus1 : SINT := -1; u255 : USINT := 255; w65280 : WORD := 65280;",
      "andWide : INT; xorWide : DINT; notUsintWide : DINT; notWord : WORD; notSintWide : INT;",
    ].join("\n"),
    body: "andWide := minus1 AND 255; xorWide := u255 XOR 1; notUsintWide := NOT u255; notWord := NOT w65280; notSintWide := NOT minus1;",
  },
  // ── unary minus at the edge: -(-128) has no SINT answer ──
  // `negSame : SINT; negSame := -sMin` does NOT compile — "Cannot convert type 'INT' to type 'SINT'" — so a
  // negated SINT is typed INT (measured 2026-09-14). This records what the wider stores hold.
  {
    name: "unary_minus_at_the_edge",
    vars: [
      "sMin : SINT := -128; iMin : INT := -32768; dMin : DINT := -2147483647 - 1;",
      "negWide : INT; negSintAsDint : DINT; negIntWide : DINT; negDint : LINT;",
    ].join("\n"),
    body: "negWide := -sMin; negSintAsDint := -sMin; negIntWide := -iMin; negDint := -dMin;",
  },
  // transpile-review-2026-09-29 task 8: does `-x` on a 32/64-bit UNSIGNED operand compute in the unsigned type, or in
  // the signed integer of its width (the type `uop_neg_udint` / `uop_neg_ulint` name)?
  {
    name: "unary_minus_unsigned_widened",
    vars: [
      "u : UDINT := 5; dw : DWORD := 5; ul : ULINT := 5; lw : LWORD := 5; udMax : UDINT := 4294967295;",
      "negU : LINT; negDw : LINT; negUl : LREAL; negLw : LINT; negUdMax : LINT; uLess : BOOL; ulLess : BOOL;",
    ].join("\n"),
    body: [
      "negU := -u;",
      "negDw := -dw;",
      "negUl := -ul;",
      "negLw := -lw;",
      "negUdMax := -udMax;",
      "uLess := -u < 0;",
      "ulLess := -ul < 0;",
    ].join(" "),
  },
]
