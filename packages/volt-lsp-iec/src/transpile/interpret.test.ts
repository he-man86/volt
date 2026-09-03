import { describe, expect, test } from "bun:test"
import { load, Unsupported } from "./interpret.js"

const COUNTER = `
PROGRAM Counter
VAR_INPUT
  Enable : BOOL;
  Reset  : BOOL;
END_VAR
VAR_OUTPUT
  Count : INT;
  Done  : BOOL;
END_VAR
VAR
  MaxCount : INT := 3;
END_VAR
IF Reset THEN
  Count := 0;
ELSIF Enable AND Count < MaxCount THEN
  Count := Count + 1;
END_IF
Done := Count >= MaxCount;
END_PROGRAM
`

describe("interpret", () => {
  test("a PRG with IF/ELSIF and a counter runs scan cycles", () => {
    const pou = load(COUNTER)
    expect(pou.get("Count")).toBe(0n)

    pou.scan() // disabled — nothing moves
    expect(pou.get("Count")).toBe(0n)

    pou.set("Enable", true)
    for (let i = 0; i < 5; i++) pou.scan()
    expect(pou.get("Count")).toBe(3n) // clamped at MaxCount
    expect(pou.get("Done")).toBe(true)

    pou.set("Reset", true)
    pou.scan()
    expect(pou.get("Count")).toBe(0n)
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

  test("an unsupported construct is flagged, never silently wrong", () => {
    const pou = load(`
PROGRAM P
VAR
  t : TON;
END_VAR
t(IN := TRUE);
END_PROGRAM
`)
    expect(() => pou.scan()).toThrow(Unsupported)
  })
})
