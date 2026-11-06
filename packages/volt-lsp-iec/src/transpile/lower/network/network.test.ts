/**
 * A PLAIN-ST NETWORK BODY LOWERED AND RUN (openspec network-text-lowering, network-language "What it runs as"): one small
 * network per rule, run for a few scans. The rules' measurements are the twin's (`test/support/network-twin.test.ts`);
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
  test("a seal-in rung: contacts as they stand, the coil an ASSIGN", () => {
    const r = runner("start, stop, motor : BOOL;", "%NETWORK\nASSIGN((start OR motor) AND INVERT(stop), Q => motor);\n")
    expect(trace(r, "motor", [{ start: true }, { start: false }, { stop: true }, { stop: false }])).toEqual([true, true, false, false])
  })

  test("the rail is TRUE", () => {
    const r = runner("x : BOOL;", "%NETWORK\nASSIGN(RAIL(), Q => x);\n")
    expect(trace(r, "x", [{}])).toEqual([true])
  })

  test("an enabled box read by its value under a coil holds the coil when disabled (1.4)", () => {
    const r = runner("y : INT := 5; k : INT := 7; c : BOOL;", "%NETWORK\nASSIGN(MOVE(EN := c, k).OUT, Q => y);\n", "", "FBD")
    expect(trace(r, "y", [{}, { c: true }, { c: false, k: 9n }])).toEqual([5n, 7n, 7n])
  })

  test("an enabled comparison read by its value is FALSE when disabled, its temp __nw<N>_eno<k> (1.3)", () => {
    const r = runner("x, a, c : BOOL; i : INT := 4;", "%NETWORK\nASSIGN(a AND GT(EN := c, i, 3).OUT, Q => x);\n")
    expect(trace(r, "x", [{ a: true }, { c: true }])).toEqual([false, true])
    expect(r.get("__nw1_eno1")).toBe(true)
  })

  test("a box showing EN hands on its ENO: it runs under its EN, and its ENO is its EN", () => {
    const r = runner("a, b : INT; c, done : BOOL;", "%NETWORK\nASSIGN(MOVE(EN := c, 3, OUT => a), Q => done);\n", "", "FBD")
    expect(trace(r, "a", [{}, { c: true }])).toEqual([0n, 3n])
    expect(r.get("done")).toBe(true)
  })

  test("an FB box is its instance called before the item, handing on its first output or the one its member names", () => {
    const r = runner("a, x : BOOL; n : INT; c1 : FB_C;", "%NETWORK\nASSIGN(c1(CU := a).CV, Q => n);\n%NETWORK\nASSIGN(c1(CU := FALSE), Q => x);\n", COUNTER, "FBD")
    expect(trace(r, "n", [{ a: true }, {}, {}])).toEqual([1n, 2n, 3n])
    expect(r.get("x")).toBe(true)
  })

  test("a METHOD box hands on its value, as a function box does: of an instance, and the FB's own", () => {
    const owner = "FUNCTION_BLOCK FB_O\nVAR\n\tbase : INT := 1;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD M_twice : INT\nVAR_INPUT\n\tk : INT;\nEND_VAR\nM_twice := k * 2 + base;\nEND_METHOD\n"
    const r = runner("v, y : INT; o : FB_O;", "%NETWORK\nASSIGN(o.M_twice(k := v), Q => y);\n", owner, "FBD")
    expect(trace(r, "y", [{ v: 3n }])).toEqual([7n])
  })

  test("an edge is an edge detector __nw<N>_trig<k> called on every scan, read by its Q", () => {
    const r = runner("x, en, a : BOOL;", "%NETWORK\nASSIGN(en AND RISING(a), Q => x);\n", TRIGS)
    expect(trace(r, "x", [{ en: true, a: true }, {}, { a: false }, { a: true }])).toEqual([true, false, false, true])
    expect(r.get("__nw1_trig1.M")).toBe(true)
  })

  test("a falling edge's detector starts as its declaration says (F_TRIG's M := TRUE)", () => {
    const r = runner("x, a : BOOL;", "%NETWORK\nASSIGN(FALLING(a), Q => x);\n", TRIGS)
    expect(trace(r, "x", [{}, { a: true }, { a: false }])).toEqual([false, false, true])
  })

  test("a BRANCH_SHORTCIRCUIT runs the branch holding a box only unless the feed and a free branch are both TRUE (1.4)", () => {
    const r = runner("x, f, a, b : BOOL; c1 : FB_C;", "%NETWORK\nASSIGN(BRANCH_SHORTCIRCUIT(FEED := f, a, c1(CU := b)), Q => x);\n", COUNTER)
    trace(r, "x", [{ f: true, a: true, b: true }, {}, { a: false }])
    expect(r.get("c1.CV")).toBe(1n)
  })

  test("a return on a value is the IF that takes it", () => {
    const r = runner("a, x : BOOL; n : INT;", "%NETWORK\nASSIGN(a, Q => RETURN);\n%NETWORK\nASSIGN(ADD(n, 1), Q => n);\n")
    expect(trace(r, "n", [{}, { a: true }, { a: false }])).toEqual([1n, 1n, 2n])
  })
})

describe("every coil, jump and return is an ASSIGN (network-language rule 3)", () => {
  test("a target list writes in list order, a mark on one target acting on that target only", () => {
    const r = runner("a, x, y : BOOL;", "%NETWORK\nASSIGN(a, Q_INVERTED => y, Q => x);\n")
    expect(trace(r, "y", [{ a: true }, { a: false }])).toEqual([false, true])
    expect(r.get("x")).toBe(false)
  })

  test("Q_SET and Q_RESET latch: set while the value is TRUE, reset while the other's is", () => {
    const r = runner("on, c, y : BOOL;", "%NETWORK\nASSIGN(on, Q_SET => y);\nASSIGN(c, Q_RESET => y);\n")
    expect(trace(r, "y", [{ on: true }, { on: false }, { c: true }, { c: false }, {}])).toEqual([true, true, false, false, false])
  })

  test("series coils: the inner coil hands on the value it receives, its own mark not", () => {
    const r = runner("a, x, y : BOOL;", "%NETWORK\nASSIGN(ASSIGN(a, Q_INVERTED => x), Q => y);\n")
    expect(trace(r, "y", [{ a: true }, { a: false }])).toEqual([true, false])
    expect(r.get("x")).toBe(true)
  })

  test("a mark on the line into the inner coil reaches both", () => {
    const r = runner("a, x, y : BOOL;", "%NETWORK\nASSIGN(ASSIGN(INVERT(a), Q => x), Q => y);\n")
    expect(trace(r, "y", [{ a: true }, { a: false }])).toEqual([false, true])
    expect(r.get("x")).toBe(true)
  })

  test("a coil inside a rung writes its target where the rung reads it, and hands its value on: a contact, a box input", () => {
    const contact = runner("a, b, x, y : BOOL;", "%NETWORK\nASSIGN(ASSIGN(a, Q => x) AND b, Q => y);\n")
    expect(trace(contact, "y", [{ a: true }, { b: true }, { a: false }])).toEqual([false, true, false])
    expect(contact.get("x")).toBe(false)
    const box = runner("a, b, c, x, y : BOOL;", "%NETWORK\nASSIGN(AND(a, ASSIGN(b, Q_SET => x), c), Q => y);\n", "", "FBD")
    expect(trace(box, "x", [{}, { b: true }, { b: false }])).toEqual([false, true, true])
    expect(trace(box, "y", [{ a: true, b: true, c: true }])).toEqual([true])
  })

  test("a jump and the return on Q_INVERTED are taken on NOT the value", () => {
    const jump = runner("a, x : BOOL;", "%NETWORK\nASSIGN(a, Q_INVERTED => JMP.l);\n%NETWORK\nASSIGN(INVERT(x), Q => x);\n%NETWORK\nl:\n;\n")
    expect(trace(jump, "x", [{ a: false }, { a: true }, {}])).toEqual([false, true, false])
    const ret = runner("a : BOOL; n : INT;", "%NETWORK\nASSIGN(a, Q_INVERTED => RETURN);\n%NETWORK\nASSIGN(ADD(n, 1), Q => n);\n")
    expect(trace(ret, "n", [{}, { a: true }, {}])).toEqual([0n, 1n, 2n])
  })

  test("coils and a jump on one value: the value written once, the coils, then the jump", () => {
    const r = runner("a, x, y : BOOL;", "%NETWORK\nASSIGN(a, Q => x, Q => JMP.l);\n%NETWORK\nASSIGN(TRUE, Q => y);\n%NETWORK\nl:\n;\n")
    expect(trace(r, "x", [{ a: true }])).toEqual([true])
    expect(r.get("y")).toBe(false)
  })

  test("a jump in a tree: its value held, the jump taken where the tree is evaluated, the value handed on", () => {
    const r = runner("a, b, y : BOOL; n : INT;", "%NETWORK\nASSIGN(ASSIGN(a, Q_INVERTED => JMP.l) AND b, Q => y);\n%NETWORK\nASSIGN(ADD(n, 1), Q => n);\n%NETWORK\nl:\n;\n")
    expect(trace(r, "n", [{ a: false }, { a: true, b: true }])).toEqual([0n, 1n])
    expect(r.get("y")).toBe(true)
  })

  test("an edge on a jump's value is the value's edge", () => {
    const r = runner("a : BOOL; n : INT;", "%NETWORK\nASSIGN(RISING(a), Q => JMP.l);\n%NETWORK\nASSIGN(ADD(n, 1), Q => n);\n%NETWORK\nl:\n;\n", TRIGS)
    expect(trace(r, "n", [{ a: true }, {}, { a: false }])).toEqual([0n, 1n, 2n])
  })
})

describe("a mark on a value is a function, nested in run order (network-language rule 1)", () => {
  test("INVERT on an integer is the bitwise NOT", () => {
    const r = runner("i : INT := 5; k : INT;", "%NETWORK\nASSIGN(INVERT(i), Q => k);\n%NETWORK\nASSIGN(MOVE(INVERT(i)), Q => i);\n", "", "FBD")
    expect(trace(r, "k", [{}])).toEqual([-6n])
    expect(r.get("i")).toBe(-6n)
  })

  test("stacked marks run innermost first: the edge of the negated value, the negation of the edge", () => {
    const edgeOfNot = runner("a, y : BOOL;", "%NETWORK\nASSIGN(RISING(INVERT(a)), Q => y);\n", TRIGS)
    expect(trace(edgeOfNot, "y", [{ a: true }, { a: false }, {}, { a: true }])).toEqual([false, true, false, false])
    const notOfEdge = runner("a, y : BOOL;", "%NETWORK\nASSIGN(INVERT(RISING(a)), Q => y);\n", TRIGS)
    expect(trace(notOfEdge, "y", [{ a: true }, {}, { a: false }])).toEqual([false, true, true])
  })

  test("the full stack the store holds runs as CODESYS's NOT(NOT(R_TRIG(R_TRIG(a))))", () => {
    const r = runner("a, y : BOOL;", "%NETWORK\nASSIGN(INVERT(RISING(RISING(a))), Q_INVERTED => y);\n", TRIGS)
    expect(trace(r, "y", [{ a: true }, {}, { a: false }, { a: true }])).toEqual([true, false, false, true])
  })

  test("a pin's and EN's marks are their value's: INVERT negates what the box reads, an edge is the value's edge", () => {
    const en = runner("c : BOOL; n : INT;", "%NETWORK\nMOVE(EN := INVERT(c), 1, OUT => n);\n", "", "FBD")
    expect(trace(en, "n", [{ c: true }, { c: false }])).toEqual([0n, 1n])
    const pin = runner("a, x : BOOL;", "%NETWORK\nASSIGN(AND(INVERT(a), TRUE), Q => x);\n", "", "FBD")
    expect(trace(pin, "x", [{ a: true }, { a: false }])).toEqual([false, true])
    const edge = runner("a : BOOL; c1 : FB_C;", "%NETWORK\nc1(CU := RISING(a));\n", TRIGS + COUNTER, "FBD")
    expect(trace(edge, "c1.CV", [{ a: true }, {}, { a: false }, { a: true }])).toEqual([1n, 1n, 1n, 2n])
    const enEdge = runner("c : BOOL; n : INT;", "%NETWORK\nMOVE(EN := RISING(c), ADD(n, 1), OUT => n);\n", TRIGS, "FBD")
    expect(trace(enEdge, "n", [{ c: true }, {}, { c: false }, { c: true }])).toEqual([1n, 1n, 1n, 2n])
  })

  test("a box read where it stands takes the mark on its output", () => {
    const r = runner("a, b, x : BOOL;", "%NETWORK\nASSIGN(INVERT(AND(a, b)), Q => x);\n", "", "FBD")
    expect(trace(r, "x", [{ a: true, b: true }, { b: false }])).toEqual([false, true])
  })
})

describe("a mark on a box's output is in its name (network-language rule 2)", () => {
  test("Q_INVERTED writes NOT the output; Q_SET and Q_RESET latch on it", () => {
    const r = runner("a, x, k, m : BOOL; c1, c2 : FB_C;", "%NETWORK\nc1(CU := a, Q_INVERTED => x);\nc2(CU := a, Q_SET => k);\n%NETWORK\nASSIGN(TRUE, Q => m);\nc1(CU := FALSE, Q_RESET => m);\n", COUNTER, "FBD")
    expect(trace(r, "x", [{ a: true }, {}, {}, { a: false }])).toEqual([true, true, false, false])
    expect([r.get("k"), r.get("m")]).toEqual([true, false])
  })

  test("a function's value marked: OUT_INVERTED, at a root and read", () => {
    const r = runner("a, x, y, z : BOOL;", "%NETWORK\nMOVE(a, OUT_INVERTED => x);\n%NETWORK\nASSIGN(MOVE(EN := TRUE, a, OUT_INVERTED => y), Q => z);\n", "", "FBD")
    expect(trace(r, "x", [{ a: true }, { a: false }])).toEqual([false, true])
    expect([r.get("y"), r.get("z")]).toEqual([true, true])
  })
})

describe("a built-in function box shows its pins by name and runs them by position (network-function-formal-pins)", () => {
  test("LIMIT, SEL, MUX, MIN, MAX and MOVE with formal pins give the positional call's values", () => {
    const vars = "y, z, m, n, o, p : INT; v : INT := 150; a : INT := 3; b : INT := 9; g : BOOL;"
    const body =
      "%NETWORK\nASSIGN(LIMIT(MN := 0, IN := v, MX := 100), Q => y);\nASSIGN(SEL(G := g, IN0 := a, IN1 := b), Q => z);\n" +
      "ASSIGN(MUX(K := 1, IN0 := a, IN1 := b), Q => m);\nASSIGN(MIN(IN1 := a, IN2 := b), Q => n);\nASSIGN(MAX(IN1 := a, IN2 := b), Q => o);\n" +
      "ASSIGN(MOVE(IN := a), Q => p);\n"
    const r = runner(vars, body, "", "FBD")
    r.scan()
    expect(["y", "z", "m", "n", "o", "p"].map((k) => r.get(k))).toEqual([100n, 3n, 9n, 3n, 9n, 3n])
  })

  test("a name the box has no pin of, or a pin given twice, is refused by name", () => {
    expect(lowered("y, v : INT;", "%NETWORK\nASSIGN(LIMIT(MN := 0, IN := v, TOP := 100), Q => y);\n", "", "FBD").diagnostics.map((d) => d.message)).toEqual([
      "the LIMIT box has no pin TOP: its pins are MN, IN, MX",
    ])
    expect(lowered("y, v : INT;", "%NETWORK\nASSIGN(MIN(IN1 := v, IN1 := 3), Q => y);\n", "", "FBD").diagnostics.map((d) => d.message)).toEqual([
      "the box MIN names its pin IN1 out of place: an operator runs its pins by position, whatever their names say. Write them in order",
    ])
  })

  test("in ST a built-in called with named arguments stays refused, as CODESYS refuses it there", () => {
    const st = lowerSource("PROGRAM P\nVAR\n\ty, v : INT;\nEND_VAR\n%LANGUAGE ST\ny := LIMIT(MN := 0, IN := v, MX := 100);\nEND_PROGRAM\n", "P")
    expect(st.diagnostics.map((d) => d.code)).toEqual(["call-named-args"])
  })

  test("a wire lowering cannot declare is refused at the wire; MOVE(x) types its wire as x", () => {
    const src = "PROGRAM P\nVAR\n\tarr, out : ARRAY[0..1] OF INT;\nEND_VAR\n%LANGUAGE FBD\n%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := MOVE(arr);\nASSIGN(w1, Q => out);\nEND_PROGRAM\n"
    const [d] = lowerSource(src, "P").diagnostics
    expect([d!.code, src.slice(d!.span.start, d!.span.end)]).toEqual(["network-wire-type", "w1"])
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

describe("an enabled comparison's target, disabled, where it shows EN and so its ENO (live CODESYS 3.5.21.40, nwl-box-storage-map)", () => {
  const z = (body: string) => {
    const r = runner("gf, z, y : BOOL; i, j : INT;", `%NETWORK\nASSIGN(TRUE, Q => z);\n%NETWORK\n${body}\n`, "", "FBD")
    r.scan()
    return r.get("z")
  }
  test("held at a root", () => expect(z("GT(EN := gf, i, j, OUT => z);")).toBe(true))
  test("held, read", () => expect(z("ASSIGN(GT(EN := gf, i, j, OUT => z), Q => y);")).toBe(true))
})

describe("what the lowering refuses, by name", () => {
  const codes = (vars: string, body: string, extra = "") => lowered(vars, body, extra).diagnostics.map((d) => [d.code, d.message])

  test("a retired form and a mark word: no network text, so nothing runs a meaning the push refuses", () => {
    expect(codes("a, y : BOOL;", "%NETWORK\ny := a;\n")).toEqual([
      ["network-box", "y := value is no network text: a coil is ASSIGN(value, Q => y), and only a wire is assigned, w1 := value"],
    ])
    expect(codes("a, b, y : BOOL;", "%NETWORK\nASSIGN(a AND NOT b, Q => y);\n")[0]![1]).toContain("a mark is a function around a value")
  })

  test(".ENO: the flow of a box showing EN is its ENO, written as the call alone", () =>
    expect(codes("x, a, c : BOOL; c1 : FB_C;", "%NETWORK\nASSIGN(c1(EN := c, CU := a).ENO, Q => x);\n", COUNTER)).toEqual([
      ["network-box", ".ENO is no network text: ENO is the flow of a box showing EN, written as the call alone, c1(EN := …)"],
    ]))

  test("a FUNCTION's OUT => at a root: the IDE does not write it", () =>
    expect(codes("k, i : INT;", "%NETWORK\nf(n := i, OUT => k);\n", "FUNCTION f : INT\nVAR_INPUT n : INT; END_VAR\n%LANGUAGE ST\nf := n;\nEND_FUNCTION\n")).toEqual([
      ["network-box", "the function box f wires OUT => at a root: the IDE does not write it. Read its value, ASSIGN(f(…), Q => x)"],
    ]))

  test("one output wired to two targets: the IDE writes no second one, so nothing runs a meaning the text does not have", () =>
    expect(codes("a, x, y : BOOL;", "%NETWORK\nMOVE(a, OUT => x, OUT => y);\n")).toEqual([
      ["network-box", "the call MOVE wires OUT => twice: the IDE writes no second target. Two targets are one ASSIGN, ASSIGN(MOVE(…), Q => x, Q => y)"],
    ]))

  test("a pin by position on an FB: the IDE drops it, so nothing runs it passed", () =>
    expect(codes("x, a : BOOL; c1 : FB_C;", "%NETWORK\nc1(a);\n", COUNTER)).toEqual([
      ["network-box", "the call c1 passes a pin by position: the box of an FB or a program passes only named pins, and the IDE drops the rest. Name it, c1(<pin> := value)"],
    ]))

  test("a variable on the ENO pin: the IDE never writes it, so nothing runs it written", () =>
    expect(codes("a, c, x, z : BOOL;", "%NETWORK\nMOVE(EN := c, a, ENO => z, OUT => x);\n")).toEqual([
      ["network-box", "the call MOVE wires ENO =>: the IDE never writes a variable on the ENO pin. ENO is the flow of a box showing EN, ASSIGN(MOVE(EN := …), Q => v)"],
    ]))

  test("an operator handing on its ENO with its value wired nowhere: CODESYS does not build it", () =>
    expect(codes("c, y : BOOL; i, j : INT;", "%NETWORK\nASSIGN(GT(EN := c, i, j), Q => y);\n")).toEqual([
      ["network-box", "the operator box GT hands on its ENO and wires its value nowhere. Wire it, GT(EN := …, …, OUT => v)"],
    ]))

  test("a box read by its value with OUT => on it: the IDE writes no second target", () =>
    expect(codes("k, m, i, j : INT;", "%NETWORK\nASSIGN(ADD(i, j, OUT => m), Q => k);\n")).toEqual([
      ["network-box", "the box ADD is read by its value and wires OUT =>: the IDE writes no second target. Two targets are ASSIGN's, ASSIGN(ADD(…), Q => x, Q => y)"],
    ]))

  test("an operator's pin named out of place: it runs by position, so nothing runs what the names say", () =>
    expect(codes("k, i, j : INT;", "%NETWORK\nASSIGN(SUB(IN2 := i, IN1 := j), Q => k);\n")[0]).toEqual([
      "network-box", "the box SUB names its pin IN1 out of place: an operator runs its pins by position, whatever their names say. Write them in order",
    ]))

  test("an enabled box other than a comparison read inside a tree", () =>
    expect(codes("x : BOOL; i : INT; c : BOOL;", "%NETWORK\nASSIGN(EQ(ADD(EN := c, i, 1).OUT, 2), Q => x);\n")).toEqual([
      ["network-box", "the enabled ADD box is read by its value other than as an assignment's whole value"],
    ]))
})

describe("a jump crosses networks as in an ST body (`nt_jmp_over_network`, recorded 2026-10-31)", () => {
  test("`ASSIGN(v, Q => JMP.l)` passes the networks before its label while v holds", () => {
    const r = runner("a, x, y : BOOL;", "%NETWORK\nASSIGN(a, Q => JMP.l1);\n%NETWORK\nASSIGN(TRUE, Q => x);\n%NETWORK\nl1:\nASSIGN(TRUE, Q => y);\n")
    expect(trace(r, "x", [{ a: true }, { a: false }])).toEqual([false, true])
    expect(r.get("y")).toBe(true)
  })
})

describe("where a network's state lives", () => {
  test("an ACTION's wires are fields of the instance it runs on, __nw_<action>_<N>_<wire>", () => {
    const src =
      "PROGRAM P\nVAR\n\ta, x : BOOL;\nEND_VAR\n%LANGUAGE ST\nA1();\nEND_PROGRAM\n" +
      "ACTION A1\n%LANGUAGE LD\n%NETWORK\nVAR w1 : ANY; END_VAR\nASSIGN(w1, Q => x);\nw1 := a;\nEND_ACTION\n"
    const { pou, diagnostics } = lowerSource(src, "P")
    expect(diagnostics).toEqual([])
    const r = run(pou!)
    expect(trace(r, "P.x", [{ "P.a": true }, {}])).toEqual([false, true])
    expect(r.get("P.__nw_A1_1_w1")).toBe(true)
  })

  test("a wire is kept across scans, read before its definition the previous scan's value, by the path __nw<N>_<wire>", () => {
    const r = runner("a, b, x : BOOL;", "%NETWORK\nVAR w1 : ANY; END_VAR\nASSIGN(a AND w1, Q => x);\nw1 := b;\n")
    expect(trace(r, "x", [{ a: true, b: true }, { b: false }, {}])).toEqual([false, true, false])
    expect(r.get("__nw1_w1")).toBe(false)
  })

  test("the wire's network index is its place in the body, a disabled network counted and lowered to nothing", () => {
    const r = runner("a, x, y : BOOL;", "%NETWORK\n%DISABLED\nASSIGN(TRUE, Q => y);\n%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := INVERT(a);\nASSIGN(w1, Q => x);\n")
    r.scan()
    expect([r.get("x"), r.get("y"), r.get("__nw2_w1")]).toEqual([true, false, true])
  })
})

describe("a value standing alone", () => {
  test("an operand, contacts, a branch and the rail are evaluated and change nothing", () => {
    const r = runner("a, b, c, x : BOOL;", "%NETWORK\na;\nINVERT(b);\na AND b;\nBRANCH(FEED := a, b, c);\nRAIL();\nINVERT(AND(a, b));\n%NETWORK\nASSIGN(a, Q => x);\n")
    expect(trace(r, "x", [{ a: true }, { a: false }])).toEqual([true, false])
  })

  test("a box consumed by nothing runs, its mark of no effect", () => {
    const r = runner("a : BOOL; c1 : FB_C;", "%NETWORK\nINVERT(c1(CU := a));\n", COUNTER, "FBD")
    expect(trace(r, "c1.CV", [{ a: true }, {}, { a: false }])).toEqual([1n, 2n, 2n])
  })
})

test("INVERT around an Execute box negates its ENO, its ST running under its EN", () => {
  const r = runner("go, y : BOOL; n : INT;", "%NETWORK\nASSIGN(INVERT(EXECUTE(EN := go, 'n := n + 1;')), Q => y);\n")
  expect(trace(r, "y", [{}, { go: true }])).toEqual([true, false])
  expect(r.get("n")).toBe(1n)
})

test("an operand comment is the operand it wraps: a value, a coil, a pin", () => {
  const r = runner("a, x, y : BOOL; c1 : FB_C;", "%NETWORK\nASSIGN(COMMENT(a, 'why'), Q => y);\nASSIGN(a, Q_INVERTED => COMMENT(x, 'why'));\nc1(CU := COMMENT(a, 'in'));\n", COUNTER, "FBD")
  expect(trace(r, "y", [{ a: true }, { a: false }])).toEqual([true, false])
  expect([r.get("x"), r.get("c1.CV")]).toEqual([true, 1n])
})

describe("a pin with no value is refused, never thrown (openspec network-empty-pin-value)", () => {
  const TON = "FUNCTION_BLOCK FB_T\nVAR_INPUT IN : BOOL; PT : TIME; END_VAR\nVAR_OUTPUT Q : BOOL; ET : TIME; END_VAR\n%LANGUAGE ST\nQ := IN;\nEND_FUNCTION_BLOCK\n"
  for (const [body, message] of [
    ["MOVE(EN := , 1, OUT => n);", "an operand at EN :=: an unconnected pin is left out, the rail is RAIL()"],
    ["ASSIGN(MOVE(EN := , 1).OUT, Q => n);", "an operand at EN :=: an unconnected pin is left out, the rail is RAIL()"],
    ["t1(IN := , PT := T#1S);", "an operand at IN :=: an unconnected pin is left out, the rail is RAIL()"],
    ["t1(IN := a, PT := T#1S, ET => );", "an output target at ET =>: an unconnected output is left out"],
  ] as const)
    test(body, () => {
      expect(lowered("a : BOOL;\nn : INT;\nt1 : FB_T;", `%NETWORK\n${body}\n`, TON, "FBD").diagnostics.map((d) => d.message)).toEqual([message])
    })
})

test("a library function's box named through its namespace hands on its value, as the bare one does", () => {
  const len = { uri: "Library Manager/Standard/LEN.pou", source: "FUNCTION LEN : INT\nVAR_INPUT\n\tSTR : STRING(255);\nEND_VAR\n%LANGUAGE ST\nLEN := 3;\nEND_FUNCTION\n" }
  const manifest = { uri: "Library Manager/Standard/Standard.library", source: "LIBRARY Standard\nNAMESPACE Standard\nRESOLUTION Standard, 3.5.15.0 (System)\n" }
  const { pou, diagnostics } = lowerSource(
    "PROGRAM P\nVAR\ny : INT;\ntxt : STRING;\nEND_VAR\n%LANGUAGE FBD\n%NETWORK\nASSIGN(Standard.LEN(txt), Q => y);\nEND_PROGRAM\n", "P", [len, manifest])
  expect(diagnostics).toEqual([])
  const r = run(pou!)
  r.scan()
  expect(r.get("y")).toBe(3n)
})

describe("an FB box's first output counts its inherited outputs first, as its box lists them", () => {
  const BASE = "FUNCTION_BLOCK FB_Base\nVAR_OUTPUT\n\tq0 : BOOL := TRUE;\nEND_VAR\n%LANGUAGE ST\n;\nEND_FUNCTION_BLOCK\n"
  const DERIVED = "FUNCTION_BLOCK FB_Derived EXTENDS FB_Base\nVAR_INPUT\n\tgo : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tq1 : BOOL;\nEND_VAR\n%LANGUAGE ST\nq1 := go;\nEND_FUNCTION_BLOCK\n"
  const body = "%NETWORK\nASSIGN(d(go := FALSE), Q => y);\n"

  test("a project FB: its base's output", () => {
    const r = runner("y : BOOL; d : FB_Derived;", body, BASE + DERIVED, "FBD")
    expect(trace(r, "y", [{}])).toEqual([true])
  })

  test("a library FB whose base is the library's own (lenze-mid's L_MC1P_ChangeMachineData EXTENDS L_MC1P_Template)", () => {
    const lib = [
      { uri: "Library Manager/Lib/FB_Base.pou", source: BASE },
      { uri: "Library Manager/Lib/FB_Derived.pou", source: DERIVED },
    ]
    const { pou, diagnostics } = lowerSource(`PROGRAM P\nVAR\ny : BOOL;\nd : FB_Derived;\nEND_VAR\n%LANGUAGE FBD\n${body}END_PROGRAM\n`, "P", lib)
    expect(diagnostics).toEqual([])
    const r = run(pou!)
    r.scan()
    expect(r.get("y")).toBe(true)
  })
})
