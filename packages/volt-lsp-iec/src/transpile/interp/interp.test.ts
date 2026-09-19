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
  rv : INT;
  e : INT;
END_VAR
WHILE w < 4 DO w := w + 1; END_WHILE
REPEAT rv := rv + 1; UNTIL rv >= 4 END_REPEAT
WHILE TRUE DO
  e := e + 1;
  IF e = 2 THEN EXIT; END_IF
END_WHILE
END_PROGRAM
`)
    pou.scan()
    expect([pou.get("w"), pou.get("rv"), pou.get("e")]).toEqual([4n, 4n, 2n])
  })

  test("REPEAT always runs its body once, even when the condition already holds", () => {
    const pou = load("PROGRAM P\nVAR n : INT := 10; END_VAR\nREPEAT n := n + 1; UNTIL n > 0 END_REPEAT\nEND_PROGRAM\n")
    pou.scan()
    expect(pou.get("n")).toBe(11n)
  })

  // This claimed the limit was read once (3 runs) — never recorded. CODESYS reads it on every pass (conformance
  // `callshape_for_bounds_changed_in_body`, recorded in the review of batch 3a), so raising it mid-loop extends the loop.
  test("a FOR limit is read on every pass, so raising it mid-loop extends the loop", () => {
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
    expect(pou.get("runs")).toBe(100n)
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

  // Phase 3 step 2 (design §9): the frame is a tree of owned values. Before it, any struct-, FB- or array-typed variable
  // refused the whole POU (`slot-struct`, `slot-function_block`, `slot-array`).
  test("structs, FB instances and arrays are values in the frame — fields, bounds, bits and whole copies", () => {
    const pou = load(
      `TYPE T_Point : STRUCT x : INT := 7; y : INT; END_STRUCT END_TYPE
TYPE T_Line : STRUCT a : T_Point; b : T_Point; flag : BIT; END_STRUCT END_TYPE
FUNCTION_BLOCK FB_Holder
VAR_OUTPUT q : INT := 3; END_VAR
END_FUNCTION_BLOCK
PROGRAM P
VAR
  line1 : T_Line; line2 : T_Line;
  table : ARRAY[1..3] OF T_Point;
  grid : ARRAY[0..1, 5..6] OF INT;
  holder : FB_Holder;
  got : INT; bits : WORD;
