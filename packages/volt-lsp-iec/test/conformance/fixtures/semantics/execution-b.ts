/**
 * the fixtures of `execution.ts` — part B: comparing signed with unsigned — the value, or the bits?.
 *
 * One slice of `execution.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { ExecCase } from "./execution-shared.js"

export const CASES_B: readonly ExecCase[] = [
  // ── comparing signed with unsigned — the value, or the bits? ──
  {
    name: "signed_unsigned_comparison",
    vars: [
      "udMax : UDINT := 4294967295; dMinus1 : DINT := -1; us200 : USINT := 200; sMinus1 : SINT := -1;",
      "udGt : BOOL; udEq : BOOL; usGt : BOOL; sLt : BOOL;",
    ].join("\n"),
    body: "udGt := udMax > dMinus1; udEq := udMax = dMinus1; usGt := us200 > sMinus1; sLt := sMinus1 < us200;",
  },
  // (No `**` case: CODESYS 3.5.21.40 does not parse it — "Unexpected token '**' found". EXPT is the only power,
  //  and it is a built-in, measured in phase 2.)

  // ═══ phase 2 — the value functions. Recorded BEFORE they are implemented; each question in its own case, so one
  //     that does not compile cannot hide the others. ═══
  {
    name: "max_min_basic",
    vars: "a3 : INT := 3; b7 : INT := 7; neg : INT := -4; mx : INT; mn : INT; mxNeg : INT; lit : INT;",
    body: "mx := MAX(a3, b7); mn := MIN(a3, b7); mxNeg := MAX(neg, a3); lit := MIN(9, 2);",
  },
  {
    name: "max_extensible",
    vars: "three : INT; four : INT;",
    body: "three := MAX(1, 5, 3); four := MIN(8, 4, 6, 9);",
  },
  {
    name: "max_mixed_int_real",
    vars: "i3 : INT := 3; r25 : REAL := 2.5; mixed : REAL; mixedMin : REAL;",
    body: "mixed := MAX(i3, r25); mixedMin := MIN(i3, r25);",
  },
  {
    name: "max_signed_unsigned",
    vars: "us200 : USINT := 200; sMinus1 : SINT := -1; mx : INT; mn : INT;",
    body: "mx := MAX(us200, sMinus1); mn := MIN(us200, sMinus1);",
  },
  {
    name: "limit_basic",
    vars: "lo : INT := 0; hi : INT := 100; above : INT; below : INT; inside : INT; realClamp : REAL; x : REAL := 7.5;",
    body: "above := LIMIT(lo, 150, hi); below := LIMIT(lo, -5, hi); inside := LIMIT(lo, 42, hi); realClamp := LIMIT(0.0, x, 5.0);",
  },
  {
    name: "limit_inverted_bounds",
    vars: "mid : INT; low : INT; high : INT;",
    body: "mid := LIMIT(100, 50, 0); low := LIMIT(100, -5, 0); high := LIMIT(100, 150, 0);",
  },
  {
    name: "sel_basic",
    vars: "g : BOOL := TRUE; pick0 : INT; pick1 : INT; pickReal : REAL; r1 : REAL := 1.5; r2 : REAL := 2.5;",
    body: "pick0 := SEL(FALSE, 10, 20); pick1 := SEL(g, 10, 20); pickReal := SEL(g, r1, r2);",
  },
  // ═══ phase 2 — conversions. Inputs are VARIABLES so the conversion runs at scan time; constant folding gets its
  //     own case, because a compiler may fold differently from what the runtime does. ═══
  {
    name: "real_to_int_rounding",
    vars: [
      "p05 : REAL := 0.5; p15 : REAL := 1.5; p25 : REAL := 2.5; p35 : REAL := 3.5; n25 : REAL := -2.5;",
      "p27 : REAL := 2.7; n27 : REAL := -2.7; n05 : REAL := -0.5;",
      "i05 : INT; i15 : INT; i25 : INT; i35 : INT; in25 : INT; i27 : INT; in27 : INT; in05 : INT;",
    ].join("\n"),
    body: [
      "i05 := REAL_TO_INT(p05); i15 := REAL_TO_INT(p15); i25 := REAL_TO_INT(p25); i35 := REAL_TO_INT(p35);",
      "in25 := REAL_TO_INT(n25); i27 := REAL_TO_INT(p27); in27 := REAL_TO_INT(n27); in05 := REAL_TO_INT(n05);",
    ].join("\n"),
  },
  {
    name: "lreal_to_dint_rounding",
    vars: "p25 : LREAL := 2.5; n25 : LREAL := -2.5; p35 : LREAL := 3.5; d25 : DINT; dn25 : DINT; d35 : DINT; lint25 : LINT;",
    body: "d25 := LREAL_TO_DINT(p25); dn25 := LREAL_TO_DINT(n25); d35 := LREAL_TO_DINT(p35); lint25 := LREAL_TO_LINT(p25);",
  },
  {
    name: "trunc_functions",
    vars: "p27 : REAL := 2.7; n27 : REAL := -2.7; p25 : LREAL := 2.5; t27 : DINT; tn27 : DINT; tInt : INT; tInt25 : INT;",
    body: "t27 := TRUNC(p27); tn27 := TRUNC(n27); tInt := TRUNC_INT(n27); tInt25 := TRUNC_INT(p25);",
  },
  {
    name: "trunc_out_of_range",
    vars: "giant : LREAL := 3.0E9; big : REAL := 40000.5; negBig : REAL := -40000.5; toDint : DINT; toInt : INT; toIntNeg : INT;",
    body: "toDint := TRUNC(giant); toInt := TRUNC_INT(big); toIntNeg := TRUNC_INT(negBig);",
  },
  {
    // TRUNC(3.0E9) is DINT's MINIMUM (neither a wrap nor a saturation) — does TRUNC_INT go through that DINT first?
    name: "trunc_beyond_dint",
    vars: "posGiant : LREAL := 3.0E9; negGiant : LREAL := -3.0E9; toInt : INT; toDint : DINT; negToInt : INT;",
    body: "toInt := TRUNC_INT(posGiant); toDint := TRUNC(negGiant); negToInt := TRUNC_INT(negGiant);",
  },
  {
    name: "real_to_int_out_of_range",
    vars: "big : REAL := 40000.0; huge : REAL := 200.0; giant : LREAL := 3.0E9; neg : REAL := -40000.0; toInt : INT; toSint : SINT; toDint : DINT; toIntNeg : INT;",
    body: "toInt := REAL_TO_INT(big); toSint := REAL_TO_SINT(huge); toDint := LREAL_TO_DINT(giant); toIntNeg := REAL_TO_INT(neg);",
  },
  {
    name: "integer_narrowing",
    vars: [
      "d300 : DINT := 300; dm129 : DINT := -129; i1 : INT := -1; ud70000 : UDINT := 70000; li : LINT := 4294967297;",
      "toSint : SINT; toSintNeg : SINT; toUsint : USINT; toInt : INT; toDint : DINT;",
    ].join("\n"),
    body: "toSint := DINT_TO_SINT(d300); toSintNeg := DINT_TO_SINT(dm129); toUsint := INT_TO_USINT(i1); toInt := UDINT_TO_INT(ud70000); toDint := LINT_TO_DINT(li);",
  },
  {
    name: "signed_unsigned_conversion",
    vars: [
      "sm1 : SINT := -1; u200 : USINT := 200; dm1 : DINT := -1; udMax : UDINT := 4294967295; im1 : INT := -1; w65535 : WORD := 65535;",
      "toUsint : USINT; toSint : SINT; toUdint : UDINT; toDint : DINT; toWord : WORD; toInt : INT;",
    ].join("\n"),
    body: "toUsint := SINT_TO_USINT(sm1); toSint := USINT_TO_SINT(u200); toUdint := DINT_TO_UDINT(dm1); toDint := UDINT_TO_DINT(udMax); toWord := INT_TO_WORD(im1); toInt := WORD_TO_INT(w65535);",
  },
  {
    name: "bool_to_numeric",
    vars: "t : BOOL := TRUE; f : BOOL; toInt : INT; toReal : REAL; toByte : BYTE; toIntFalse : INT;",
    body: "toInt := BOOL_TO_INT(t); toReal := BOOL_TO_REAL(t); toByte := BOOL_TO_BYTE(t); toIntFalse := BOOL_TO_INT(f);",
  },
  {
    name: "numeric_to_bool",
    vars: "i2 : INT := 2; i0 : INT; im1 : INT := -1; b16 : BYTE := 16; fromTwo : BOOL; fromZero : BOOL; fromMinus : BOOL; fromByte : BOOL;",
    body: "fromTwo := INT_TO_BOOL(i2); fromZero := INT_TO_BOOL(i0); fromMinus := INT_TO_BOOL(im1); fromByte := BYTE_TO_BOOL(b16);",
  },
  {
    name: "real_to_bool",
    vars: "half : REAL := 0.5; zero : REAL; fromHalf : BOOL; fromZero : BOOL;",
    body: "fromHalf := REAL_TO_BOOL(half); fromZero := REAL_TO_BOOL(zero);",
  },
  {
    name: "real_lreal_precision",
    vars: "l01 : LREAL := 0.1; r01 : REAL := 0.1; toReal : REAL; toLreal : LREAL; d16777217 : DINT := 16777217; toRealExact : REAL; lintBig : LINT := 9007199254740993; toLrealExact : LREAL;",
    body: "toReal := LREAL_TO_REAL(l01); toLreal := REAL_TO_LREAL(r01); toRealExact := DINT_TO_REAL(d16777217); toLrealExact := LINT_TO_LREAL(lintBig);",
  },
  {
    name: "generic_to_conversion",
    vars: "p25 : REAL := 2.5; d300 : DINT := 300; toInt : INT; toSint : SINT;",
    body: "toInt := TO_INT(p25); toSint := TO_SINT(d300);",
  },
  {
    name: "conversion_constant_folding",
    vars: "rounded : INT; narrowed : SINT; truncated : DINT;",
    body: "rounded := REAL_TO_INT(2.5); narrowed := DINT_TO_SINT(300); truncated := TRUNC(-2.7);",
  },
  // ═══ phase 2 — math. Results are stored into LREAL wherever the question is "which width was it computed in":
  //     a 32-bit result shows its float32 digits there (SQRT(2) is 1.4142135381698608, not 1.4142135623730951). ═══
  {
    name: "abs_values",
    vars: [
      "im5 : INT := -5; rm25 : REAL := -2.5; iMin : INT := -32768; sMin : SINT := -128;",
      "absInt : INT; absReal : REAL; absIntMinSame : INT; absIntMinWide : DINT; absSintMinWide : INT;",
    ].join("\n"),
    body: "absInt := ABS(im5); absReal := ABS(rm25); absIntMinSame := ABS(iMin); absIntMinWide := ABS(iMin); absSintMinWide := ABS(sMin);",
  },
  {
    name: "abs_unsigned",
    vars: "u200 : USINT := 200; absUnsigned : USINT;",
    body: "absUnsigned := ABS(u200);",
  },
  {
    name: "sqrt_precision",
    vars: "r2 : REAL := 2.0; l2 : LREAL := 2.0; i2 : INT := 2; ofReal : LREAL; ofLreal : LREAL; ofInt : LREAL; ofRealIntoReal : REAL;",
    body: "ofReal := SQRT(r2); ofLreal := SQRT(l2); ofInt := SQRT(i2); ofRealIntoReal := SQRT(r2);",
  },
  {
    name: "exp_log_precision",
    vars: "r2 : REAL := 2.0; r1 : REAL := 1.0; i10 : INT := 10; l1000 : LREAL := 1000.0; lnReal : LREAL; logReal : LREAL; expReal : LREAL; lnInt : LREAL; logLreal : LREAL;",
    body: "lnReal := LN(r2); logReal := LOG(r2); expReal := EXP(r1); lnInt := LN(i10); logLreal := LOG(l1000);",
  },
  {
    name: "trig_precision",
    vars: [
      "r1 : REAL := 1.0; rHalf : REAL := 0.5; l1 : LREAL := 1.0;",
      "sinReal : LREAL; cosReal : LREAL; tanReal : LREAL; asinReal : LREAL; acosReal : LREAL; atanReal : LREAL; sinLreal : LREAL;",
    ].join("\n"),
    body: "sinReal := SIN(r1); cosReal := COS(r1); tanReal := TAN(r1); asinReal := ASIN(rHalf); acosReal := ACOS(rHalf); atanReal := ATAN(r1); sinLreal := SIN(l1);",
  },
  {
    name: "expt_types",
    vars: [
      "r2 : REAL := 2.0; rHalf : REAL := 0.5; i2 : INT := 2; i10 : INT := 10; i3 : INT := 3; im1 : INT := -1;",
      "realReal : LREAL; intInt : LREAL; realInt : LREAL; negExponent : LREAL;",
    ].join("\n"),
    body: "realReal := EXPT(r2, rHalf); intInt := EXPT(i2, i10); realInt := EXPT(r2, i3); negExponent := EXPT(i2, im1);",
  },
  // (No EXPT-into-INT case: `intResult := EXPT(i2, i10)` does not compile — "Cannot convert type 'LREAL' to type
  //  'INT'", measured 2026-09-14 — so EXPT of two INTs is typed LREAL.)
  {
    // EXPT(REAL 2.0, REAL 0.5) came back with float32's √2. Which argument decides the width? 3^20 is 3486784401
    // in float64 but 3486784512 in float32.
    name: "expt_mixed_width",
    vars: "r3 : REAL := 3.0; i20 : INT := 20; i2 : INT := 2; rHalf : REAL := 0.5; l2 : LREAL := 2.0; realIntBase : LREAL; intRealExp : LREAL; lrealReal : LREAL;",
    body: "realIntBase := EXPT(r3, i20); intRealExp := EXPT(i2, rHalf); lrealReal := EXPT(l2, rHalf);",
  },
  {
    // Typed REAL, or typed LREAL and computed in float32? Only a compile tells — see `implicit_lreal_to_real`.
    name: "expt_real_into_real",
    vars: "r2 : REAL := 2.0; rHalf : REAL := 0.5; intoReal : REAL;",
    body: "intoReal := EXPT(r2, rHalf);",
  },
  {
    name: "implicit_lreal_to_real",
    vars: "l25 : LREAL := 2.5; narrowed : REAL;",
    body: "narrowed := l25;",
  },
  // ═══ phase 2 — bit operations. Counts and indices come from VARIABLES where the question is a runtime one. ═══
  {
    name: "shift_basic",
    vars: [
      "b1 : BYTE := 1; w1 : WORD := 1; b128 : BYTE := 128; n3 : INT := 3; n9 : INT := 9;",
      "shlByte : BYTE; shlWord : WORD; shlByteIntoWord : WORD; shrByte : BYTE;",
    ].join("\n"),
    body: "shlByte := SHL(b1, n3); shlWord := SHL(w1, 15); shlByteIntoWord := SHL(b1, n9); shrByte := SHR(b128, 7);",
  },
  {
    name: "shift_count_at_width",
    vars: "b1 : BYTE := 1; b128 : BYTE := 128; w1 : WORD := 1; dw1 : DWORD := 1; n8 : INT := 8; n16 : INT := 16; n32 : INT := 32; shlByte8 : BYTE; shrByte8 : BYTE; shlWord16 : WORD; shlDword32 : DWORD;",
    body: "shlByte8 := SHL(b1, n8); shrByte8 := SHR(b128, n8); shlWord16 := SHL(w1, n16); shlDword32 := SHL(dw1, n32);",
  },
  {
    name: "shift_count_beyond_width",
    vars: "b1 : BYTE := 1; dw1 : DWORD := 1; n10 : INT := 10; n33 : INT := 33; shlByte10 : BYTE; shlDword33 : DWORD;",
    body: "shlByte10 := SHL(b1, n10); shlDword33 := SHL(dw1, n33);",
  },
  {
    name: "shift_negative_count",
    vars: "b8 : BYTE := 8; nm1 : INT := -1; shlNeg : BYTE; shrNeg : BYTE;",
    body: "shlNeg := SHL(b8, nm1); shrNeg := SHR(b8, nm1);",
  },
  {
    name: "shift_signed_operand",
    vars: "sMin : SINT := -128; im2 : INT := -2; shrSint : SINT; shrInt : INT; shlSint : SINT;",
    body: "shrSint := SHR(sMin, 1); shrInt := SHR(im2, 1); shlSint := SHL(sMin, 1);",
  },
  {
    // 32-bit types mask the count to 5 bits (SHL(DWORD 1, 33) is 2). Do 64-bit types mask to 6? And is LINT's SHR
    // arithmetic like SINT's and INT's?
    name: "shift_64bit",
    vars: "lw1 : LWORD := 1; n65 : INT := 65; liM8 : LINT := -8; shl65 : LWORD; shrLint : LINT;",
    body: "shl65 := SHL(lw1, n65); shrLint := SHR(liM8, 1);",
  },
  {
    name: "rotate_basic",
    vars: "b129 : BYTE := 129; w4660 : WORD := 4660; rolByte : BYTE; rorByte : BYTE; rolWord : WORD; rorWord : WORD;",
    body: "rolByte := ROL(b129, 1); rorByte := ROR(b129, 1); rolWord := ROL(w4660, 4); rorWord := ROR(w4660, 4);",
  },
  {
    name: "rotate_beyond_width",
    vars: "b129 : BYTE := 129; n9 : INT := 9; n8 : INT := 8; rol9 : BYTE; rol8 : BYTE; ror9 : BYTE;",
    body: "rol9 := ROL(b129, n9); rol8 := ROL(b129, n8); ror9 := ROR(b129, n9);",
  },
  // transpile-review-2026-09-29 task 9: an EXPRESSION operand is promoted to DINT at run time — does ROL/ROR rotate in
  // that promoted width, or in the expression's own (checked) width? And a BYTE + BYTE that overflows into a WORD?
  {
    name: "rotate_of_expression",
    vars: [
      "w : WORD := 16#8001; m : WORD := 16#FFFF; b : BYTE := 16#81; b2 : BYTE := 16#80; one : BYTE := 1; w0 : WORD := 0;",
      "rolWordAnd : WORD; rorWordAnd : WORD; rolByteAdd0 : BYTE; rolByteMax : BYTE; rorByteOr : BYTE;",
      "rolByteAndLit : BYTE; rolByteOverflow : BYTE; rolByteOverflowWide : WORD; rolMixed : WORD;",
    ].join("\n"),
    body: [
      "rolWordAnd := ROL(w AND m, 1);",
      "rorWordAnd := ROR(w AND m, 1);",
      "rolByteAdd0 := ROL(b + 0, 1);",
      "rolByteMax := ROL(MAX(b, one), 1);",
      "rorByteOr := ROR(b OR b, 1);",
      "rolByteAndLit := ROL(b AND 16#FF, 1);",
      "rolByteOverflow := ROL(b + b2, 1);",
      "rolByteOverflowWide := ROL(b + b2, 1);",
      "rolMixed := ROL(b OR w0, 1);",
    ].join(" "),
  },
  {
    name: "mux_basic",
    vars: "k0 : INT := 0; k1 : INT := 1; k2 : INT := 2; pick0 : INT; pick1 : INT; pick2 : INT;",
    body: "pick0 := MUX(k0, 10, 20, 30); pick1 := MUX(k1, 10, 20, 30); pick2 := MUX(k2, 10, 20, 30);",
  },
  {
    name: "mux_mixed_types",
    vars: "k1 : INT := 1; i10 : INT := 10; r25 : REAL := 2.5; k0 : INT := 0; mixed : REAL; mixedInt : REAL;",
    body: "mixed := MUX(k1, i10, r25); mixedInt := MUX(k0, i10, r25);",
  },
  {
    name: "mux_out_of_range",
    vars: "k3 : INT := 3; km1 : INT := -1; beyond : INT; negative : INT;",
    body: "beyond := MUX(k3, 10, 20, 30); negative := MUX(km1, 10, 20, 30);",
  },
  {
    name: "bit_access_read",
    vars: [
      "w32769 : WORD := 32769; bb128 : BYTE := 128; im1 : INT := -1; dwTop : DWORD := 2147483648; i2 : INT := 2;",
      "bit0 : BOOL; bit1 : BOOL; bit15 : BOOL; byteBit7 : BOOL; intBit15 : BOOL; dwordBit31 : BOOL; intBit1 : BOOL;",
    ].join("\n"),
    body: "bit0 := w32769.0; bit1 := w32769.1; bit15 := w32769.15; byteBit7 := bb128.7; intBit15 := im1.15; dwordBit31 := dwTop.31; intBit1 := i2.1;",
  },
  {
    name: "bit_access_write",
    vars: "w0 : WORD; bb0 : BYTE; i0 : INT; dw0 : DWORD; wAll : WORD := 65535; flag : BOOL := TRUE;",
    body: "w0.3 := TRUE; bb0.7 := TRUE; i0.15 := TRUE; dw0.31 := flag; wAll.0 := FALSE;",
  },
  // ═══ phase 2 — set/reset assignment. Initial values chosen so a LATCH and a plain `:=` give different answers. ═══
  {
    name: "set_reset_basic",
    vars: [
      "t : BOOL := TRUE; f : BOOL;",
      "setByTrue : BOOL; latchedStaysSet : BOOL := TRUE; resetByTrue : BOOL := TRUE; staysSetOnFalseReset : BOOL := TRUE;",
    ].join("\n"),
    body: "setByTrue S= t; latchedStaysSet S= f; resetByTrue R= t; staysSetOnFalseReset R= f;",
  },
  {
    name: "set_reset_across_cycles",
    cycles: 5,
    vars: "n : INT; setOnTwo : BOOL; resetOnThree : BOOL := TRUE; setAtTwoCount : INT;",
    body: "n := n + 1; setOnTwo S= n = 2; resetOnThree R= n = 3; IF setOnTwo THEN setAtTwoCount := setAtTwoCount + 1; END_IF",
  },
  {
    name: "set_reset_expression",
    vars: "i7 : INT := 7; flag : BOOL := TRUE; viaExpression : BOOL; notSet : BOOL;",
    body: "viaExpression S= (i7 > 5) AND flag; notSet S= (i7 > 10) AND flag;",
  },
  {
    name: "set_reset_chained",
    vars: "a : BOOL; b : BOOL := TRUE; c : BOOL := TRUE;",
    body: "a S= b R= c;",
  },
  {
    // `a S= b R= c` compiled and gave a = TRUE, b = FALSE — which two readings both predict. Does `a` latch on the OLD
    // `b`, or on `c` flowing through `b R= c`? Chain 1: b FALSE, c TRUE → old-b says a FALSE, flow-c says a TRUE.
    // Chain 2: b TRUE, c FALSE → old-b says a TRUE, flow-c says a FALSE.
    name: "set_reset_chained_disambiguation",
    vars: "a1 : BOOL; b1 : BOOL; c1 : BOOL := TRUE; a2 : BOOL; b2 : BOOL := TRUE; c2 : BOOL;",
    body: "a1 S= b1 R= c1; a2 S= b2 R= c2;",
  },
  {
    // A set/reset chain acts on its FINAL value at every link. Is a plain `:=` chain the same (the parser's comment
    // says so, from recollection)? Measured first as `viaWide : SINT := wide : DINT := narrowFrom : INT`, which does
    // not compile — "Cannot convert type 'DINT' to type 'SINT'" — and the message names DINT, not INT: `viaWide` is
    // assigned FROM `wide`. This asks the same by VALUE, with a narrowing that only warns: 0.1 through a REAL
    // intermediate is 0.10000000149011612, straight from the LREAL source it stays 0.1.
    name: "assign_chained_plain",
    vars: "x : INT; y : INT; z : INT := 7; srcL : LREAL := 0.1; midR : REAL; outL : LREAL;",
    body: "x := y := z; outL := midR := srcL;",
  },
  {
    // And a chain MIXING `:=` with `S=`: does `plain` take the final value (1: TRUE, 2: FALSE), the latch's NEW value
    // (1: TRUE, 2: TRUE), or the latch's OLD value (1: FALSE, 2: TRUE)?
    name: "assign_chained_mixed",
    vars: "plain1 : BOOL; latch1 : BOOL; cond1 : BOOL := TRUE; plain2 : BOOL; latch2 : BOOL := TRUE; cond2 : BOOL;",
    body: "plain1 := latch1 S= cond1; plain2 := latch2 S= cond2;",
  },
  // ═══ phase 2 — TIME / LTIME. The IR holds TIME as 64-bit nanoseconds; CODESYS's TIME is suspected to be 32-bit
  //     MILLISECONDS. Each case asks one thing, so one that does not compile cannot hide the others. ═══
  {
    name: "time_basic",
    vars: "t1s : TIME := T#1S; t500 : TIME := T#500MS; sum : TIME; later : TIME; negative : TIME;",
    body: "sum := t1s + t500; later := t1s - t500; negative := t500 - t1s;",
  },
  {
    // T#49D17H2M47S295MS is 4294967295 ms — UDINT's maximum. One more millisecond wraps to 0 only if TIME is 32-bit ms.
    name: "time_width_wrap",
    vars: "timeMax : TIME := T#49D17H2M47S295MS; oneMs : TIME := T#1MS; over : TIME;",
    body: "over := timeMax + oneMs;",
  },
  {
    name: "time_conversions",
    vars: "t1500 : TIME := T#1S500MS; asDint : DINT; asUdint : UDINT; fromDint : TIME; d2500 : DINT := 2500;",
    body: "asDint := TIME_TO_DINT(t1500); asUdint := TIME_TO_UDINT(t1500); fromDint := DINT_TO_TIME(d2500);",
  },
  {
    name: "time_multiply_divide",
    vars: "t1s : TIME := T#1S; three : INT := 3; four : INT := 4; tripled : TIME; quartered : TIME;",
    body: "tripled := t1s * three; quartered := t1s / four;",
  },
  {
    name: "time_compare",
    vars: "t1s : TIME := T#1S; t2s : TIME := T#2S; less : BOOL; equal : BOOL; greater : BOOL;",
    body: "less := t1s < t2s; equal := t1s = T#1000MS; greater := t1s > t2s;",
  },
  // (No sub-millisecond TIME literal case: `T#1500US` does not compile — "';' expected instead of 'T#1500'",
  //  measured 2026-09-14. TIME is 32-bit MILLISECONDS; microseconds and nanoseconds belong to LTIME.)
  {
    name: "ltime_basic",
    vars: "lt1s : LTIME := LTIME#1S; oneNs : LTIME := LTIME#1NS; lsum : LTIME; asLint : LINT;",
    body: "lsum := lt1s + oneNs; asLint := LTIME_TO_LINT(lsum);",
  },
]
