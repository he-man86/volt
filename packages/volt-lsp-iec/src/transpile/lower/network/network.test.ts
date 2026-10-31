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

  test("a wire is kept across scans, read before its definition the previous scan's value, by the path __nw<N>_<wire>", () => {
    const r = runner("a, b, x : BOOL;", "%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nx := a AND w1;\nw1 := b;\n")
    expect(trace(r, "x", [{ a: true, b: true }, { b: false }, {}])).toEqual([false, true, false])
    expect(r.get("__nw1_w1")).toBe(false)
  })

  test("the wire's network index is its place in the body, a disabled network counted and lowered to nothing", () => {
    const r = runner("a, x, y : BOOL;", "%NETWORK\n%DISABLED\ny := TRUE;\n%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nw1 := NOT a;\nx := w1;\n")
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
    const r = runner("x, en, a : BOOL;", "%NETWORK\nx := en AND R_EDGE(a);\n", TRIGS)
    expect(trace(r, "x", [{ en: true, a: true }, {}, { a: false }, { a: true }])).toEqual([true, false, false, true])
    expect(r.get("__nw1_trig1.M")).toBe(true)
  })

  test("a falling edge's detector starts as its declaration says (F_TRIG's M := TRUE)", () => {
    const r = runner("x, a : BOOL;", "%NETWORK\nx := F_EDGE(a);\n", TRIGS)
    expect(trace(r, "x", [{}, { a: true }, { a: false }])).toEqual([false, false, true])
  })

  test("a BRANCH_SHORTCIRCUIT runs the branch holding a box only unless the feed and a free branch are both TRUE (1.4)", () => {
    const r = runner("x, f, a, b : BOOL; c1 : FB_C;", "%NETWORK\nx := BRANCH_SHORTCIRCUIT(FEED := f, a, c1(CU := b).Q);\n", COUNTER)
    trace(r, "x", [{ f: true, a: true, b: true }, {}, { a: false }])
    expect(r.get("c1.CV")).toBe(1n)
  })

  test("a return on a value is the IF that takes it", () => {
    const r = runner("a, x : BOOL; n : INT;", "%NETWORK\nRETURN(a);\n%NETWORK\nn := ADD(n, 1);\n")
    expect(trace(r, "n", [{}, { a: true }, { a: false }])).toEqual([1n, 1n, 2n])
  })
})

describe("what the lowering refuses, by name", () => {
  const codes = (vars: string, body: string, extra = "") => lowered(vars, body, extra).diagnostics.map((d) => [d.code, d.message])

  test("an FB box showing ENO without EN: CODESYS does not compile it", () =>
    expect(codes("x, a : BOOL; c1 : FB_C;", "%NETWORK\nx := c1(CU := a).ENO;\n", COUNTER)).toEqual([
      ["network-invalid", "the c1 box shows ENO without EN, which CODESYS does not compile"],
    ]))

  test("an enabled box other than a comparison read inside a tree", () =>
    expect(codes("x : BOOL; i : INT; c : BOOL;", "%NETWORK\nx := EQ(ADD(EN := c, i, 1), 2);\n")).toEqual([
      ["network-box", "the enabled ADD box is read by its value other than as an assignment's whole value"],
    ]))

  test("a jump, as in an ST body", () =>
    expect(codes("a, x : BOOL;", "%NETWORK\nJMP(l1, a);\n%NETWORK\nl1:\nx := a;\n").map(([c]) => c)).toContain("stmt-jmp"))
})

describe("where a network's state lives", () => {
  test("an ACTION's wires are fields of the instance it runs on, __nw_<action>_<N>_<wire>", () => {
    const src =
      "PROGRAM P\nVAR\n\ta, x : BOOL;\nEND_VAR\n%LANGUAGE ST\nA1();\nEND_PROGRAM\n" +
      "ACTION A1\n%LANGUAGE LD\n%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nx := w1;\nw1 := a;\nEND_ACTION\n"
    const { pou, diagnostics } = lowerSource(src, "P")
    expect(diagnostics).toEqual([])
    const r = run(pou!)
    expect(trace(r, "P.x", [{ "P.a": true }, {}])).toEqual([false, true])
    expect(r.get("P.__nw_A1_1_w1")).toBe(true)
  })
})
