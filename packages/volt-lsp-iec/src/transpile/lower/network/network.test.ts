/**
 * A PLAIN-ST NETWORK BODY LOWERED AND RUN (openspec network-text-lowering): one small network per rule, run for a few
 * scans. The rules' measurements are the twin's (`test/support/network-twin.test.ts`);
 * `test/corpus/corpus-network-lowering.test.ts` holds this lowering to the twin on every corpus body.
 */
import { describe, expect, test } from "bun:test"
import { run, type Runner } from "../../interp/index.js"
import { lowerSource } from "../index.js"

/** CODESYS's edge detectors, as the Standard library writes them. */
const TRIGS =
  "FUNCTION_BLOCK R_TRIG\nVAR_INPUT CLK : BOOL; END_VAR\nVAR_OUTPUT Q : BOOL; END_VAR\nVAR M : BOOL; END_VAR\n%LANGUAGE ST\nQ := CLK AND NOT M;\nM := CLK;\nEND_FUNCTION_BLOCK\n" +
  "FUNCTION_BLOCK F_TRIG\nVAR_INPUT CLK : BOOL; END_VAR\nVAR_OUTPUT Q : BOOL; END_VAR\nVAR M : BOOL := TRUE; END_VAR\n%LANGUAGE ST\nQ := NOT CLK AND NOT M;\nM := NOT CLK;\nEND_FUNCTION_BLOCK\n"
const COUNTER =
  "FUNCTION_BLOCK FB_C\nVAR_INPUT CU : BOOL; END_VAR\nVAR_OUTPUT Q : BOOL; CV : INT; END_VAR\n%LANGUAGE ST\nIF CU THEN CV := CV + 1; END_IF;\nQ := CV >= 3;\nEND_FUNCTION_BLOCK\n"

function lowered(vars: string, body: string, extra = "", language = "LD") {
  return lowerSource(`PROGRAM P\nVAR\n${vars}\nEND_VAR\n%LANGUAGE ${language}\n${body}END_PROGRAM\n${extra}`, "P")
}

function runner(vars: string, body: string, extra = "", language = "LD"): Runner {
  const { pou, diagnostics } = lowered(vars, body, extra, language)
  expect(diagnostics).toEqual([])
  return run(pou!)
}

/** `path`'s value after each scan, `set` applied before it. */
function trace(r: Runner, path: string, inputs: readonly Record<string, boolean | bigint>[]): unknown[] {
  return inputs.map((set) => {
    for (const [k, v] of Object.entries(set)) r.set(k, v)
    r.scan()
    return r.get(path)
  })
}

