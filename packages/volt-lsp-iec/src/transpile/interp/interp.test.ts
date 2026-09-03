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

  test("an unlowerable POU is refused at load, not run half-way", () => {
    expect(() => load("PROGRAM P\nVAR x : INT; END_VAR\nx := Max(1, 2);\nEND_PROGRAM\n")).toThrow(/expr-call/)
  })
})
