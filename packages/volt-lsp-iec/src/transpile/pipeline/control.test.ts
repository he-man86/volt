import { describe, expect, test } from "bun:test"
import { load, LoopGuardError, lowerSource, run } from "../index.js"

// End to end, ST -> lower -> interpreter: control flow, latches, evaluation order, loops.
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
    // ADR, not MAX: MAX lowers now. ADR waits on the memory model (design §9), so it stays unlowerable for a while.
    expect(() => load("PROGRAM P\nVAR x : INT; END_VAR\nx := ADR(x);\nEND_PROGRAM\n")).toThrow(/expr-call/)
  })
})

// transpile-review-2026-09-29 task 41 (conformance `tr_41_mux_side_effects`, `tr_41_sel_side_effects`,
// `tr_41_limit_evaluation_order`, recorded): SEL and MUX run ONLY the input they select; LIMIT runs MN, IN, MX in order.
describe("interp — SEL / MUX / LIMIT with side-effecting arguments", () => {
  const INC = "FUNCTION Inc : INT\nVAR_IN_OUT c : INT; END_VAR\nc := c + 1;\nInc := c;\nEND_FUNCTION\n"
  test("MUX and SEL evaluate only the selected input", () => {
    const pou = load(`${INC}PROGRAM P
VAR a : INT; b : INT; res : INT; a2 : INT; b2 : INT; r2 : INT; END_VAR
res := MUX(0, Inc(a), Inc(b)); r2 := SEL(FALSE, Inc(a2), Inc(b2));
END_PROGRAM
`)
    pou.scan()
    expect(["a", "b", "res", "a2", "b2", "r2"].map((n) => pou.get(n))).toEqual([1n, 0n, 1n, 1n, 0n, 1n])
  })

  test("LIMIT evaluates MN before IN", () => {
    const pou = load(`FUNCTION Add1 : INT
VAR_IN_OUT x : INT; END_VAR
x := x + 1;
Add1 := x;
END_FUNCTION
FUNCTION Dbl : INT
VAR_IN_OUT x : INT; END_VAR
x := x * 2;
Dbl := x;
END_FUNCTION
PROGRAM P
VAR x : INT := 1; r3 : INT; END_VAR
r3 := LIMIT(Add1(x), Dbl(x), 1000);
END_PROGRAM
`)
    pou.scan()
    expect([pou.get("x"), pou.get("r3")]).toEqual([4n, 4n])
  })
})

/**
 * NO ITERATION CAP (transpile-review task 27). The interpreter threw after 1,000,000 passes, counted from 0 so it
 * ran one pass more than the emitted Rust; CODESYS runs every pass (`tr_27_loop_cap_*`, recorded 2026-09-29). A
 * runaway loop is the harness's to bound: `run(pou, { loopGuard })` counts ONE BODY ENTRY as one pass and throws
 * a `LoopGuardError` — a harness giving up, not a program outcome — on the entry past the guard.
 */
describe("interp — no iteration cap", () => {
  const counter = (body: string) => load(`PROGRAM P\nVAR i : DINT; cnt : DINT; END_VAR\n${body}\nEND_PROGRAM\n`, "P")

  test("FOR / REPEAT / WHILE run every pass CODESYS records", () => {
    const recorded: [string, bigint][] = [
      ["FOR i := 1 TO 1000000 DO cnt := cnt + 1; END_FOR", 1000000n],
      ["FOR i := 1 TO 1000001 DO cnt := cnt + 1; END_FOR", 1000001n],
      ["REPEAT cnt := cnt + 1; UNTIL cnt >= 1000001 END_REPEAT", 1000001n],
      ["WHILE cnt < 5000000 DO cnt := cnt + 1; END_WHILE", 5000000n],
    ]
    for (const [body, cnt] of recorded) {
      const p = counter(body)
      p.scan()
      expect([body, p.get("cnt")]).toEqual([body, cnt])
    }
  })

  test("the harness guard counts one body entry as one pass, for every loop form", () => {
    const guarded = (body: string, loopGuard: number) => {
      const { pou } = lowerSource(`PROGRAM P\nVAR i : DINT; cnt : DINT; END_VAR\n${body}\nEND_PROGRAM\n`, "P")
      return run(pou!, { loopGuard })
    }
    for (const body of [
      "FOR i := 1 TO 3 DO cnt := cnt + 1; END_FOR",
      "WHILE cnt < 3 DO cnt := cnt + 1; END_WHILE",
      "REPEAT cnt := cnt + 1; UNTIL cnt >= 3 END_REPEAT",
    ]) {
      const exact = guarded(body, 3)
      exact.scan()
      expect([body, exact.get("cnt")]).toEqual([body, 3n])
      const short = guarded(body, 2)
      expect(() => short.scan()).toThrow(LoopGuardError)
      expect([body, short.get("cnt")]).toEqual([body, 2n])
    }
  })
})