describe("a network body lowers to what it runs", () => {
  test("a seal-in rung: contacts and a coil are ST as they stand", () => {
    const r = runner("start, stop, motor : BOOL;", "%NETWORK\nmotor := (start OR motor) AND NOT stop;\n")
    expect(trace(r, "motor", [{ start: true }, { start: false }, { stop: true }, { stop: false }])).toEqual([true, true, false, false])
  })

  test("the rail is TRUE", () => {
    const r = runner("x : BOOL;", "%NETWORK\nx := RAIL();\n")
    expect(trace(r, "x", [{}])).toEqual([true])
  })

  test("a coil's NOT negates what it writes; in a chain every target receives the power flow, the first its mark applied", () => {
    const r = runner("a, x, y : BOOL;", "%NETWORK\nNOT y := x := a;\n")
    expect(trace(r, "y", [{ a: true }, { a: false }])).toEqual([false, true])
    expect(r.get("x")).toBe(false)
  })

  test("a coil's edge mark: the IDE runs it unmarked, so nothing runs an edge the text claims", () =>
    expect(lowered("a, y : BOOL;", "%NETWORK\nRISING y := a;\n").diagnostics.map((d) => d.message)).toEqual([
      "an edge mark on the coil: the IDE runs it unmarked. The edge is on the value, y := RISING(a)",
    ]))

  test("a pin's and EN's NOT negate what the box reads", () => {
    const r = runner("a, c : BOOL; n : INT;", "%NETWORK\nMOVE(NOT EN := c, 1, OUT => n).ENO;\n", "", "FBD")
    expect(trace(r, "n", [{ c: true }, { c: false }])).toEqual([0n, 1n])
    const s = runner("a, x : BOOL;", "%NETWORK\nx := AND(NOT := a, TRUE);\n", "", "FBD")
    expect(trace(s, "x", [{ a: true }, { a: false }])).toEqual([false, true])
  })

  test("a box read where it stands takes the value mark NOT on its output", () => {
    const r = runner("a, b, x : BOOL;", "%NETWORK\nx := NOT AND(a, b);\n", "", "FBD")
    expect(trace(r, "x", [{ a: true, b: true }, { b: false }])).toEqual([false, true])
  })

  test("a wire is kept across scans, read before its definition the previous scan's value, by the path __nw<N>_<wire>", () => {
    const r = runner("a, b, x : BOOL;", "%NETWORK\nVAR w1 : ANY; END_VAR\nx := a AND w1;\nw1 := b;\n")
    expect(trace(r, "x", [{ a: true, b: true }, { b: false }, {}])).toEqual([false, true, false])
    expect(r.get("__nw1_w1")).toBe(false)
  })

  test("the wire's network index is its place in the body, a disabled network counted and lowered to nothing", () => {
    const r = runner("a, x, y : BOOL;", "%NETWORK\n%DISABLED\ny := TRUE;\n%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := NOT a;\nx := w1;\n")
    r.scan()
    expect([r.get("x"), r.get("y"), r.get("__nw2_w1")]).toEqual([true, false, true])
  })

  test("an enabled box read by its value under a coil holds the coil when disabled (1.4)", () => {
    const r = runner("y : INT := 5; k : INT := 7; c : BOOL;", "%NETWORK\ny := MOVE(EN := c, k);\n", "", "FBD")
    expect(trace(r, "y", [{}, { c: true }, { c: false, k: 9n }])).toEqual([5n, 7n, 7n])
  })

  test("an enabled comparison is FALSE when disabled, its ENO temp __nw<N>_eno<k> (1.3)", () => {
    const r = runner("x, a, c : BOOL; i : INT := 4;", "%NETWORK\nx := a AND GT(EN := c, i, 3);\n")
    expect(trace(r, "x", [{ a: true }, { c: true }])).toEqual([false, true])
    expect(r.get("__nw1_eno1")).toBe(true)
  })

  test("a box with EN and ENO at the root runs under its EN and hands its EN on", () => {
    const r = runner("a, b : INT; c, done : BOOL;", "%NETWORK\ndone := MOVE(EN := c, 3, OUT => a).ENO;\n", "", "FBD")
    expect(trace(r, "a", [{}, { c: true }])).toEqual([0n, 3n])
    expect(r.get("done")).toBe(true)
  })

  test("an FB box is its instance called before the item, read by the output its call names", () => {
    const r = runner("a, x : BOOL; n : INT; c1 : FB_C;", "%NETWORK\nn := c1(CU := a).CV;\n%NETWORK\nx := c1(CU := FALSE).Q;\n", COUNTER, "FBD")
    expect(trace(r, "n", [{ a: true }, {}, {}])).toEqual([1n, 2n, 3n])
    expect(r.get("x")).toBe(true)
  })

  test("an edge is an edge detector __nw<N>_trig<k> called on every scan, read by its Q", () => {
    const r = runner("x, en, a : BOOL;", "%NETWORK\nx := en AND RISING(a);\n", TRIGS)
    expect(trace(r, "x", [{ en: true, a: true }, {}, { a: false }, { a: true }])).toEqual([true, false, false, true])
    expect(r.get("__nw1_trig1.M")).toBe(true)
  })

  test("a falling edge's detector starts as its declaration says (F_TRIG's M := TRUE)", () => {
    const r = runner("x, a : BOOL;", "%NETWORK\nx := FALLING(a);\n", TRIGS)
    expect(trace(r, "x", [{}, { a: true }, { a: false }])).toEqual([false, false, true])
  })

  test("a BRANCH_SHORTCIRCUIT runs the branch holding a box only unless the feed and a free branch are both TRUE (1.4)", () => {
    const r = runner("x, f, a, b : BOOL; c1 : FB_C;", "%NETWORK\nx := BRANCH_SHORTCIRCUIT(FEED := f, a, c1(CU := b).Q);\n", COUNTER)
    trace(r, "x", [{ f: true, a: true, b: true }, {}, { a: false }])
    expect(r.get("c1.CV")).toBe(1n)
  })

  test("a return on a value is the IF that takes it", () => {
    const r = runner("a, x : BOOL; n : INT;", "%NETWORK\nRETURN := a;\n%NETWORK\nn := ADD(n, 1);\n")
    expect(trace(r, "n", [{}, { a: true }, { a: false }])).toEqual([1n, 1n, 2n])
  })
})

