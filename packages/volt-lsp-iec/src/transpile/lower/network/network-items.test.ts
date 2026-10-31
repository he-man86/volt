/**
 * A NETWORK'S ITEMS LOWERED AND RUN (`network.ts`): the assignment item's marks, a jump's and the return's marks, a value
 * standing alone, the Execute box negated where it is read, and the operand comment — one small network each, run for a
 * few scans.
 */
import { describe, expect, test } from "bun:test"
import { run, type Runner } from "../../interp/index.js"
import { lowerSource } from "../index.js"

const TRIGS =
  "FUNCTION_BLOCK R_TRIG\nVAR_INPUT CLK : BOOL; END_VAR\nVAR_OUTPUT Q : BOOL; END_VAR\nVAR M : BOOL; END_VAR\n%LANGUAGE ST\nQ := CLK AND NOT M;\nM := CLK;\nEND_FUNCTION_BLOCK\n"
const COUNTER =
  "FUNCTION_BLOCK FB_C\nVAR_INPUT CU : BOOL; END_VAR\nVAR_OUTPUT Q : BOOL; CV : INT; END_VAR\n%LANGUAGE ST\nIF CU THEN CV := CV + 1; END_IF;\nQ := CV >= 3;\nEND_FUNCTION_BLOCK\n"

const lowered = (vars: string, body: string, extra = "", language = "LD") =>
  lowerSource(`PROGRAM P\nVAR\n${vars}\nEND_VAR\n%LANGUAGE ${language}\n${body}END_PROGRAM\n${extra}`, "P")

function runner(vars: string, body: string, extra = "", language = "LD"): Runner {
  const { pou, diagnostics } = lowered(vars, body, extra, language)
  expect(diagnostics).toEqual([])
  return run(pou!)
}

function trace(r: Runner, path: string, inputs: readonly Record<string, boolean | bigint>[]): unknown[] {
  return inputs.map((set) => {
    for (const [k, v] of Object.entries(set)) r.set(k, v)
    r.scan()
    return r.get(path)
  })
}

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