END_VAR
line1.a.y := 5;
line1.flag := TRUE;
line2 := line1;
line1.a.y := 99;
table[3].x := line2.a.y;
grid[1, 6] := table[1].x + holder.q;
line1.b.x.1 := FALSE;
got := line1.b.x;
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect([pou.get("line2.a.y"), pou.get("line2.flag"), pou.get("line1.a.y")]).toEqual([5n, true, 99n]) // a copy, not an alias
    expect([pou.get("table[3].x"), pou.get("grid[1][6]"), pou.get("line2.b.x")]).toEqual([5n, 10n, 7n]) // x starts at its field's 7
    expect(pou.get("got")).toBe(5n) // bit 1 cleared on 7 (0b111)
  })

  // Phase 3 step 3: calls on declared FB instances, as CODESYS recorded them (conformance `fbcall_*`). Before it, any
  // `inst(...)` refused the whole POU (`stmt-call_stmt`, 84% of the corpus).
  test("an FB call stores its inputs, runs the body on the instance, reads its outputs; VAR_IN_OUT writes back", () => {
    const pou = load(
      `FUNCTION_BLOCK FB_Add
VAR_INPUT a : INT; b : INT; END_VAR
VAR_OUTPUT sum : INT; END_VAR
VAR count : INT; END_VAR
count := count + 1;
sum := a + b;
END_FUNCTION_BLOCK
FUNCTION_BLOCK FB_Bump
VAR_IN_OUT v : INT; END_VAR
VAR inner : FB_Add; END_VAR
inner(a := v, b := 10, sum => v);
END_FUNCTION_BLOCK
PROGRAM P
VAR adder : FB_Add; bump : FB_Bump; wide : DINT; n : INT := 1; again : INT; END_VAR
adder(a := 30000, b := 1, sum => wide);
adder(b := 2);
again := adder.sum;
bump(v := n);
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect(pou.get("wide")).toBe(30001n) // an INT output widened into a DINT on its way out
    expect([pou.get("adder.a"), pou.get("again"), pou.get("adder.count")]).toEqual([30000n, 30002n, 2n]) // `a` kept its value
    expect([pou.get("n"), pou.get("bump.inner.count")]).toEqual([11n, 1n]) // written back through a nested instance
    pou.scan()
    expect(pou.get("n")).toBe(21n)
  })

  // Phase 3 step 4: METHOD, ACTION and FUNCTION calls, as CODESYS recorded them (conformance `fbcall_method_locals`,
  // `fbcall_action`, `fbcall_function_locals`). Before it, `inst.M()` and `F(x)` refused the whole POU (`call-method`,
  // `expr-call`).
  test("a METHOD's and a FUNCTION's locals start over per call; an ACTION runs on its FB; VAR_IN_OUT reaches a routine", () => {
    const pou = load(
      `FUNCTION_BLOCK FB_M
VAR calls : INT; count : INT; END_VAR
END_FUNCTION_BLOCK
METHOD Tick : INT
VAR_INPUT amount : INT; END_VAR
VAR localCount : INT; END_VAR
localCount := localCount + amount;
calls := calls + 1;
Tick := localCount;
END_METHOD
METHOD AddTo
VAR_IN_OUT target : INT; END_VAR
target := target + calls;
END_METHOD
ACTION Inc
count := count + 1;
END_ACTION
FUNCTION F_Acc : INT
VAR_INPUT amount : INT; END_VAR
VAR acc : INT; END_VAR
acc := acc + amount;
F_Acc := acc;
END_FUNCTION
PROGRAM P
VAR inst : FB_M; first : INT; second : INT; viaF : INT; viaPositional : INT; sink : INT := 100; END_VAR
first := inst.Tick(amount := 3);
second := inst.Tick(amount := 3);
inst.Inc();
inst.Inc();
viaF := F_Acc(amount := 4);
viaPositional := F_Acc(4);
inst.AddTo(target := sink);
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect([pou.get("first"), pou.get("second"), pou.get("inst.calls")]).toEqual([3n, 3n, 2n])
    expect([pou.get("inst.count"), pou.get("viaF"), pou.get("viaPositional"), pou.get("sink")]).toEqual([2n, 4n, 4n, 102n])
  })

  // Phase 3 step 5: globals and PROGRAM calls, as CODESYS recorded them (conformance `fbcall_program_writes_global`: the
  // called program's VAR persists and the global it writes is what the caller reads). Before it, a GVL variable, a
  // VAR_EXTERNAL and a PROGRAM call each refused the POU (`place-not-local`, `call-program`) — and a VAR_EXTERNAL was
  // declared as a LOCAL copy, so a write through it would never have reached the global.
  test("a PROGRAM's instance and a GVL variable are the application's — shared by every body, VAR_EXTERNAL included", () => {
    const pou = load(
      `VAR_GLOBAL
  gShared : INT;
  gStart : INT := 100;
END_VAR
FUNCTION_BLOCK FB_Reader
VAR_OUTPUT seenByFb : INT; END_VAR
seenByFb := gShared + gStart;
END_FUNCTION_BLOCK
PROGRAM PRG_Writer
VAR runs : INT; END_VAR
runs := runs + 1;
gShared := runs * 7;
END_PROGRAM
PROGRAM PLC_PRG
VAR_EXTERNAL gShared : INT; END_VAR
VAR reader : FB_Reader; seen : INT; viaFb : INT; runsSeen : INT; END_VAR
PRG_Writer();
seen := gShared;
reader(seenByFb => viaFb);
runsSeen := PRG_Writer.runs;
END_PROGRAM`,
      "PLC_PRG",
    )
    pou.scan()
    pou.scan()
    expect([pou.get("seen"), pou.get("viaFb"), pou.get("runsSeen")]).toEqual([14n, 114n, 2n])
  })

  // Enums and THIS^, as CODESYS recorded them (conformance `type_dut_enum_*`, `cc_enum_*`, `keyword_this_dereference`,
  // `use_self_method_call`). Before them an enum variable, an enum value and `THIS^` each refused the POU.
  test("an enum value is its number and an enum variable its base type; THIS^ is the instance a body runs on", () => {
    const pou = load(
      `TYPE E_Implicit : (Idle, Running, Halted); END_TYPE
TYPE E_Written : (Released := 0, Pressed := 5, HeldLong); END_TYPE
TYPE E_Byte : (LevelA, LevelB) BYTE; END_TYPE
TYPE E_Other : (O0, O1); END_TYPE
FUNCTION_BLOCK FB_Self
VAR count : INT; END_VAR
END_FUNCTION_BLOCK
METHOD Inner
THIS^.count := THIS^.count + 1;
END_METHOD
METHOD Outer
THIS^.Inner();
THIS^.Inner();
END_METHOD
PROGRAM P
VAR
  running : E_Implicit; held : E_Written; level : E_Byte; other : E_Other;
  asWord : WORD; same : BOOL; picked : INT; inst : FB_Self;
END_VAR
running := E_Implicit.Running;
held := HeldLong;
level := E_Byte.LevelB;
asWord := held;
same := running = O1;
CASE held OF
  E_Written.Pressed: picked := 1;
  HeldLong: picked := 2;
END_CASE
inst.Outer();
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect([pou.get("running"), pou.get("held"), pou.get("level"), pou.get("asWord")]).toEqual([1n, 6n, 1n, 6n])
    expect([pou.get("same"), pou.get("picked"), pou.get("inst.count")]).toEqual([true, 2n, 2n])
  })

  // Phase 3 step 6a: the byte layout, as the 64-bit simulator measured it (conformance `mem_sizeof_struct_mixed`,
  // `mem_sizeof_fb_instance`, `mem_member_offsets`) — SIZEOF and a difference of addresses in one variable are constants.
  test("SIZEOF and ADR(a) - ADR(b) follow the measured layout: C alignment, a STRING's terminator, an FB's header", () => {
    const pou = load(
      `TYPE T_Mixed : STRUCT b : BYTE; i : INT; d : DINT; x : BOOL; l : LREAL; END_STRUCT END_TYPE
FUNCTION_BLOCK FB_Sized
VAR b : BYTE; d : DINT; END_VAR
END_FUNCTION_BLOCK
PROGRAM P
VAR
  sv : T_Mixed; arr : ARRAY[0..2] OF T_Mixed; str : STRING; inst : FB_Sized;
  szStruct : ULINT; szArr : ULINT; szBool : ULINT; szString : ULINT; szInst : ULINT; szType : ULINT;
  offI : ULINT; offD : ULINT; offX : ULINT; offL : ULINT; offElement : ULINT;
END_VAR
szStruct := SIZEOF(sv); szArr := SIZEOF(arr); szBool := SIZEOF(sv.x); szString := SIZEOF(str); szInst := SIZEOF(inst);
szType := SIZEOF(T_Mixed);
offI := ADR(sv.i) - ADR(sv); offD := ADR(sv.d) - ADR(sv); offX := ADR(sv.x) - ADR(sv); offL := ADR(sv.l) - ADR(sv);
offElement := ADR(arr[2].d) - ADR(arr[0]);
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect(["szStruct", "szArr", "szBool", "szString", "szInst", "szType"].map((n) => pou.get(n))).toEqual([24n, 72n, 1n, 81n, 16n, 24n])
    expect(["offI", "offD", "offX", "offL", "offElement"].map((n) => pou.get(n))).toEqual([2n, 4n, 8n, 16n, 52n])
  })

  // Phase 3 step 6b: pointers and references with one target (design §9 form 1), as CODESYS recorded them (conformance
  // `type_pointer_to_int`, `mem_pointer_index_struct_array`, `mem_pointer_to_instance_method`, `type_reference_to_int`,
  // `op_sys_isvalidref`, `keyword_null_pointer_init`).
  test("a pointer or reference reaches its one target — elements step, a method runs through it, null faults", () => {
    const source = `TYPE T_Pt : STRUCT x : INT; y : REAL; END_STRUCT END_TYPE
FUNCTION_BLOCK FB_Counter
VAR n : INT; END_VAR
END_FUNCTION_BLOCK
METHOD Bump
n := n + 1;
END_METHOD
PROGRAM P
VAR
  iValue : INT := 7; pInt : POINTER TO INT; iCopy : INT;
  arr : ARRAY[0..4] OF T_Pt; p : POINTER TO T_Pt; q : POINTER TO T_Pt; k : INT;
  viaDeref : INT; viaIndex : INT; viaStep : INT;
  inst : FB_Counter; pInst : POINTER TO FB_Counter; got : INT;
  target : INT := 42; ref1 : REFERENCE TO INT; valid : BOOL; throughRef : INT;
  nullPtr : POINTER TO INT := 0; isNull : BOOL; notNull : BOOL;
END_VAR
pInt := ADR(iValue); iCopy := pInt^; pInt^ := iCopy + 1;
FOR k := 0 TO 4 DO arr[k].x := k * 10; END_FOR
p := ADR(arr[1]); viaDeref := p^.x; viaIndex := p[2].x;
q := p + SIZEOF(T_Pt); viaStep := q^.x; p[3].x := 77;
pInst := ADR(inst); pInst^.Bump(); pInst^.Bump(); got := pInst^.n;
ref1 REF= target; valid := __ISVALIDREF(ref1); throughRef := ref1; ref1 := ref1 + 1;
isNull := (nullPtr = 0); notNull := pInt <> 0;
END_PROGRAM`
    const pou = load(source, "P")
    pou.scan()
    expect([pou.get("iCopy"), pou.get("iValue")]).toEqual([7n, 8n])
    expect([pou.get("viaDeref"), pou.get("viaIndex"), pou.get("viaStep"), pou.get("arr[4].x")]).toEqual([10n, 30n, 20n, 77n])
    expect([pou.get("got"), pou.get("inst.n")]).toEqual([2n, 2n])
    expect([pou.get("valid"), pou.get("throughRef"), pou.get("target")]).toEqual([true, 42n, 43n])
    expect([pou.get("isNull"), pou.get("notNull")]).toEqual([true, true])
    // a dereference of a null pointer stops the program, as it stops the CODESYS application
    const faulting = load("PROGRAM F\nVAR v : INT; ok : INT; pv : POINTER TO INT; END_VAR\npv := ADR(v); pv := 0; ok := pv^;\nEND_PROGRAM\n", "F")
    expect(() => faulting.scan()).toThrow("dereference of a null pointer")
  })

  // Phase 3½ (2026-09-15), the rules the `inh_*` recordings measured: calling a derived FB runs only its own body;
  // `SUPER^(in := x)` assigns the instance's input and runs the base body on it; that base body's bare `Hook()` reaches
  // the derived override; `SUPER^.Hook()` is the base's.
  test("inheritance: a derived body runs alone, SUPER^ runs the base, and a method call reaches the override", () => {
    const pou = load(
      `PROGRAM P
VAR plain : FB_D; viaSuper : FB_S; END_VAR
plain(inBase := 7);
viaSuper(inBase := 5);
END_PROGRAM
FUNCTION_BLOCK FB_B
VAR_INPUT inBase : INT; END_VAR
VAR nBase : INT; hookBase : INT; END_VAR
nBase := nBase + 1;
Hook();
END_FUNCTION_BLOCK
METHOD Hook
hookBase := hookBase + 1;
END_METHOD
FUNCTION_BLOCK FB_D EXTENDS FB_B
VAR nDerived : INT; hookDerived : INT; END_VAR
nDerived := nDerived + inBase;
END_FUNCTION_BLOCK
METHOD Hook
hookDerived := hookDerived + 1;
END_METHOD
FUNCTION_BLOCK FB_S EXTENDS FB_B
VAR hookDerived : INT; END_VAR
SUPER^(inBase := inBase + 100);
SUPER^.Hook();
END_FUNCTION_BLOCK
METHOD Hook
hookDerived := hookDerived + 1;
END_METHOD`,
      "P",
    )
    pou.scan()
    // the base body did not run for `plain` (inh_call_runs_derived_body)
    expect([pou.get("plain.nBase"), pou.get("plain.nDerived"), pou.get("plain.hookBase"), pou.get("plain.hookDerived")]).toEqual([0n, 7n, 0n, 0n])
    // SUPER^ assigned 105 and ran the base body, whose Hook() is the override; SUPER^.Hook() is the base's
    expect([pou.get("viaSuper.inBase"), pou.get("viaSuper.nBase"), pou.get("viaSuper.hookDerived"), pou.get("viaSuper.hookBase")]).toEqual([105n, 1n, 1n, 1n])
  })

  // `state_any_input_sizes`: an ANY / ANY_NUM input's `diSize` is the argument's byte size, as SIZEOF lays it out — INT 2,
  // LREAL 8, BOOL 1, STRING(10) 11, a {BYTE; DINT} struct 8. Why missed: ANY had no type, so a function taking one was
  // refused — and the one recorded case read a single INT.
  test("an ANY input's diSize is its argument's byte size", () => {
    const pou = load(
      `PROGRAM P
VAR intArg : INT; lrealArg : LREAL; str10 : STRING(10); boolArg : BOOL; pairArg : T_Pair;
  sizeInt : DINT; sizeLreal : DINT; sizeString : DINT; sizeBool : DINT; sizePair : DINT; numLreal : DINT; END_VAR
sizeInt := F_Size(intArg); sizeLreal := F_Size(lrealArg); sizeString := F_Size(str10); sizeBool := F_Size(boolArg);
sizePair := F_Size(pairArg); numLreal := F_NumSize(anyNum := lrealArg);
END_PROGRAM
FUNCTION F_Size : DINT
VAR_INPUT anyArg : ANY; END_VAR
F_Size := anyArg.diSize;
END_FUNCTION
FUNCTION F_NumSize : DINT
VAR_INPUT anyNum : ANY_NUM; END_VAR
F_NumSize := anyNum.diSize;
END_FUNCTION
TYPE T_Pair : STRUCT a : BYTE; b : DINT; END_STRUCT END_TYPE`,
      "P",
    )
    pou.scan()
    expect(["sizeInt", "sizeLreal", "sizeString", "sizeBool", "sizePair", "numLreal"].map((n) => pou.get(n))).toEqual([2n, 8n, 11n, 1n, 8n, 8n])
  })

  // `type_codesys_xint`, `type_implicit_enum_inline`, `type_array_2d` (recorded once the recorder read them): `__XINT` is a
  // LINT on the 64-bit target, an inline enum's value folds as a TYPE enum's does, a 2D element reads as `m[i, j]`. Why
  // missed: the recorder read none of these, so no value ever reached the replay, and `:= Idle` did not fold.
  test("a pointer-width integer, an inline enum's initial value, and a 2D array element read by path", () => {
    const pou = load(
      `PROGRAM P
VAR x : __XINT; state : (Idle, Running, Halted) := Idle; m : ARRAY[0..1, 0..2] OF REAL; wasIdle : BOOL; END_VAR
x := 42;
wasIdle := state = Idle;
state := Running;
m[1, 2] := 1.5;
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect([pou.get("x"), pou.get("state"), pou.get("wasIdle"), pou.get("m[1, 2]"), pou.get("m[0, 0]")]).toEqual([42n, 1n, true, 1.5, 0])
  })

  // `state_program_called_from_fb`: a PROGRAM called from an FB's body is the one instance PLC_PRG calls. Why missed: a
  // program was callable from the POU's own body only, as Rust held its instance for the root scan alone.
  test("a PROGRAM called from inside an FB is the same one instance the POU calls", () => {
    const pou = load(
      `PROGRAM P
VAR inst : FB_C; direct : INT; END_VAR
inst();
PRG_Counted();
direct := PRG_Counted.runs;
END_PROGRAM
PROGRAM PRG_Counted
VAR runs : INT; END_VAR
runs := runs + 1;
END_PROGRAM
FUNCTION_BLOCK FB_C
VAR_OUTPUT seen : INT; END_VAR
PRG_Counted();
seen := PRG_Counted.runs;
END_FUNCTION_BLOCK`,
      "P",
    )
    pou.scan()
    pou.scan()
    expect([pou.get("inst.seen"), pou.get("direct")]).toEqual([3n, 4n])
  })

  // `state_call_after_global_init_counts`: the method runs once per instance before the first scan, however many scans
  // follow. Why missed: `call_after_global_init_slot` wrote `iCount := 1`, and an FB carrying it was refused.
  test("a call_after_global_init_slot METHOD runs once per instance, before the first scan", () => {
    const pou = load(
      `PROGRAM P
VAR one : FB_I; two : FB_I; END_VAR
one();
two();
END_PROGRAM
FUNCTION_BLOCK FB_I
VAR inits : INT; scans : INT; END_VAR
scans := scans + 1;
END_FUNCTION_BLOCK
{attribute 'call_after_global_init_slot' := '50000'}
METHOD AfterGlobalInit
inits := inits + 1;
END_METHOD`,
      "P",
    )
    expect([pou.get("one.inits"), pou.get("one.scans")]).toEqual([1n, 0n]) // run at start, before any scan
    pou.scan()
    pou.scan()
    pou.scan()
    expect(["one.inits", "one.scans", "two.inits", "two.scans"].map((n) => pou.get(n))).toEqual([1n, 3n, 1n, 3n])
  })

  // `state_routine_outputs`: a FUNCTION's and a METHOD's VAR_OUTPUT starts over at every call, is read through `=>`, and
  // may be left unconnected. Why missed: routine outputs were refused, and `var_output_on_function` wrote 0 — a value
  // no store could be told from.
  test("a routine's VAR_OUTPUT starts over every call and is read through =>, connected or not", () => {
    const pou = load(
      `PROGRAM P
VAR inst : FB_O; units : INT; tens : INT; calls1 : INT; calls2 : INT; units2 : INT; took : INT; before : INT; kept1 : INT; kept2 : INT; END_VAR
units := F_S(value := 47, tens => tens, calls => calls1);
units2 := F_S(value := 3, calls => calls2);
F_S(value := 9);
took := inst.Take(amount := 2, before => before, kept => kept1);
inst.Take(amount := 1, kept => kept2);
END_PROGRAM
FUNCTION F_S : INT
VAR_INPUT value : INT; END_VAR
VAR_OUTPUT tens : INT; calls : INT; END_VAR
calls := calls + 1;
tens := value / 10;
F_S := value MOD 10;
END_FUNCTION
FUNCTION_BLOCK FB_O
VAR stored : INT := 5; END_VAR
END_FUNCTION_BLOCK
METHOD Take : INT
VAR_INPUT amount : INT; END_VAR
VAR_OUTPUT before : INT; kept : INT; END_VAR
kept := kept + 1;
before := stored;
stored := stored + amount;
Take := stored;
END_METHOD`,
      "P",
    )
    pou.scan()
    pou.scan()
    const names = ["before", "calls1", "calls2", "inst.stored", "kept1", "kept2", "tens", "took", "units", "units2"]
    expect(names.map((n) => pou.get(n))).toEqual([8n, 1n, 1n, 11n, 1n, 1n, 4n, 10n, 7n, 3n])
  })

  // `temporal_conversions`. Why missed: the temporal rules were measured to and from integers only; these pairs were
  // refused, so no test reached them.
  test("temporal conversions: DT to its day and time of day, the literal text, REAL counts, and REAL to TIME rounding", () => {
    const pou = load(
      `PROGRAM P
VAR dt1 : DT := DT#2026-05-29-12:30:45; d1 : DATE := D#2026-05-09; tod1 : TOD := TOD#07:05:03.250; tod0 : TOD := TOD#23:59:59;
  t1 : TIME := T#1H2M3S4MS; rHalf : REAL := 2.5;
  toDate : DATE; toTod : TOD; dateText : STRING; dtText : STRING; todText : STRING; tod0Text : STRING; timeToReal : REAL; halfToTime : TIME; END_VAR
toDate := DT_TO_DATE(dt1); toTod := DT_TO_TOD(dt1);
dateText := DATE_TO_STRING(d1); dtText := DT_TO_STRING(dt1); todText := TOD_TO_STRING(tod1); tod0Text := TOD_TO_STRING(tod0);
timeToReal := TIME_TO_REAL(t1); halfToTime := REAL_TO_TIME(rHalf);
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect(pou.get("toDate")).toBe(1780012800n) // 2026-05-29, seconds
    expect(pou.get("toTod")).toBe(45045000n) // 12:30:45, milliseconds
    expect([pou.get("dateText"), pou.get("dtText"), pou.get("todText"), pou.get("tod0Text")]).toEqual(["D#2026-05-09", "DT#2026-05-29-12:30:45", "TOD#07:05:03.250", "TOD#23:59:59"])
    expect([pou.get("timeToReal"), pou.get("halfToTime")]).toEqual([3723004, 3n])
  })

  // `operand_partial_word_in_dword`: the slice counts from the low end. Why missed: `.%W1` parsed (for the LSP) but no
  // transpiler test ever read one — it stopped at "member access is not lowered".
  test("partial access reads a byte or word of an unsigned integer, counted from the low end", () => {
    const pou = load("PROGRAM P\nVAR dw : DWORD := 16#DEADBEEF; w1 : WORD; b3 : BYTE; b0 : BYTE; END_VAR\nw1 := dw.%W1;\nb3 := dw.%B3;\nb0 := dw.%B0;\nEND_PROGRAM", "P")
    pou.scan()
    expect([pou.get("w1"), pou.get("b3"), pou.get("b0")]).toEqual([57005n, 222n, 239n])
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

  // Phase 3½, the rules the `state_*` recordings measured: a METHOD's VAR_INST is kept per instance from its initial value,
  // its VAR_STAT is one variable for every instance, and `a := ,` assigns nothing.
  test("VAR_INST per instance, VAR_STAT shared by every instance, and an empty argument that assigns nothing", () => {
    const pou = load(
      `PROGRAM P
VAR one : FB_T; two : FB_T; first : INT; other : INT; sOne : INT; sTwo : INT; inst : FB_E; got : INT; END_VAR
first := one.Tick();
first := one.Tick();
other := two.Tick();
sOne := one.Shared();
sTwo := two.Shared();
inst(a := 100, b := 1);
inst(a := , b := 2, sum => got);
END_PROGRAM
FUNCTION_BLOCK FB_T
VAR x : INT; END_VAR
END_FUNCTION_BLOCK
METHOD Tick : INT
VAR_INST ticks : INT := 10; END_VAR
ticks := ticks + 1;
Tick := ticks;
END_METHOD
METHOD Shared : INT
VAR_STAT count : INT := 10; END_VAR
count := count + 1;
Shared := count;
END_METHOD
FUNCTION_BLOCK FB_E
VAR_INPUT a : INT := 7; b : INT; END_VAR
VAR_OUTPUT sum : INT; END_VAR
sum := a + b;
END_FUNCTION_BLOCK`,
      "P",
    )
    pou.scan()
    expect([pou.get("first"), pou.get("other"), pou.get("sOne"), pou.get("sTwo"), pou.get("got")]).toEqual([12n, 11n, 11n, 12n, 102n])
  })

  // `state_property_get_set`: set 3 → stored 4; the body's bare read gets 8; `THIS^.Level := THIS^.Level + 5` stores 14;
  // two reads in one expression run the getter twice; its VAR starts over each call, so `gets` counts the calls.
  test("a PROPERTY: the getter per read with its VAR started over, a set after its value — bare, THIS^ and dot", () => {
    const pou = load(
      `PROGRAM P
VAR inst : FB_STATE_prop; twice : INT; END_VAR
inst.Level := 3;
inst();
inst.Bump();
twice := inst.Level + inst.Level;
END_PROGRAM
FUNCTION_BLOCK FB_STATE_prop
VAR stored : INT; gets : INT; inside : INT; END_VAR
inside := Level;
END_FUNCTION_BLOCK
METHOD Bump
THIS^.Level := THIS^.Level + 5;
END_METHOD
PROPERTY Level : INT
GET
VAR scratch : INT; END_VAR
scratch := scratch + 1;
gets := gets + scratch;
Level := stored * 2;
END_GET
SET
stored := Level + 1;
END_SET
END_PROPERTY`,
      "P",
    )
    pou.scan()
    expect([pou.get("inst.stored"), pou.get("inst.gets"), pou.get("inst.inside"), pou.get("twice")]).toEqual([14n, 4n, 8n, 56n])
  })

  // Phase 3½: the corpus lowers every FB on its own. Lowered as if it were a PROGRAM, it had no THIS^, no base and no
  // SUPER^ — so this is the shape 128 corpus FBs stopped at.
  test("an FB lowered on its own is one instance of itself, called each scan — its base, SUPER^ and methods included", () => {
    const pou = load(
      `FUNCTION_BLOCK FB_Top EXTENDS FB_Bottom
VAR n : INT; END_VAR
SUPER^(inBase := 2);
Bump();
END_FUNCTION_BLOCK
METHOD Bump
n := n + 1;
END_METHOD
FUNCTION_BLOCK FB_Bottom
VAR_INPUT inBase : INT; END_VAR
VAR total : INT; END_VAR
total := total + inBase;
END_FUNCTION_BLOCK`,
      "FB_Top",
    )
    pou.scan()
    pou.scan()
    expect([pou.get("FB_Top.total"), pou.get("FB_Top.n"), pou.get("FB_Top.inBase")]).toEqual([4n, 2n, 2n])
  })

  // Phase 3½ (`fbcall_gvl_qualified`): a qualified_only list's variable is reachable only as `List.var`, and two lists
  // may each declare one of the same name — two globals, not one.
  test("a GVL variable named through its list, two qualified_only lists holding the same name apart", () => {
    const q = { uri: "GVL_Q.gvl", source: "{attribute 'qualified_only'}\nVAR_GLOBAL\n  gX : INT := 1;\nEND_VAR\n" }
    const other = { uri: "GVL_R.gvl", source: "{attribute 'qualified_only'}\nVAR_GLOBAL\n  gX : INT := 50;\nEND_VAR\n" }
    const pou = load("PROGRAM P\nVAR seen : INT; apart : INT; END_VAR\nGVL_Q.gX := GVL_Q.gX + 5;\nseen := GVL_Q.gX;\napart := GVL_R.gX;\nEND_PROGRAM\n", "P", [q, other])
    pou.scan()
    pou.scan()
    expect([pou.get("seen"), pou.get("apart")]).toEqual([11n, 50n])
  })

  // Transpiler review 2026-09-15. Why missed: the reference tests bound one, read it and wrote it with a plain `:=` —
  // none wrote through one any other way, and none compared one with 0.
  test("a reference is written through by every kind of store, and `r = 0` compares its target", () => {
    const pou = load(
      `FUNCTION_BLOCK FB_Out
VAR_OUTPUT q : INT; END_VAR
q := 42;
END_FUNCTION_BLOCK
FUNCTION_BLOCK FB_Add10
VAR_IN_OUT v : INT; END_VAR
v := v + 10;
END_FUNCTION_BLOCK
PROGRAM P
VAR
  n1 : INT; n2 : INT := 1; n3 : INT; flag : BOOL; zero : INT;
  r1 : REFERENCE TO INT; r2 : REFERENCE TO INT; r3 : REFERENCE TO INT; rb : REFERENCE TO BOOL; rz : REFERENCE TO INT;
  out : FB_Out; adder : FB_Add10; m : INT; isZero : BOOL; notZero : BOOL;
END_VAR
r1 REF= n1; r2 REF= n2; r3 REF= n3; rb REF= flag; rz REF= zero;
out(q => r1);
adder(v := r2);
rb S= TRUE;
m := r3 := 5;
isZero := rz = 0;
notZero := rz <> 0;
END_PROGRAM`,
      "P",
    )
    pou.scan()
    expect([pou.get("n1"), pou.get("n2"), pou.get("flag"), pou.get("n3"), pou.get("m")]).toEqual([42n, 11n, true, 5n, 5n])
    expect([pou.get("isZero"), pou.get("notZero")]).toEqual([true, false]) // the target is 0 — the reference is bound
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

  // Why missed: every initializer test wrote `:= …` on the variable itself; the alias case only arrived with the
  // fixtures' run recordings (conformance `type_dut_alias_with_init`, 43 after one `x := x + 1`).
  test("a variable with no initializer starts at its ALIAS type's", () => {
    const pou = load("TYPE T_Start : INT := 42; END_TYPE\nPROGRAM P\nVAR x : T_Start; END_VAR\nx := x + 1;\nEND_PROGRAM\n", "P")
    expect(pou.get("x")).toBe(42n)
    pou.scan()
    expect(pou.get("x")).toBe(43n)
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
    // Lowering typed every real literal by its context, so `REAL#0.1` into an LREAL was float64's 0.1 (conformance
    // `typed_literal_real_prefix` recorded float32's).
    const pou = load("PROGRAM P\nVAR fromReal : LREAL; fromLreal : LREAL; init : LREAL := REAL#0.1; END_VAR\nfromReal := REAL#0.1; fromLreal := LREAL#0.1;\nEND_PROGRAM\n")
    pou.scan()
    expect([pou.get("fromReal"), pou.get("fromLreal"), pou.get("init")]).toEqual([Math.fround(0.1), 0.1, Math.fround(0.1)])
  })

  test("a value set from outside is stored as the slot's type holds it", () => {
    // `set` wrote the raw value, so a test could plant 300 in a SINT — a value no program on the PLC can produce
    const pou = load("PROGRAM P\nVAR si : SINT; rv : REAL; five : STRING(5); END_VAR\nsi := si;\nEND_PROGRAM\n")
    pou.set("si", 300n)
    pou.set("rv", 0.1)
    pou.set("five", "abcdefgh")
    expect([pou.get("si"), pou.get("rv"), pou.get("five")]).toEqual([44n, Math.fround(0.1), "abcde"])
  })

  test("an unlowerable POU is refused at load, not run half-way", () => {
    // ADR, not MAX: MAX lowers now. ADR waits on the memory model (design §9), so it stays unlowerable for a while.
    expect(() => load("PROGRAM P\nVAR x : INT; END_VAR\nx := ADR(x);\nEND_PROGRAM\n")).toThrow(/expr-call/)
  })
})

describe("interp — STRING (design §18; every expectation recorded in conformance `string_*`)", () => {
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