describe("a root box's main output (network-text-one-to-one F3)", () => {
  test("a root closed by .NAME runs as the box call: the main slot changes nothing at run time", () => {
    const named = runner("a : BOOL; c1 : FB_C;", "%NETWORK\nc1(CU := a).CV;\n", COUNTER, "FBD")
    const plain = runner("a : BOOL; c1 : FB_C;", "%NETWORK\nc1(CU := a);\n", COUNTER, "FBD")
    const scans = [{ a: true }, { a: true }, { a: false }]
    expect(trace(named, "c1.CV", scans)).toEqual(trace(plain, "c1.CV", scans))
    expect(trace(runner("a : BOOL; c1 : FB_C;", "%NETWORK\nc1(CU := a).CV;\n", COUNTER, "FBD"), "c1.CV", scans)).toEqual([1n, 2n, 2n])
  })

  test("the pins beside the closer are written", () => {
    const r = runner("a, x : BOOL; c1 : FB_C;", "%NETWORK\nc1(CU := a, Q => x).CV;\n", COUNTER, "FBD")
    expect(trace(r, "x", [{ a: true }])).toEqual(trace(runner("a, x : BOOL; c1 : FB_C;", "%NETWORK\nc1(CU := a, Q => x);\n", COUNTER, "FBD"), "x", [{ a: true }]))
  })

  test("a function box closed by its VAR_OUTPUT runs as the call", () => {
    const G = "FUNCTION G : INT\nVAR_INPUT i : INT; END_VAR\nVAR_OUTPUT q : INT; END_VAR\n%LANGUAGE ST\nq := i + 1;\nG := i;\nEND_FUNCTION\n"
    const { diagnostics } = lowered("n, m : INT;", "%NETWORK\nG(n, q => m).q;\n", G, "FBD")
    expect(diagnostics).toEqual([])
  })
})

