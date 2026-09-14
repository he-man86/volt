/**
 * Differential-execution cases — each is ONE program, run for `cycles` scan cycles both in CODESYS's simulator
 * (`bun run record:exec`) and through `interp/` (differential.test.ts), and every variable must agree.
 *
 * A case states a question about the vendor, not the answer: nothing here says what the result should be. The
 * recording does. Add a case, re-record, and the replay tells you whether the interpreter already agrees.
 */
export interface ExecCase {
  name: string
  /** The body of a VAR block. Initial values are the inputs — the oracle writes no values online. */
  vars: string
  body: string
  /** Scan cycles the body runs. Default 1. */
  cycles?: number
  /** Set when the case must NOT compile: a fragment of CODESYS's error text. Such a case pins the transpiler's input
   *  contract (src/transpile/index.ts) — the transpiler never sees this code, so nothing is run, only the refusal checked. */
  rejects?: string
  /** Set when the case is recorded but its construct is DELIBERATELY refused by decision — the reason, with its date.
   *  The replay reports it as a todo instead of a permanent red that would hide real regressions. */
  deferred?: string
}

export const CASES: readonly ExecCase[] = [
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

  // ═══ phase 2 — DATE / TOD / DT (+ L variants). The IR has no rule for them yet; `types/elementary` says DATE and
  //     TOD are 32 bits, DT 64 — unverified. First question: what unit does each count? ═══
  {
    // One day, one second, one millisecond past each epoch — the integer that comes back is the unit.
    name: "date_representation",
    vars: [
      "d1 : DATE := D#1970-01-02; dt1 : DT := DT#1970-01-01-00:00:01; tod1 : TOD := TOD#00:00:01;",
      "dateUnits : UDINT; dtUnits : UDINT; todUnits : UDINT;",
    ].join("\n"),
    body: "dateUnits := DATE_TO_UDINT(d1); dtUnits := DT_TO_UDINT(dt1); todUnits := TOD_TO_UDINT(tod1);",
  },
  {
    name: "date_arithmetic",
    vars: [
      "leapEve : DT := DT#2024-02-28-23:59:59; oneSec : TIME := T#1S; d28 : DATE := D#2024-02-28; mar1 : DATE := D#2024-03-01;",
      "rolled : DT; dateDiff : TIME; noon : TOD := TOD#12:30:15.5; halfDay : TIME := T#12H; pastMidnight : TOD; todDiff : TIME;",
    ].join("\n"),
    body: "rolled := leapEve + oneSec; dateDiff := mar1 - d28; pastMidnight := noon + halfDay; todDiff := TOD#13:00:00 - noon;",
  },
  {
    name: "date_compare",
    vars: "early : DT := DT#2024-01-01-00:00:00; late : DT := DT#2024-01-01-00:00:01; before : BOOL; same : BOOL;",
    body: "before := early < late; same := early = DT#2024-01-01-00:00:00;",
  },
  {
    // If DT counts 32-bit seconds, its maximum is DT#2106-02-07-06:28:15 and one more second wraps to the epoch.
    name: "date_width_wrap",
    vars: "dtMax : DT := DT#2106-02-07-06:28:15; oneSec : TIME := T#1S; over : DT;",
    body: "over := dtMax + oneSec;",
  },
  {
    // TOD#12:30:15.5 + T#12H read back as TIME_OF_DAY#0:30:15.500 — is the STORED value reduced modulo a day, or only
    // shown that way? The count that comes back decides; so does TOD#23:59:59.999 + T#1MS.
    name: "tod_wrap_representation",
    vars: [
      "noon : TOD := TOD#12:30:15.5; halfDay : TIME := T#12H; wrapped : TOD; wrappedUnits : UDINT;",
      "lastMs : TOD := TOD#23:59:59.999; oneMs : TIME := T#1MS; overMidnight : TOD; overUnits : UDINT;",
    ].join("\n"),
    body: "wrapped := noon + halfDay; wrappedUnits := TOD_TO_UDINT(wrapped); overMidnight := lastMs + oneMs; overUnits := TOD_TO_UDINT(overMidnight);",
  },
  {
    // DT counts seconds and TIME milliseconds: does T#1500MS added to a DT truncate to one second, or round to two?
    name: "dt_plus_fractional_time",
    vars: "epoch : DT := DT#1970-01-01-00:00:00; t1500 : TIME := T#1500MS; later : DT; laterUnits : UDINT;",
    body: "later := epoch + t1500; laterUnits := DT_TO_UDINT(later);",
  },
  {
    name: "date_negative_difference",
    vars: "d28 : DATE := D#2024-02-28; mar1 : DATE := D#2024-03-01; backwards : TIME; backwardsUnits : UDINT;",
    body: "backwards := d28 - mar1; backwardsUnits := TIME_TO_UDINT(backwards);",
  },
  {
    name: "dt_minus_time",
    vars: "dt1 : DT := DT#2024-03-01-00:00:00; oneSec : TIME := T#1S; earlier : DT;",
    body: "earlier := dt1 - oneSec;",
  },
  {
    name: "date_plus_time",
    vars: "d28 : DATE := D#2024-02-28; oneDay : TIME := T#1D; nextDay : DATE;",
    body: "nextDay := d28 + oneDay;",
  },
  {
    name: "ldate_ltod_ldt",
    vars: [
      "ldt1 : LDT := LDT#1970-01-01-00:00:01; oneNs : LTIME := LTIME#1NS; ldtPlus : LDT; ldtUnits : ULINT;",
      "ltod1 : LTOD := LTOD#00:00:01; ltodUnits : ULINT; ld1 : LDATE := LDATE#1970-01-02; ldateUnits : ULINT;",
    ].join("\n"),
    body: "ldtPlus := ldt1 + oneNs; ldtUnits := LDT_TO_ULINT(ldtPlus); ltodUnits := LTOD_TO_ULINT(ltod1); ldateUnits := LDATE_TO_ULINT(ld1);",
  },

  // ═══ phase 2 — STRING / WSTRING. tasks.md decides the shape (a fixed-size buffer with defined truncation, not Rust
  //     `String`); these measure the definitions. One question per case. ═══
  {
    name: "string_assign_truncation",
    vars: "short5 : STRING(5); long8 : STRING := 'abcdefgh'; fits : STRING(5); three : STRING := 'xyz';",
    body: "short5 := long8; fits := three;",
  },
  {
    // STRING without a length is STRING(80): does an 85-character value keep 80?
    name: "string_default_length",
    vars: `plain : STRING; longText : STRING(100) := '${"x".repeat(85)}'; plainLen : INT;`,
    body: "plain := longText; plainLen := LEN(plain);",
  },
  {
    name: "string_compare",
    vars: "abc : STRING := 'abc'; abd : STRING := 'abd'; bee : STRING := 'b'; upperA : STRING := 'A'; lowerA : STRING := 'a'; less : BOOL; same : BOOL; longerLess : BOOL; caseLess : BOOL;",
    body: "less := abc < abd; same := abc = 'abc'; longerLess := abc < bee; caseLess := upperA < lowerA;",
  },
  {
    name: "string_len_left_right_mid",
    vars: "hello : STRING := 'hello'; length : INT; leftTwo : STRING; rightThree : STRING; midTwoAtTwo : STRING;",
    body: "length := LEN(hello); leftTwo := LEFT(hello, 2); rightThree := RIGHT(hello, 3); midTwoAtTwo := MID(hello, 2, 2);",
  },
  {
    name: "string_concat",
    vars: "ab : STRING := 'ab'; cd : STRING := 'cd'; joined : STRING; tooShort : STRING(3);",
    body: "joined := CONCAT(ab, cd); tooShort := CONCAT(ab, cd);",
  },
  {
    name: "string_insert_delete_replace_find",
    vars: "abcd : STRING := 'abcd'; abcdef : STRING := 'abcdef'; inserted : STRING; deleted : STRING; replaced : STRING; found : INT;",
    body: "inserted := INSERT(abcd, 'XY', 2); deleted := DELETE(abcdef, 2, 3); replaced := REPLACE(abcdef, 'XY', 2, 3); found := FIND('abcabc', 'ca');",
  },
  {
    name: "string_edge_positions",
    vars: "abc : STRING := 'abc'; empty : STRING; leftBeyond : STRING; midAtZero : STRING; notFound : INT; emptyLen : INT; rightBeyond : STRING;",
    body: "leftBeyond := LEFT(abc, 5); midAtZero := MID(abc, 2, 0); notFound := FIND(abc, 'z'); emptyLen := LEN(empty); rightBeyond := RIGHT(abc, 9);",
  },
  {
    // `WLEN` / `WLEFT` do not exist without Standard64 — "Identifier 'WLEN' not defined" — and Standard's LEN/LEFT
    // refuse a WSTRING: "Cannot convert type 'WSTRING' to type 'STRING(255)'" (both measured 2026-09-14). So WSTRING is
    // measured without functions: truncation on store, the sizeless default (by comparing with a WSTRING(80)), ordering.
    name: "wstring_basic",
    vars: `wide : WSTRING := "héllo"; short3 : WSTRING(3); w80 : WSTRING(80) := "${"x".repeat(80)}"; longW : WSTRING(100) := "${"x".repeat(85)}"; plainW : WSTRING; sameAs80 : BOOL; shortLess : BOOL;`,
    body: "short3 := wide; plainW := longW; sameAs80 := plainW = w80; shortLess := short3 < wide;",
  },
  {
    // `wstring_basic` stored "héllo" into a WSTRING(3) as "hé" — the é took TWO places, which a UTF-16 WSTRING would not.
    // Is that how a WSTRING holds characters, or how the literal's source text reached the compiler? The same é as a
    // four-digit escape separates the two; ASCII and a second non-ASCII letter bound it.
    name: "wstring_code_units",
    vars: 'escaped : WSTRING(3) := "h$00E9llo"; direct : WSTRING(3) := "héllo"; ascii : WSTRING(3) := "hello"; escapedIsDirect : BOOL; umlaut : WSTRING(2) := "ü!";',
    body: "escapedIsDirect := escaped = direct;",
  },
  // ── consolidate-lsp-structure A3: does a typed literal's prefix decide its type? Lowering ignores it ──
  {
    // `REAL#0.1` is float32's 0.1 if the prefix types it; lowering types a real literal by context, so into an LREAL it
    // would be float64's 0.1 — the digits differ.
    name: "typed_literal_real_prefix",
    vars: "fromReal : LREAL; fromLreal : LREAL; untyped : LREAL;",
    body: "fromReal := REAL#0.1; fromLreal := LREAL#0.1; untyped := 0.1;",
  },
  {
    // All-constant arithmetic folds at full width when untyped (`constant_arithmetic_width`). With a type prefix on both
    // operands — does it fold in that type (INT 30000 + 30000 wraps), or still at full width?
    name: "typed_literal_constant_fold",
    vars: "intSum : DINT; usintSum : INT; mixedSum : DINT;",
    body: "intSum := INT#30000 + INT#30000; usintSum := USINT#200 + USINT#100; mixedSum := INT#30000 + 30000;",
  },

  // ── transpiler review 2026-09-14: two suspected bugs, recorded before any fix — neither is one ──
  // An untyped literal out of its target's range was suspected to reach the emitter as `300u8`, which rustc rejects. It
  // cannot: CODESYS does not compile it (the transpiler's input contract), while a negative literal into USINT wraps.
  {
    name: "literal_out_of_range_init",
    vars: "b300 : BYTE := 300; bIn : INT;",
    body: "bIn := b300;",
    rejects: "Cannot convert type 'INT' to type 'BYTE'",
  },
  {
    name: "literal_out_of_range_assign",
    vars: "si : SINT; siIn : INT;",
    body: "si := 300; siIn := si;",
    rejects: "Cannot convert type 'INT' to type 'SINT'",
  },
  { name: "literal_negative_into_unsigned", vars: "us : USINT; usIn : INT;", body: "us := -1; usIn := us;" },
  {
    // A FOR counter stepping past its type's maximum was suspected to wrap only in the transpiler (the step adds in the
    // counter's own type, not promoted). CODESYS wraps it too: `runs` hits the guard (11) and the SINT counter reads -121.
    name: "for_at_type_max",
    vars: "i : SINT; runs : INT;",
    body: "FOR i := 125 TO 127 DO runs := runs + 1; IF runs > 10 THEN EXIT; END_IF END_FOR",
  },

  // ── code CODESYS does not compile — the transpiler's input contract (`rejects`, wording as recorded 2026-09-14) ──
  { name: "power_operator_rejected", vars: "base : INT := 2; result : INT;", body: "result := base ** 2;", rejects: "Unexpected token '**' found" },
  { name: "ampersand_operator_rejected", vars: "a : BOOL; b : BOOL; both : BOOL;", body: "both := a & b;", rejects: "Unexpected token '&' found" },
  {
    name: "standard_len_wstring_rejected",
    vars: "wide : WSTRING; n : INT;",
    body: "n := LEN(wide);",
    rejects: "Cannot convert type 'WSTRING' to type 'STRING(255)'",
  },
  {
    name: "string_arithmetic_rejected",
    vars: "left : STRING := 'x'; right : STRING := 'y'; joined : STRING;",
    body: "joined := left + right;",
    rejects: "Cannot convert type 'STRING' to type 'ANY_NUM'",
  },
  {
    name: "bit_index_out_of_range_rejected",
    vars: "word16 : INT; flag : BOOL;",
    body: "flag := word16.16;",
    rejects: "'16' is no valid bit number for 'word16'",
  },
  {
    // A STRING never meets a WSTRING implicitly — not stored into one, not compared with one — so lowering has no
    // STRING/WSTRING rule at all (it had a `string-width` refusal until this was recorded).
    name: "string_wstring_mixing",
    rejects: "Cannot compare type 'STRING' with type 'WSTRING'",
    vars: "narrow : STRING := 'abc'; wide : WSTRING := \"abc\"; intoWide : WSTRING; intoNarrow : STRING; same : BOOL;",
    body: "intoWide := narrow; intoNarrow := wide; same := narrow = wide;",
  },
  {
    // The AST keeps a literal's `$` escapes raw ('a$Tb' is four characters of text); CODESYS counts one per escape?
    name: "string_escapes",
    vars: "tabbed : STRING := 'a$Tb'; dollar : STRING := 'x$$y'; tabbedLen : INT; dollarLen : INT;",
    body: "tabbedLen := LEN(tabbed); dollarLen := LEN(dollar);",
  },
  {
    // The other escapes, each identified by comparing it with its hex spelling — `$N` might be CR LF, and a lower-case
    // escape might not be the same one.
    name: "string_escapes_named",
    vars: "nl : STRING := '$N'; lf : STRING := '$L'; cr : STRING := '$R'; pg : STRING := '$P'; quote : STRING := '$''; dq : STRING := '$\"'; hexA : STRING := '$41'; lowerT : STRING := '$t'; nlLen : INT; nlIsLf : BOOL; lfIs0A : BOOL; crIs0D : BOOL; pgIs0C : BOOL; quoteIs27 : BOOL; dqIs22 : BOOL; hexIsA : BOOL; lowerIsTab : BOOL;",
    body: "nlLen := LEN(nl); nlIsLf := nl = lf; lfIs0A := lf = '$0A'; crIs0D := cr = '$0D'; pgIs0C := pg = '$0C'; quoteIs27 := quote = '$27'; dqIs22 := dq = '$22'; hexIsA := hexA = 'A'; lowerIsTab := lowerT = '$T';",
  },
  {
    // positions at or below zero
    name: "string_positions_low",
    vars: "abc : STRING := 'abc'; leftNeg : STRING; leftZero : STRING; midPosZero : STRING; insertZero : STRING; deleteLenZero : STRING; replacePosZero : STRING; findEmpty : INT;",
    body: "leftNeg := LEFT(abc, -1); leftZero := LEFT(abc, 0); midPosZero := MID(abc, 1, 0); insertZero := INSERT(abc, 'XY', 0); deleteLenZero := DELETE(abc, 0, 1); replacePosZero := REPLACE(abc, 'XY', 1, 0); findEmpty := FIND(abc, '');",
  },
  {
    // positions past the end
    name: "string_positions_high",
    vars: "abc : STRING := 'abc'; midBeyond : STRING; midPastEnd : STRING; insertBeyond : STRING; insertAtEnd : STRING; deleteBeyond : STRING; deletePastEnd : STRING; replaceBeyond : STRING; replacePastEnd : STRING; findAtEnd : INT;",
    body: "midBeyond := MID(abc, 2, 5); midPastEnd := MID(abc, 4, 2); insertBeyond := INSERT(abc, 'XY', 5); insertAtEnd := INSERT(abc, 'XY', 3); deleteBeyond := DELETE(abc, 2, 5); deletePastEnd := DELETE(abc, 5, 2); replaceBeyond := REPLACE(abc, 'XY', 2, 5); replacePastEnd := REPLACE(abc, 'XY', 5, 2); findAtEnd := FIND(abc, 'c');",
  },
  {
    // Standard's parameters are STRING(255): is a longer argument cut to 255 on the way in?
    name: "string_input_truncation",
    vars: `long300 : STRING(300) := '${"y".repeat(300)}'; len300 : INT; leftAll : STRING(300); concatLen : INT;`,
    body: "len300 := LEN(long300); leftAll := LEFT(long300, 300); concatLen := LEN(CONCAT(long300, 'x'));",
  },
  {
    // the formats and parses string_conversions did not pin down
    name: "string_conversions_more",
    vars: "flag : BOOL := TRUE; dur : TIME := T#1S500MS; bigNeg : LINT := -9223372036854775807; byteV : BYTE := 255; spaced : STRING := ' 12'; plus : STRING := '+5'; emptyS : STRING; huge : STRING := '99999'; realS : STRING := '2.5'; tBool : STRING; tTime : STRING; tLint : STRING; tByte : STRING; pSpaced : INT; pPlus : INT; pEmpty : INT; pHuge : INT; pReal : REAL;",
    body: "tBool := BOOL_TO_STRING(flag); tTime := TIME_TO_STRING(dur); tLint := LINT_TO_STRING(bigNeg); tByte := BYTE_TO_STRING(byteV); pSpaced := STRING_TO_INT(spaced); pPlus := STRING_TO_INT(plus); pEmpty := STRING_TO_INT(emptyS); pHuge := STRING_TO_INT(huge); pReal := STRING_TO_REAL(realS);",
  },
  {
    name: "string_conversions",
    vars: "minus42 : INT := -42; digits : STRING := '123'; mixed : STRING := '12abc'; asText : STRING; parsed : INT; parsedMixed : INT;",
    body: "asText := INT_TO_STRING(minus42); parsed := STRING_TO_INT(digits); parsedMixed := STRING_TO_INT(mixed);",
  },

  {
    // where REAL_TO_STRING switches to an exponent (1E10 did, 3.0 did not), float64 digits, the other texts, the parse
    // edges, and INSERT at a negative position (REPLACE's measurements imply it prepends)
    name: "string_conversions_formats",
    vars: "flagOff : BOOL; zeroT : TIME; dayT : TIME := T#1D2H; tOff : STRING; tZeroT : STRING; tDayT : STRING; sReal : STRING := ' 1.5abc'; sExp : STRING := '1E3'; sMinusSpace : STRING := '- 5'; sTab : STRING := '$T7'; abc : STRING := 'abc'; pRealMixed : REAL; pExp : REAL; pMinusSpace : INT; pTab : INT; insertNeg : STRING;",
    body: "tOff := BOOL_TO_STRING(flagOff); tZeroT := TIME_TO_STRING(zeroT); tDayT := TIME_TO_STRING(dayT); pRealMixed := STRING_TO_REAL(sReal); pExp := STRING_TO_REAL(sExp); pMinusSpace := STRING_TO_INT(sMinusSpace); pTab := STRING_TO_INT(sTab); insertNeg := INSERT(abc, 'XY', -1);",
  },

  {
    // Every REAL/LREAL → STRING sample in one case, so the conversions that ARE one rule stay green without it. It looked
    // like 7 significant digits, fixed from 1E-4 up to below 1E8, else '1E08' / '1E-05' — and 123456792 printed EIGHT
    // ('1.2345679E08'). Not one rule; refused (design §18).
    name: "real_to_string_digits",
    deferred: "REAL_TO_STRING stays refused — no single digit rule fits (user decision 2026-09-14)",
    vars: "onePointFive : REAL := 1.5; three : REAL := 3.0; tenth : REAL := 0.1; big : REAL := 1.0E10; negHalf : REAL := -2.5; rE6 : REAL := 1.0E6; rE7 : REAL := 1.0E7; rE8 : REAL := 1.0E8; rMixed : REAL := 123456.7; rMilli : REAL := 0.001; rE4neg : REAL := 0.0001; rE5neg : REAL := 1.0E-5; r2p24 : REAL := 16777216.0; lTenth : LREAL := 0.1; realText : STRING; t3 : STRING; t01 : STRING; t1e10 : STRING; tNeg : STRING; tE6 : STRING; tE7 : STRING; tE8 : STRING; tMixed : STRING; tMilli : STRING; tE4neg : STRING; tE5neg : STRING; t2p24 : STRING; tLTenth : STRING; sciFraction : REAL := 1.5E8; nineDigits : REAL := 123456789.0; roundsUp : REAL := 99999990.0; tieToEven : REAL := 1234566.5; tieToOdd : REAL := 1234567.5; zero : REAL; hundred : REAL := 100.0; fiveDigits : REAL := 0.00012345; tiny : REAL := 2.5E-10; largest : REAL := 3.4028235E38; negSci : REAL := -1.0E8; tSciFraction : STRING; tNineDigits : STRING; tRoundsUp : STRING; tTieToEven : STRING; tTieToOdd : STRING; tZero : STRING; tHundred : STRING; tFiveDigits : STRING; tTiny : STRING; tLargest : STRING; tNegSci : STRING;",
    body: "realText := REAL_TO_STRING(onePointFive); t3 := REAL_TO_STRING(three); t01 := REAL_TO_STRING(tenth); t1e10 := REAL_TO_STRING(big); tNeg := REAL_TO_STRING(negHalf); tE6 := REAL_TO_STRING(rE6); tE7 := REAL_TO_STRING(rE7); tE8 := REAL_TO_STRING(rE8); tMixed := REAL_TO_STRING(rMixed); tMilli := REAL_TO_STRING(rMilli); tE4neg := REAL_TO_STRING(rE4neg); tE5neg := REAL_TO_STRING(rE5neg); t2p24 := REAL_TO_STRING(r2p24); tLTenth := LREAL_TO_STRING(lTenth); tSciFraction := REAL_TO_STRING(sciFraction); tNineDigits := REAL_TO_STRING(nineDigits); tRoundsUp := REAL_TO_STRING(roundsUp); tTieToEven := REAL_TO_STRING(tieToEven); tTieToOdd := REAL_TO_STRING(tieToOdd); tZero := REAL_TO_STRING(zero); tHundred := REAL_TO_STRING(hundred); tFiveDigits := REAL_TO_STRING(fiveDigits); tTiny := REAL_TO_STRING(tiny); tLargest := REAL_TO_STRING(largest); tNegSci := REAL_TO_STRING(negSci);",
  },
  {
    // STRING_TO_REAL reads a prefix (' 1.5abc' is 1.5, '1E3' is 1000); its edges
    name: "string_to_real_parse",
    vars: "sDotFirst : STRING := '.5'; sDotLast : STRING := '5.'; sBareExp : STRING := '1.5E'; sLowerExp : STRING := '2e2'; sNeg : STRING := ' -2.5'; sWord : STRING := 'abc'; sTabbed : STRING := '$T3.25'; sComma : STRING := '1,5'; sLong : STRING := '1.23456789'; pDotFirst : REAL; pDotLast : REAL; pBareExp : REAL; pLowerExp : REAL; pNeg : REAL; pWord : REAL; pTabbed : REAL; pComma : REAL; pLong : REAL; lLong : LREAL;",
    body: "pDotFirst := STRING_TO_REAL(sDotFirst); pDotLast := STRING_TO_REAL(sDotLast); pBareExp := STRING_TO_REAL(sBareExp); pLowerExp := STRING_TO_REAL(sLowerExp); pNeg := STRING_TO_REAL(sNeg); pWord := STRING_TO_REAL(sWord); pTabbed := STRING_TO_REAL(sTabbed); pComma := STRING_TO_REAL(sComma); pLong := STRING_TO_REAL(sLong); lLong := STRING_TO_LREAL(sLong);",
  },

  // ── CASE range edges ──
  {
    name: "case_range_edges",
    vars: "s0 : INT := 0; s1 : INT := 1; s5 : INT := 5; s6 : INT := 6; r0 : INT; r1 : INT; r5 : INT; r6 : INT;",
    body: [
      "CASE s0 OF 1..5: r0 := 1; ELSE r0 := 2; END_CASE",
      "CASE s1 OF 1..5: r1 := 1; ELSE r1 := 2; END_CASE",
      "CASE s5 OF 1..5: r5 := 1; ELSE r5 := 2; END_CASE",
      "CASE s6 OF 1..5: r6 := 1; ELSE r6 := 2; END_CASE",
    ].join("\n"),
  },

  // ── FOR with a negative step — including where the counter is left afterwards ──
  {
    name: "for_negative_step",
    vars: "i : INT; runs : INT; sum : INT;",
    body: "FOR i := 10 TO 1 BY -3 DO runs := runs + 1; sum := sum + i; END_FOR",
  },

  // (No math-domain-error case: `SQRT(-1.0)` / `LN(0.0)` stop the simulated application — the recorder's read
  //  times out, measured 2026-09-14 — so there is no state to compare. A runtime exception, like division by zero;
  //  neither backend models runtime exceptions yet, and the oracle cannot record one.)
]

/** The program both sides run: the case as a PROGRAM, with no gate — the recorder adds its own around the body. */
export function programSource(c: ExecCase): string {
  return `PROGRAM PLC_PRG\nVAR\n${c.vars}\nEND_VAR\n${c.body}\nEND_PROGRAM\n`
}
