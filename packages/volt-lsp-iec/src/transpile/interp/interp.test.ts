import { describe, expect, test } from "bun:test"
import { load } from "../index.js"

describe("interp — the executable core", () => {
  test("a PRG with IF/ELSIF and a counter runs scan cycles", () => {
    const pou = load(`
PROGRAM Counter
VAR_INPUT
  Enable : BOOL;
  Reset  : BOOL;
END_VAR
VAR_OUTPUT
  iCount : INT;
  Done   : BOOL;
END_VAR
VAR
  MaxCount : INT := 3;
END_VAR
IF Reset THEN
  iCount := 0;
ELSIF Enable AND iCount < MaxCount THEN
  iCount := iCount + 1;
END_IF
Done := iCount >= MaxCount;
END_PROGRAM
`)
    expect(pou.get("iCount")).toBe(0n)

    pou.scan() // disabled — nothing moves
    expect(pou.get("iCount")).toBe(0n)

    pou.set("Enable", true)
    for (let i = 0; i < 5; i++) pou.scan()
    expect(pou.get("iCount")).toBe(3n) // clamped at MaxCount
    expect(pou.get("Done")).toBe(true)

    pou.set("Reset", true)
    pou.scan()
    expect(pou.get("iCount")).toBe(0n)
    expect(pou.get("Done")).toBe(false)
  })

  test("CASE, FOR and integer division", () => {
    const pou = load(`
PROGRAM Calc
VAR
  Mode : INT := 2;
  Sum  : INT;
  Half : INT;
  i    : INT;
END_VAR
CASE Mode OF
  1: Sum := -1;
  2, 3: FOR i := 1 TO 5 BY 2 DO Sum := Sum + i; END_FOR
ELSE
  Sum := 99;
END_CASE
Half := 7 / 2;
END_PROGRAM
`)
    pou.scan()
    expect(pou.get("Sum")).toBe(9n) // 1 + 3 + 5
    expect(pou.get("Half")).toBe(3n) // truncating, not 3.5
  })

  test("WHILE, REPEAT and EXIT agree on when they stop", () => {
    const pou = load(`
PROGRAM P
VAR
  w : INT;
  r : INT;
  e : INT;
END_VAR
WHILE w < 4 DO w := w + 1; END_WHILE
REPEAT r := r + 1; UNTIL r >= 4 END_REPEAT
WHILE TRUE DO
  e := e + 1;
  IF e = 2 THEN EXIT; END_IF
END_WHILE
END_PROGRAM
`)
    pou.scan()
    expect([pou.get("w"), pou.get("r"), pou.get("e")]).toEqual([4n, 4n, 2n])
  })

  test("REPEAT always runs its body once, even when the condition already holds", () => {
    const pou = load("PROGRAM P\nVAR n : INT := 10; END_VAR\nREPEAT n := n + 1; UNTIL n > 0 END_REPEAT\nEND_PROGRAM\n")
    pou.scan()
    expect(pou.get("n")).toBe(11n)
  })

  test("a FOR limit is read once, so changing it mid-loop does not extend the loop", () => {
    const pou = load(`
PROGRAM P
VAR
  i     : INT;
  bound : INT := 3;
  runs  : INT;
END_VAR
FOR i := 1 TO bound DO
  bound := 100;
  runs := runs + 1;
END_FOR
END_PROGRAM
`)
    pou.scan()
    expect(pou.get("runs")).toBe(3n)
  })

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

  // The three below were found by the differential oracle (test/exec) — CODESYS's answers, not recollection.
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

  test("S= and R= latch — they act only when the condition is TRUE, and the whole right-hand side is the condition", () => {
    const pou = load(`
PROGRAM P
VAR
  t : BOOL := TRUE; f : BOOL; i7 : INT := 7; flag : BOOL := TRUE; w : WORD;
  setByTrue : BOOL; latched : BOOL := TRUE; resetByTrue : BOOL := TRUE; keptOnFalse : BOOL := TRUE; viaExpr : BOOL;
END_VAR
setByTrue S= t; latched S= f; resetByTrue R= t; keptOnFalse R= f; viaExpr S= (i7 > 5) AND flag; w.2 S= t;
END_PROGRAM
`)
    pou.scan()
    const names = ["setByTrue", "latched", "resetByTrue", "keptOnFalse", "viaExpr", "w"]
    expect(names.map((n) => pou.get(n))).toEqual([
      true,
      true, // S= FALSE leaves a set latch set — it is not `:=`
      false,
      true, // R= FALSE leaves it too
      true,
      4n, // a bit place latches like any other
    ])
  })

  test("a set/reset chain acts on its FINAL value at every link — `a S= b R= c` is `b R= c` and `a S= c`", () => {
    const pou = load(`
PROGRAM P
VAR a1 : BOOL; b1 : BOOL; c1 : BOOL := TRUE; a2 : BOOL; b2 : BOOL := TRUE; c2 : BOOL; END_VAR
a1 S= b1 R= c1; a2 S= b2 R= c2;
END_PROGRAM
`)
    pou.scan()
    // latching on the OLD b would give a1 FALSE and a2 TRUE — CODESYS gives the opposite
    expect([pou.get("a1"), pou.get("b1"), pou.get("a2"), pou.get("b2")]).toEqual([true, false, false, true])
  })

  test("a latch in a chain passes the VALUE on, not its target's state — `plain := latch S= cond`", () => {
    const pou = load(`
PROGRAM P
VAR plain1 : BOOL; latch1 : BOOL; cond1 : BOOL := TRUE; plain2 : BOOL; latch2 : BOOL := TRUE; cond2 : BOOL; END_VAR
plain1 := latch1 S= cond1; plain2 := latch2 S= cond2;
END_PROGRAM
`)
    pou.scan()
    // plain2 is FALSE although latch2 stays TRUE: it received cond2, not latch2
    expect([pou.get("plain1"), pou.get("latch1"), pou.get("plain2"), pou.get("latch2")]).toEqual([true, true, false, true])
  })

  test("TIME is 32-bit milliseconds and LTIME 64-bit nanoseconds — both wrap, and TIME × an INT stays TIME", () => {
    // Every duration used to be an unbounded bigint of NANOSECONDS, and a TIME initializer never folded (slots began at 0)
    const pou = load(`
PROGRAM P
VAR
  timeMax : TIME := T#49D17H2M47S295MS; oneMs : TIME := T#1MS; t1s : TIME := T#1S; t500 : TIME := T#500MS; three : INT := 3;
  lt1s : LTIME := LTIME#1S; oneNs : LTIME := LTIME#1NS;
  over : TIME; negative : TIME; tripled : TIME; asDint : DINT; asLint : LINT;
END_VAR
over := timeMax + oneMs; negative := t500 - t1s; tripled := t1s * three;
asDint := TIME_TO_DINT(t1s); asLint := LTIME_TO_LINT(lt1s + oneNs);
END_PROGRAM
`)
    pou.scan()
    const names = ["over", "negative", "tripled", "asDint", "asLint"]
    expect(names.map((n) => pou.get(n))).toEqual([
      0n, // TIME's maximum + 1 ms wraps
      4294966796n, // 500 ms - 1 s wraps below zero, like a UDINT
      3000n, // milliseconds
      1000n,
      1000000001n, // LTIME keeps nanoseconds
    ])
  })

  test("DATE and DT count seconds, TOD milliseconds, the L variants nanoseconds — as literals and as initializers", () => {
    // A date literal reached lowering as its TEXT and was typed STRING; as an initializer it never folded (slot = 0).
    const pou = load(`
PROGRAM P
VAR
  d1 : DATE := D#1970-01-02; dt1 : DT := DT#1970-01-01-00:00:01; tod1 : TOD := TOD#00:00:01;
  ldt1 : LDT := LDT#1970-01-01-00:00:01; early : DT := DT#2024-01-01-00:00:00;
  dateUnits : UDINT; dtUnits : UDINT; todUnits : UDINT; ldtUnits : ULINT; before : BOOL;
END_VAR
dateUnits := DATE_TO_UDINT(d1); dtUnits := DT_TO_UDINT(dt1); todUnits := TOD_TO_UDINT(tod1);
ldtUnits := LDT_TO_ULINT(ldt1); before := early < DT#2024-01-01-00:00:01;
END_PROGRAM
`)
    pou.scan()
    const names = ["dateUnits", "dtUnits", "todUnits", "ldtUnits", "before"]
    expect(names.map((n) => pou.get(n))).toEqual([86400n, 1n, 1000n, 1000000000n, true])
  })

  test("date arithmetic scales between units — truncating into seconds, wrapping, and TOD not reduced modulo a day", () => {
    // `dt + T#1S` had no common type at all; stamped naively, the 1000-ms literal would have added 1000 SECONDS
    const pou = load(`
PROGRAM P
VAR
  epoch : DT := DT#1970-01-01-00:00:00; t1500 : TIME := T#1500MS; dtMax : DT := DT#2106-02-07-06:28:15;
  d28 : DATE := D#2024-02-28; mar1 : DATE := D#2024-03-01; noon : TOD := TOD#12:30:15.5; halfDay : TIME := T#12H;
  plusFraction : UDINT; wrapped : UDINT; forward : UDINT; backward : UDINT; pastMidnight : UDINT; nextDay : UDINT;
END_VAR
plusFraction := DT_TO_UDINT(epoch + t1500); wrapped := DT_TO_UDINT(dtMax + T#1S);
forward := TIME_TO_UDINT(mar1 - d28); backward := TIME_TO_UDINT(d28 - mar1);
pastMidnight := TOD_TO_UDINT(noon + halfDay); nextDay := DATE_TO_UDINT(d28 + T#1D);
END_PROGRAM
`)
    pou.scan()
    const names = ["plusFraction", "wrapped", "forward", "backward", "pastMidnight", "nextDay"]
    expect(names.map((n) => pou.get(n))).toEqual([
      1n, // 1500 ms into seconds truncates
      0n, // DT is 32-bit seconds: its maximum + 1 s is the epoch
      172800000n, // two days, in TIME's milliseconds
      4122167296n, // the reverse wraps as a UDINT
      88215500n, // TOD is not reduced modulo a day
      1709164800n, // 2024-02-29, in seconds
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

  test("AND_THEN does not evaluate its right side", () => {
    // `1 / zero` would throw if the short circuit were folded into an eager AND
    const pou = load(`
PROGRAM P
VAR
  zero : INT;
  ok   : BOOL;
END_VAR
ok := (zero <> 0) AND_THEN (10 / zero > 1);
END_PROGRAM
`)
    expect(() => pou.scan()).not.toThrow()
    expect(pou.get("ok")).toBe(false)
  })

  test("a REAL-prefixed literal is float32 even stored into an LREAL — the prefix decides, not the context", () => {
    // Lowering typed every real literal by its context, so `REAL#0.1` into an LREAL was float64's 0.1 (test/exec
    // `typed_literal_real_prefix` recorded float32's).
    const pou = load("PROGRAM P\nVAR fromReal : LREAL; fromLreal : LREAL; init : LREAL := REAL#0.1; END_VAR\nfromReal := REAL#0.1; fromLreal := LREAL#0.1;\nEND_PROGRAM\n")
    pou.scan()
    expect([pou.get("fromReal"), pou.get("fromLreal"), pou.get("init")]).toEqual([Math.fround(0.1), 0.1, Math.fround(0.1)])
  })

  test("a value set from outside is stored as the slot's type holds it", () => {
    // `set` wrote the raw value, so a test could plant 300 in a SINT — a value no program on the PLC can produce
    const pou = load("PROGRAM P\nVAR si : SINT; r : REAL; five : STRING(5); END_VAR\nsi := si;\nEND_PROGRAM\n")
    pou.set("si", 300n)
    pou.set("r", 0.1)
    pou.set("five", "abcdefgh")
    expect([pou.get("si"), pou.get("r"), pou.get("five")]).toEqual([44n, Math.fround(0.1), "abcde"])
  })

  test("an unlowerable POU is refused at load, not run half-way", () => {
    // ADR, not MAX: MAX lowers now. ADR waits on the memory model (design §9), so it stays unlowerable for a while.
    expect(() => load("PROGRAM P\nVAR x : INT; END_VAR\nx := ADR(x);\nEND_PROGRAM\n")).toThrow(/expr-call/)
  })
})

describe("interp — STRING (design §18; every expectation recorded in test/exec `string_*`)", () => {
  /** A Standard declaration as the bridge materializes it, from its one-line signature. */
  const standard = (signature: string) => {
    const [, name, params, result] = /^(\w+)\((.*)\) : (.+)$/.exec(signature)!
    const inputs = params!.split("; ").map((p) => `  ${p};`).join("\n")
    return { uri: `Library Manager/Standard/${name}.fun`, source: `FUNCTION ${name} : ${result}\nVAR_INPUT\n${inputs}\nEND_VAR\nEND_FUNCTION\n` }
  }
  const LIBRARIES = [
    "INSERT(STR1 : STRING(255); STR2 : STRING(255); POS : INT) : STRING(255)",
    "REPLACE(STR1 : STRING(255); STR2 : STRING(255); L : INT; P : INT) : STRING(255)",
    "FIND(STR1 : STRING(255); STR2 : STRING(255)) : INT",
  ].map(standard)
  const scanned = (vars: string, body: string) => {
    const pou = load(`PROGRAM P\nVAR\n${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`, undefined, LIBRARIES)
    pou.scan()
    return pou
  }

  test("a store keeps the target's capacity — STRING(5) := 'abcdefgh' is 'abcde'", () => {
    expect(scanned("five : STRING(5);", "five := 'abcdefgh';").get("five")).toBe("abcde")
  })

  test("a WSTRING counts UTF-16 units — \"héllo\" into a WSTRING(3) is \"hél\"", () => {
    expect(scanned('short3 : WSTRING(3); wide : WSTRING := "héllo";', "short3 := wide;").get("short3")).toBe("hél")
  })

  test("the position edges — INSERT past the end, REPLACE at 0, FIND of nothing", () => {
    const pou = scanned(
      "abc : STRING := 'abc'; inserted : STRING; replaced : STRING; found : INT;",
      "inserted := INSERT(abc, 'XY', 5); replaced := REPLACE(abc, 'XY', 1, 0); found := FIND(abc, '');",
    )
    expect([pou.get("inserted"), pou.get("replaced"), pou.get("found")]).toEqual(["abc", "XYabc", 0n])
  })

  test("STRING_TO_REAL reads a decimal prefix after spaces and tabs — and nothing numeric is 0", () => {
    const pou = scanned(
      "dotFirst : STRING := '.5'; bareExp : STRING := '$T1.5E'; word : STRING := 'abc'; x : REAL; y : REAL; z : REAL;",
      "x := STRING_TO_REAL(dotFirst); y := STRING_TO_REAL(bareExp); z := STRING_TO_REAL(word);",
    )
    expect([pou.get("x"), pou.get("y"), pou.get("z")]).toEqual([0.5, 1.5, 0])
  })

  test("STRING_TO_INT skips leading spaces, takes a sign, stops at a non-digit — and wraps", () => {
    const pou = scanned("spaced : STRING := ' +12abc'; huge : STRING := '99999'; x : INT; y : INT;", "x := STRING_TO_INT(spaced); y := STRING_TO_INT(huge);")
    expect([pou.get("x"), pou.get("y")]).toEqual([12n, -31073n])
  })
})