describe("what the lowering refuses, by name", () => {
  const codes = (vars: string, body: string, extra = "") => lowered(vars, body, extra).diagnostics.map((d) => [d.code, d.message])

  test("a box read through .ENO with no EN", () =>
    expect(codes("x, a : BOOL; c1 : FB_C;", "%NETWORK\nx := c1(CU := a).ENO;\n", COUNTER)).toEqual([
      ["network-box", "the box c1 is read through .ENO and shows no EN: its ENO is FALSE on every scan. Show it, c1(EN := …).ENO"],
    ]))

  test("an FB's root .ENO with no EN runs as the plain call", () => {
    const r = runner("a : BOOL; c1 : FB_C;", "%NETWORK\nc1(CU := a).ENO;\n", COUNTER)
    expect(trace(r, "c1.CV", [{ a: true }])).toEqual([1n])
  })

  test("a FUNCTION's OUT => at a root: the IDE does not write it", () =>
    expect(codes("k, i : INT;", "%NETWORK\nf(n := i, OUT => k);\n", "FUNCTION f : INT\nVAR_INPUT n : INT; END_VAR\n%LANGUAGE ST\nf := n;\nEND_FUNCTION\n")).toEqual([
      ["network-box", "the FUNCTION box f wires OUT => at a root: the IDE does not write it. Read its value, x := f(…)"],
    ]))

  test("one output wired to two targets: the IDE writes no second one, so nothing runs a meaning the text does not have", () =>
    expect(codes("a, x, y : BOOL;", "%NETWORK\nMOVE(a, OUT => x, OUT => y);\n")).toEqual([
      ["network-box", "the call MOVE wires OUT => twice: the IDE writes no second target. Two targets are a chain, x := y := MOVE(…)"],
    ]))

  test("a pin by position on an FB: the IDE drops it, so nothing runs it passed", () =>
    expect(codes("x, a : BOOL; c1 : FB_C;", "%NETWORK\nc1(a);\n", COUNTER)).toEqual([
      ["network-box", "the call c1 passes a pin by position: the box of an FB or a PROGRAM passes only named pins, and the IDE drops the rest. Name it, c1(<pin> := value)"],
    ]))

  test("a variable on the ENO pin: the IDE never writes it, so nothing runs it written", () =>
    expect(codes("a, c, x, z : BOOL;", "%NETWORK\nMOVE(EN := c, a, ENO => z, OUT => x).ENO;\n")).toEqual([
      ["network-box", "the call MOVE wires ENO =>: the IDE never writes a variable on the ENO pin. ENO is read where its call is closed, v := MOVE(…).ENO"],
    ]))

  test("an operator closed by ENO with its value wired nowhere: CODESYS does not build it", () =>
    expect(codes("c, y : BOOL; i, j : INT;", "%NETWORK\ny := GT(EN := c, i, j).ENO;\n")).toEqual([
      ["network-box", "the operator box GT is closed by .ENO and wires its value nowhere. Wire it, GT(…, OUT => v).ENO"],
    ]))

  test("a box read by its value with OUT => on it: the IDE writes no second target", () =>
    expect(codes("k, m, i, j : INT;", "%NETWORK\nk := ADD(i, j, OUT => m);\n")).toEqual([
      ["network-box", "the box ADD is read by its value and wires OUT =>: the IDE writes no second target. Two targets are a chain, x := y := ADD(…)"],
    ]))

  test("an enabled box other than a comparison read inside a tree", () =>
    expect(codes("x : BOOL; i : INT; c : BOOL;", "%NETWORK\nx := EQ(ADD(EN := c, i, 1), 2);\n")).toEqual([
      ["network-box", "the enabled ADD box is read by its value other than as an assignment's whole value"],
    ]))

  test("an edge mark on a pin and a mark on an output are unmeasured", () => {
    expect(codes("a, x : BOOL;", "%NETWORK\nx := MOVE(RISING EN := a, a);\n").map(([c]) => c)).toContain("network-box")
    expect(codes("a, x, y : BOOL;", "%NETWORK\ny := MOVE(EN := a, a, NOT OUT => x).ENO;\n").map(([c]) => c)).toContain("network-box")
  })

})

describe("a jump crosses networks as in an ST body (`nt_jmp_over_network`, recorded 2026-10-31)", () => {
  test("`JMP.l := v` passes the networks before its label while v holds", () => {
    const r = runner("a, x, y : BOOL;", "%NETWORK\nJMP.l1 := a;\n%NETWORK\nx := TRUE;\n%NETWORK\nl1:\ny := TRUE;\n")
    expect(trace(r, "x", [{ a: true }, { a: false }])).toEqual([false, true])
    expect(r.get("y")).toBe(true)
  })
})

describe("where a network's state lives", () => {
  test("an ACTION's wires are fields of the instance it runs on, __nw_<action>_<N>_<wire>", () => {
    const src =
      "PROGRAM P\nVAR\n\ta, x : BOOL;\nEND_VAR\n%LANGUAGE ST\nA1();\nEND_PROGRAM\n" +
      "ACTION A1\n%LANGUAGE LD\n%NETWORK\nVAR w1 : ANY; END_VAR\nx := w1;\nw1 := a;\nEND_ACTION\n"
    const { pou, diagnostics } = lowerSource(src, "P")
    expect(diagnostics).toEqual([])
    const r = run(pou!)
    expect(trace(r, "P.x", [{ "P.a": true }, {}])).toEqual([false, true])
    expect(r.get("P.__nw_A1_1_w1")).toBe(true)
  })
})


