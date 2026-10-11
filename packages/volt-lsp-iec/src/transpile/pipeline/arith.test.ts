import { describe, expect, test } from "bun:test"
import { load } from "../index.js"
import { lowerSource } from "../lower/index.js"
import { NaNBits } from "../semantics/index.js"

// End to end, ST -> lower -> interpreter: arithmetic, promotion, conversions, bit operations, the math builtins.
describe("interp — the executable core", () => {
  test("REAL arithmetic crosses the int divide through the lowered conversion", () => {
    const pou = load(`
PROGRAM P
VAR
  n    : INT := 7;
  rate : REAL;
END_VAR
rate := n / 2;
END_PROGRAM
`)
    pou.scan()
    expect(pou.get("rate")).toBe(3) // INT division first, THEN widened — as the IDE does it
  })

  // The three below were found by the differential oracle (conformance) — CODESYS's answers, not recollection.
  test("integers wrap at their declared width, signed and unsigned", () => {
    const pou = load("PROGRAM P\nVAR si : SINT := 127; us : USINT; ud : UDINT; END_VAR\nsi := si + 1; us := us - 1; ud := ud - 1;\nEND_PROGRAM\n")
    pou.scan()
    expect([pou.get("si"), pou.get("us"), pou.get("ud")]).toEqual([-128n, 255n, 4294967295n])
  })

  test("integer arithmetic below 32 bits promotes to DINT; constants fold at full width", () => {
    const pou = load(`
PROGRAM P
VAR
  si : SINT := 127; us : USINT; di : DINT := 2147483647;
  toInt : INT; toDint : DINT; fromDint : LINT; folded : LINT;
END_VAR
toInt := si + 1; toDint := us - 1; fromDint := di + 1; folded := 2000000000 + 2000000000;
END_PROGRAM
`)
    pou.scan()
    expect([pou.get("toInt"), pou.get("toDint"), pou.get("fromDint"), pou.get("folded")]).toEqual([
      128n, // computed in DINT, not wrapped in SINT
      -1n, // USINT promotes to SIGNED DINT
      -2147483648n, // DINT is not promoted further: it wraps even into a LINT
      4000000000n, // an all-constant expression does not wrap at its literals' narrowest type
    ])
  })

  test("a signed and an unsigned type of the same width meet in the signed one, on either side", () => {
    const pou = load(`
PROGRAM P
VAR
  d : DINT := -1; u : UDINT := 0; n64 : LINT := -1; z64 : ULINT := 0;
  sumUD : LINT; lessUD : BOOL; lessLongRev : BOOL;
END_VAR
sumUD := u + d; lessUD := u > d; lessLongRev := z64 > n64;
END_PROGRAM
`)
    pou.scan()
    // unsigned on the LEFT: the left operand used to win, so this computed in UDINT (4294967295, FALSE, FALSE)
    expect([pou.get("sumUD"), pou.get("lessUD"), pou.get("lessLongRev")]).toEqual([-1n, true, true])
  })

  test("bit strings promote like integers, and so do AND/OR/XOR — but NOT does not", () => {
    const pou = load(`
PROGRAM P
VAR
  b255 : BYTE := 255; w0 : WORD; minus1 : SINT := -1; u255 : USINT := 255;
  toWord : WORD; wordUnder : DINT; andWide : INT; notWide : DINT;
END_VAR
toWord := b255 + 1; wordUnder := w0 - 1; andWide := minus1 AND 255; notWide := NOT u255;
END_PROGRAM
`)
    pou.scan()
    expect([pou.get("toWord"), pou.get("wordUnder"), pou.get("andWide"), pou.get("notWide")]).toEqual([
      256n, // BYTE computes in DINT — it used to wrap to 0
      -1n, // WORD 0 - 1 is a SIGNED DINT -1, not 65535
      255n, // the 255 is no longer forced into SINT (-1) before the AND
      0n, // NOT stays in USINT: ~255 is 0
    ])
  })

  test("unary minus promotes like arithmetic — and a DINT's minimum still negates to itself", () => {
    const pou = load(`
PROGRAM P
VAR
  sMin : SINT := -128; iMin : INT := -32768; dMin : DINT := -2147483647 - 1;
  negSint : INT; negInt : DINT; negDint : LINT;
END_VAR
negSint := -sMin; negInt := -iMin; negDint := -dMin;
END_PROGRAM
`)
    pou.scan()
    // all three were wrapped in the operand's own width before: -128, -32768, -2147483648
    expect([pou.get("negSint"), pou.get("negInt"), pou.get("negDint")]).toEqual([128n, 32768n, -2147483648n])
  })

  test("MAX/MIN/LIMIT/SEL — extensible, meeting like operators, and LIMIT with MN > MX returns MX", () => {
    const pou = load(`
PROGRAM P
VAR
  us200 : USINT := 200; sMinus1 : SINT := -1; i3 : INT := 3; r25 : REAL := 2.5; g : BOOL := TRUE;
  mx : INT; three : INT; mixed : REAL; inverted : INT; clamped : REAL; pick : INT;
END_VAR
mx := MAX(us200, sMinus1); three := MAX(1, 5, 3); mixed := MAX(i3, r25);
inverted := LIMIT(100, 50, 0); clamped := LIMIT(0.0, 7.5, 5.0); pick := SEL(g, 10, 20);
END_PROGRAM
`)
    pou.scan()
    expect([pou.get("mx"), pou.get("three"), pou.get("mixed"), pou.get("inverted"), pou.get("clamped"), pou.get("pick")]).toEqual([
      200n, // values compare, not bits
      5n,
      3, // meets at REAL
      0n, // MIN(MAX(50, 100), 0)
      5,
      20n, // TRUE picks IN1
    ])
  })

  test("conversions round half away from zero, wrap out of range, and treat BOOL as 1/0 and not-zero", () => {
    const pou = load(`
PROGRAM P
VAR
  p25 : REAL := 2.5; n25 : REAL := -2.5; big : REAL := 40000.0; d300 : DINT := 300; sm1 : SINT := -1;
  t : BOOL := TRUE; d16777217 : DINT := 16777217; n27 : REAL := -2.7;
  rounded : INT; roundedNeg : INT; wrapped : INT; narrowed : SINT; toUsint : USINT; fromBool : REAL;
  toBool : BOOL; toReal : REAL; truncated : DINT; generic : INT; folded : SINT;
END_VAR
rounded := REAL_TO_INT(p25); roundedNeg := REAL_TO_INT(n25); wrapped := REAL_TO_INT(big);
narrowed := DINT_TO_SINT(d300); toUsint := SINT_TO_USINT(sm1); fromBool := BOOL_TO_REAL(t);
toBool := REAL_TO_BOOL(0.5); toReal := DINT_TO_REAL(d16777217); truncated := TRUNC(n27);
generic := TO_INT(p25); folded := DINT_TO_SINT(300);
END_PROGRAM
`)
    pou.scan()
    const names = ["rounded", "roundedNeg", "wrapped", "narrowed", "toUsint", "fromBool", "toBool", "toReal", "truncated", "generic", "folded"]
    expect(names.map((n) => pou.get(n))).toEqual([
      3n, // REAL_TO_INT used to TRUNCATE to 2
      -3n, // half away from zero, not toward +infinity
      -25536n, // 40000 wraps into INT
      44n,
      255n,
      1,
      true, // not zero — 0.5 does not round to FALSE
      16777216, // float32 has no 16777217
      -2n, // TRUNC is toward zero
      3n,
      44n, // a constant argument folds to the same answer
    ])
  })

  test("TRUNC out of DINT range is DINT's minimum — not a wrap, unlike LREAL_TO_DINT — and TRUNC_INT wraps that", () => {
    const pou = load(`
PROGRAM P
VAR
  giant : LREAL := 3.0E9; big : REAL := 40000.5;
  truncated : DINT; converted : DINT; truncatedInt : INT;
END_VAR
truncated := TRUNC(giant); converted := LREAL_TO_DINT(giant); truncatedInt := TRUNC_INT(big);
END_PROGRAM
`)
    pou.scan()
    expect([pou.get("truncated"), pou.get("converted"), pou.get("truncatedInt")]).toEqual([
      -2147483648n, // was -1294967296: TRUNC does not go through 64 bits
      -1294967296n, // the conversion DOES wrap
      -25536n, // 40000 fits a DINT, and then wraps into INT
    ])
  })

  test("ABS promotes like unary minus; SQRT/LN/LOG/trig keep a REAL in REAL and take an LREAL or integer to LREAL", () => {
    const pou = load(`
PROGRAM P
VAR
  sMin : SINT := -128; iMin : INT := -32768; r2 : REAL := 2.0; i2 : INT := 2; l1 : LREAL := 1.0;
  absSint : INT; absIntWide : DINT; sqrtOfReal : LREAL; sqrtOfInt : LREAL; sinOfLreal : LREAL; logOfReal : LREAL;
END_VAR
absSint := ABS(sMin); absIntWide := ABS(iMin); sqrtOfReal := SQRT(r2); sqrtOfInt := SQRT(i2);
sinOfLreal := SIN(l1); logOfReal := LOG(r2);
END_PROGRAM
`)
    pou.scan()
    const names = ["absSint", "absIntWide", "sqrtOfReal", "sqrtOfInt", "sinOfLreal", "logOfReal"]
    expect(names.map((n) => pou.get(n))).toEqual([
      128n, // computed in DINT
      32768n,
      Math.fround(Math.SQRT2), // a REAL argument: float32 digits, even stored into an LREAL
      Math.SQRT2, // an integer argument computes in LREAL
      Math.sin(1),
      Math.fround(Math.log10(2)), // LOG is base 10
    ])
  })

  test("EXPT computes in REAL only when BOTH arguments are REAL, and in LREAL otherwise", () => {
    const pou = load(`
PROGRAM P
VAR
  r2 : REAL := 2.0; rHalf : REAL := 0.5; r3 : REAL := 3.0; i20 : INT := 20; i2 : INT := 2; im1 : INT := -1;
  realReal : LREAL; realInt : LREAL; intReal : LREAL; negExponent : LREAL;
END_VAR
realReal := EXPT(r2, rHalf); realInt := EXPT(r3, i20); intReal := EXPT(i2, rHalf); negExponent := EXPT(i2, im1);
END_PROGRAM
`)
    pou.scan()
    expect([pou.get("realReal"), pou.get("realInt"), pou.get("intReal"), pou.get("negExponent")]).toEqual([
      Math.fround(Math.SQRT2), // both REAL: float32
      3486784401, // one INT: float64 — float32 would give 3486784512
      Math.SQRT2,
      0.5, // an integer exponent is still real arithmetic
    ])
  })

  test("bit operations: SHL/SHR promote and mask like x86, ROL/ROR keep their width, MUX falls back, bits are two's complement", () => {
    const pou = load(`
PROGRAM P
VAR
  b1 : BYTE := 1; n9 : INT := 9; dw1 : DWORD := 1; n33 : INT := 33; sMin : SINT := -128; b129 : BYTE := 129;
  k : INT := -1; im1 : INT := -1; i0 : INT; wAll : WORD := 65535;
  shlIntoWord : WORD; shlDword : DWORD; shrSigned : SINT; rol9 : BYTE; muxOut : INT; bit15 : BOOL;
END_VAR
shlIntoWord := SHL(b1, n9); shlDword := SHL(dw1, n33); shrSigned := SHR(sMin, 1); rol9 := ROL(b129, n9);
muxOut := MUX(k, 10, 20, 30); bit15 := im1.15; i0.15 := TRUE; wAll.0 := FALSE;
END_PROGRAM
`)
    pou.scan()
    const names = ["shlIntoWord", "shlDword", "shrSigned", "rol9", "muxOut", "bit15", "i0", "wAll"]
    expect(names.map((n) => pou.get(n))).toEqual([
      512n, // BYTE promoted before the shift
      2n, // count 33 masked to 1
      -64n, // arithmetic on a signed value
      3n, // rotate count modulo 8
      30n, // K = -1 picks the last input
      true,
      -32768n, // setting INT's bit 15
      65534n,
    ])
  })

  test("REAL is a 32-bit float and LREAL is not", () => {
    const pou = load("PROGRAM P\nVAR sum32 : REAL; sum64 : LREAL; END_VAR\nsum32 := 0.1 + 0.2; sum64 := 0.1 + 0.2;\nEND_PROGRAM\n")
    pou.scan()
    expect(pou.get("sum32")).toBe(Math.fround(0.3)) // 0.30000001192092896 — CODESYS prints it REAL#0.3
    expect(pou.get("sum64")).toBe(0.1 + 0.2)
  })

  test("an all-constant division into REAL divides as integers first — in a body and in an initializer", () => {
    const pou = load("PROGRAM P\nVAR init : REAL := 7 / 2; half : REAL; END_VAR\nhalf := 7 / 2;\nEND_PROGRAM\n")
    expect(pou.get("init")).toBe(3) // a REAL 3, not the integer 3n it used to hold
    pou.scan()
    expect(pou.get("half")).toBe(3)
  })

  // The `cc_*` recordings (2026-09-15) and `not_result_width` / `mod_by_zero`. Why missed: NOT was only ever tested on an
  // unsigned operand (`NOT u255`), where keeping the type and taking the bit string agree; and no case divided by a zero
  // variable, so MOD's zero was never asked — it threw, as `/` does.
  test("NOT of a signed integer is the bit string of its width; MOD by zero is 0 while / by zero stops", () => {
    const pou = load(
      `PROGRAM P
VAR i5 : INT := 5; s0 : SINT; sn6 : SINT := -6; d0 : DINT; fromInt5 : DINT; fromSint0 : INT; fromNegSint : INT; fromDint0 : LINT; sameInt : INT;
  i7 : INT := 7; iz : INT; dn7 : DINT := -7; dz : DINT; mi : INT; md : DINT; END_VAR
fromInt5 := NOT i5; fromSint0 := NOT s0; fromNegSint := NOT sn6; fromDint0 := NOT d0; sameInt := NOT i5;
mi := i7 MOD iz; md := dn7 MOD dz;
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect(["fromInt5", "fromSint0", "fromNegSint", "fromDint0", "sameInt", "mi", "md"].map((n) => pou.get(n))).toEqual([65530n, 255n, 5n, 4294967295n, -6n, 0n, 0n])
    expect(() => load("PROGRAM P\nVAR a : INT := 7; z : INT; q : INT; END_VAR\nq := a / z;\nEND_PROGRAM", "P").scan()).toThrow("division by zero")
  })

  // Why missed: no initializer or assignment test stored a literal its target could not hold, and none put an integer in
  // a BOOL — the conformance fixtures that do (`overflow_*`, `cc_literal_*`, `cc_init_*_into_bool`) sat inside FBs, which
  // did not lower until calls did.
  test("a constant is stored at its variable's width, and an integer into a BOOL is TRUE when not zero", () => {
    const pou = load(
      "PROGRAM P\nVAR big : INT := 40000; on : BOOL := 1; off : BOOL := 0; si : SINT; minus1 : SINT := -1; masked : INT; END_VAR\nsi := 128; masked := minus1 AND 255;\nEND_PROGRAM\n",
      "P",
    )
    expect([pou.get("big"), pou.get("on"), pou.get("off")]).toEqual([-25536n, true, false])
    pou.scan()
    // a literal typed by its neighbour is NOT wrapped on its way to promotion — `minus1 AND 255` is 255, not -1
    expect([pou.get("si"), pou.get("masked")]).toEqual([-128n, 255n])
  })

  test("one REAL operand — literal or variable, either side — makes the division REAL", () => {
    const pou = load(`
PROGRAM P
VAR
  int7 : INT := 7; real7 : REAL := 7;
  intVarOverReal : REAL; litOverReal : REAL; realVarOverLit : REAL; init : REAL := 7 / 2.0;
END_VAR
intVarOverReal := int7 / 2.0; litOverReal := 7 / 2.0; realVarOverLit := real7 / 2;
END_PROGRAM
`)
    pou.scan()
    // `int7 / 2.0` was 3: the 2.0 took its INT neighbour's type and became the integer 2
    expect([pou.get("intVarOverReal"), pou.get("litOverReal"), pou.get("realVarOverLit"), pou.get("init")]).toEqual([3.5, 3.5, 3.5, 3.5])
  })

  test("a REAL-prefixed literal is float32 even stored into an LREAL — the prefix decides, not the context", () => {
    // Lowering typed every real literal by its context, so `REAL#0.1` into an LREAL was float64's 0.1 (conformance
    // `typed_literal_real_prefix` recorded float32's).
    const pou = load("PROGRAM P\nVAR fromReal : LREAL; fromLreal : LREAL; init : LREAL := REAL#0.1; END_VAR\nfromReal := REAL#0.1; fromLreal := LREAL#0.1;\nEND_PROGRAM\n")
    pou.scan()
    expect([pou.get("fromReal"), pou.get("fromLreal"), pou.get("init")]).toEqual([Math.fround(0.1), 0.1, Math.fround(0.1)])
  })
})

// transpile-review-2026-09-29 task 2.3 (conformance `named_const_expression_keeps`, recorded): a CONSTANT whose
// constant-EXPRESSION initializer overflows its type IS its unwrapped fold — CODESYS reads `D : SINT := K + 1` back as
// SINT#128 and `d2 := D` is 128 — where a variable of that type would hold -128.
describe("interp — a CONSTANT from an overflowing expression", () => {
  test("its slot and every read of it hold the unwrapped fold", () => {
    const pou = load(`PROGRAM P
VAR d1 : INT := D; e1 : INT := E; d2 : INT; e2 : INT; END_VAR
VAR CONSTANT K : SINT := 127; D : SINT := K + 1; U : USINT := 255; E : USINT := U + 3; END_VAR
d2 := D; e2 := E;
END_PROGRAM
`)
    pou.scan()
    expect(["D", "E", "d1", "e1", "d2", "e2"].map((n) => pou.get(n))).toEqual([128n, 258n, 128n, 258n, 128n, 258n])
  })

  // transpile-restructure 6.A.29 (conformance `tr_a29_dint_constant_expression_overflow`, `_udint_…`, recorded): the
  // monitor shows a 32-bit constant's unwrapped fold (D DINT#2147483648, UDINT#4294967296), but every READ of it — in an
  // initializer and at run time — is the value in its type's run-time width: -2147483648 and 0. A SINT's run-time width
  // is DINT, so its 128 survives (above). Another constant folds on from the unwrapped value: F := D - 1 is 2147483647.
  // Lowering read the wide slot as it stood (2147483648, 4294967296).
  test("a read of it is the value in its declared type's run-time width", () => {
    const pou = load(`PROGRAM P
VAR x1 : LINT := D; x2 : LINT; f1 : LINT := F; u1 : ULINT := U; u2 : ULINT; END_VAR
VAR CONSTANT K : DINT := 2147483647; D : DINT := K + 1; F : DINT := D - 1; KU : UDINT := 4294967295; U : UDINT := KU + 1; END_VAR
x2 := D; u2 := U;
END_PROGRAM
`)
    pou.scan()
    expect(["D", "F", "x1", "x2", "f1", "U", "u1", "u2"].map((n) => pou.get(n))).toEqual([2147483648n, 2147483647n, -2147483648n, -2147483648n, 2147483647n, 4294967296n, 0n, 0n])
  })

  // …and one whose fold no 64-bit integer of its signedness holds is refused: CODESYS builds it and fails to log in
  // (code generation), TwinCAT refuses it "Initialisation of constant variable 'D' not constant"
  // (`tr_a29_lint_constant_expression_overflow`, `_ulint_…`, `_dint_constant_overflow_past_lint`, both vendors 2026-10-10).
  test("one whose fold passes 64 bits is refused by name", () => {
    const codes = (constants: string) => lowerSource(`PROGRAM P\nVAR x : LINT; END_VAR\nVAR CONSTANT ${constants} END_VAR\nx := 1;\nEND_PROGRAM\n`, "P").diagnostics.map((d) => d.code)
    expect(codes("K : LINT := 9223372036854775807; D : LINT := K + 1;")).toContain("constant-overflow")
    expect(codes("K : ULINT := 18446744073709551615; D : ULINT := K + 1;")).toContain("constant-overflow")
    expect(codes("K : DINT := 2147483647; Q : DINT := K * K * 4;")).toContain("constant-overflow")
    expect(codes("K : DINT := 2147483647; D : DINT := K + 1;")).toEqual([])
  })
})

// transpile-review-2026-09-29 task 28 (conformance `tr_28_minmax_limit_nan_signed_zero_lreal` / `_real`, recorded as bits):
// MAX(a, b) is `IF a > b THEN a ELSE b`, MIN(a, b) `IF a < b THEN a ELSE b` — the SECOND argument on a tie or a NaN —
// and LIMIT(mn, in, mx) is MIN(MAX(mn, in), mx). The NaN is SQRT(-1)'s, x86's default — its sign SET, as recorded (`wn`),
// which a NaN's bits keep since transpile-restructure 8.2 (`NaNBits`).
describe("interp — MAX / MIN / LIMIT on a NaN and a signed zero", () => {
  const shown = (v: unknown): string => (Object.is(v, -0) ? "-0" : v instanceof NaNBits ? `NaN ${v.bits.toString(16)}` : String(v))
  for (const t of ["LREAL", "REAL"])
    test(`${t}: the second argument on a tie or NaN`, () => {
      const pou = load(`PROGRAM P
VAR seed : ${t} := 1.0; n : ${t}; pz : ${t} := 0.0; nz : ${t};
r1 : ${t}; r2 : ${t}; r3 : ${t}; r4 : ${t}; r5 : ${t}; r6 : ${t}; r7 : ${t}; r8 : ${t}; r9 : ${t}; END_VAR
n := SQRT(0.0 - seed); nz := pz * (0.0 - seed);
r1 := MAX(n, 1); r2 := MAX(1, n); r3 := MIN(n, 1); r4 := MIN(1, n);
r5 := LIMIT(0, n, 5); r6 := LIMIT(n, 1, 5); r7 := LIMIT(0, 1, n);
r8 := MAX(nz, pz); r9 := MAX(pz, nz);
END_PROGRAM
`)
      pou.scan()
      const nan = t === "REAL" ? "NaN ffc00000" : "NaN fff8000000000000"
      expect(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"].map((n) => shown(pou.get(n)))).toEqual(["1", nan, "1", nan, "5", "1", nan, "0", "-0"])
    })
})