describe("the assignment item's marks mark the value every target receives", () => {
  test("NOT := negates the value for every coil of the chain", () => {
    const r = runner("a, x, y : BOOL;", "%NETWORK\ny := x := NOT := a;\n")
    expect(trace(r, "y", [{ a: true }, { a: false }])).toEqual([false, true])
    expect(r.get("x")).toBe(true)
  })

  test("RISING NOT := is the edge of the negated value, negation first", () => {
    const r = runner("a, y : BOOL;", "%NETWORK\ny := RISING NOT := a;\n", TRIGS)
    expect(trace(r, "y", [{ a: true }, { a: false }, {}, { a: true }])).toEqual([false, true, false, false])
  })

  test("the item's marks and a coil's own: the coil's NOT on the item's value", () => {
    const r = runner("a, y : BOOL;", "%NETWORK\nNOT y := NOT := a;\n")
    expect(trace(r, "y", [{ a: true }, { a: false }])).toEqual([true, false])
  })
})

describe("a jump and the return take a receiver's marks", () => {
  test("NOT JMP.l := a jumps when NOT a", () => {
    const r = runner("a, x : BOOL;", "%NETWORK\nNOT JMP.l := a;\n%NETWORK\nx := NOT x;\n%NETWORK\nl:\n;\n")
    expect(trace(r, "x", [{ a: false }, { a: true }, {}])).toEqual([false, true, false])
  })

  test("NOT RETURN := a returns when NOT a", () => {
    const r = runner("a : BOOL; n : INT;", "%NETWORK\nNOT RETURN := a;\n%NETWORK\nn := ADD(n, 1);\n")
    expect(trace(r, "n", [{}, { a: true }, {}])).toEqual([0n, 1n, 2n])
  })

  test("an edge on a jump has no measured run: refused by name", () => {
    const { diagnostics } = lowered("a : BOOL;", "%NETWORK\nRISING JMP.l := a;\n%NETWORK\nl:\n;\n")
    expect(diagnostics.map((d) => d.message)).toEqual(["the edge mark on the jump JMP.l: how a jump's edge runs is unmeasured"])
  })
})

describe("a value standing alone", () => {
  test("an operand, contacts, a branch and the rail are evaluated and change nothing", () => {
    const r = runner("a, b, c, x : BOOL;", "%NETWORK\na;\nNOT b;\na AND b;\nBRANCH(FEED := a, b, c);\nRAIL();\nNOT AND(a, b);\n%NETWORK\nx := a;\n")
    expect(trace(r, "x", [{ a: true }, { a: false }])).toEqual([true, false])
  })

  test("a box consumed by nothing runs, its NOT of no effect", () => {
    const r = runner("a : BOOL; c1 : FB_C;", "%NETWORK\nNOT c1(CU := a);\n", COUNTER, "FBD")
    expect(trace(r, "c1.CV", [{ a: true }, {}, { a: false }])).toEqual([1n, 2n, 2n])
  })
})

test("NOT before an Execute box's ENO negates its ENO, its ST running under its EN", () => {
  const r = runner("go, y : BOOL; n : INT;", "%NETWORK\ny := NOT EXECUTE(EN := go, 'n := n + 1;').ENO;\n")
  expect(trace(r, "y", [{}, { go: true }])).toEqual([true, false])
  expect(r.get("n")).toBe(1n)
})

test("an operand comment is the operand it wraps: a value, a coil, a pin", () => {
  const r = runner("a, x, y : BOOL; c1 : FB_C;", "%NETWORK\ny := COMMENT(a, 'why');\nNOT COMMENT(x, 'why') := a;\nc1(CU := COMMENT(a, 'in'));\n", COUNTER, "FBD")
  expect(trace(r, "y", [{ a: true }, { a: false }])).toEqual([true, false])
  expect([r.get("x"), r.get("c1.CV")]).toEqual([true, 1n])
})
