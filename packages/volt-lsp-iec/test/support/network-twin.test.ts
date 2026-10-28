/**
 * THE EXEC TWIN'S MEASURED RULES, one small network each (openspec network-text-st 2.4; `network-twin.ts`). The corpus
 * gate (`test/corpus/corpus-twins.test.ts`) builds the twins; these pin WHAT a twin runs where 1.3 / 1.4 measured it.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../src/frontend/syntax/index.js"
import { build } from "../../src/frontend/symbols/index.js"
import { twinFile } from "./network-twin-file.js"

function twin(decls: string, body: string, before = ""): { source: string; refused: string[] } {
  const source = `${before}PROGRAM P\nVAR\n${decls}\nEND_VAR\n%LANGUAGE FBD\n${body}END_PROGRAM\n`
  const parseResult = parseSource(source, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "file:///P.pou", parseResult, source }], [], "codesys")
  return twinFile(source, parseResult, project)
}

/** The ST lines of the twin's body, without its VAR block. */
const code = (source: string) => source.slice(source.lastIndexOf("%LANGUAGE ST\n") + "%LANGUAGE ST\n".length, source.indexOf("END_PROGRAM")).trim()

test("a box with EN and no ENO read by its value under a coil holds the coil when disabled (1.4)", () => {
  const t = twin("\ty : INT := 5;\n\tk : INT := 7;\n\tc : BOOL;", "%NETWORK\ny := MOVE_ENONLY(EN := c, k);\n")
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("IF c THEN\n\ty := k;\nEND_IF;")
})

test("a comparison with EN and no ENO read by its value is FALSE when disabled (1.3)", () => {
  const t = twin("\tx, a : BOOL;\n\ti : INT;\n\tc : BOOL;", "%NETWORK\nx := a AND GT_ENONLY(EN := c, i, 3);\n")
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("IF c THEN\n\tvtw1_eno1 := (i > 3);\nELSE\n\tvtw1_eno1 := FALSE;\nEND_IF;\nx := (a AND vtw1_eno1);")
})

test("a box with EN and no ENO at the root runs under its EN", () => {
  const t = twin("\ta, b : INT;\n\tc : BOOL;", "%NETWORK\nMOVE_ENONLY(EN := c, b, OUT => a);\n")
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("IF c THEN\n\ta := b;\nEND_IF;")
})

test("a jump and a return on a value are the IF that takes them; in a tree, on the value held", () => {
  const t = twin("\tx, a, c, d : BOOL;", "%NETWORK\nJMP(l1, a);\nRETURN(c);\nx := JMP(l1, c) AND d;\n%NETWORK\nl1:\nx := a;\n")
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe(
    "IF a THEN JMP l1; END_IF;\nIF c THEN RETURN; END_IF;\nvtw1_eno1 := c;\nIF vtw1_eno1 THEN JMP l1; END_IF;\nx := (vtw1_eno1 AND d);\nl1:\nx := a;",
  )
})

test("an edge is an edge detector called on every scan, read by its Q (1.3: rt(CLK := a); out := en AND rt.Q)", () => {
  const t = twin("\tx, en, a : BOOL;", "%NETWORK\nx := en AND R_EDGE(NOT a);\n")
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("vtw1_trig1(CLK := (NOT a));\nx := (en AND vtw1_trig1.Q);")
  expect(t.source).toContain("vtw1_trig1 : R_TRIG;")
})

test("a BRANCH runs every branch: the feed AND the OR of its branches", () => {
  const t = twin("\tx, f, a, b : BOOL;", "%NETWORK\nx := BRANCH(FEED := f, a, b);\n")
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("x := (f AND (a OR b));")
})

test("a BRANCH_SHORTCIRCUIT runs a branch holding a box unless the feed and a box-free branch are both TRUE (1.4), its FB with it", () => {
  const fb = "FUNCTION_BLOCK FB_T\nVAR_INPUT\n\tIN : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\nEND_VAR\n%LANGUAGE ST\nQ := IN;\nEND_FUNCTION_BLOCK\n"
  const t = twin("\tx, f, a, b : BOOL;\n\tt1 : FB_T;", "%NETWORK\n%WIRES w1\nt1(IN := b, Q => w1);\nx := BRANCH_SHORTCIRCUIT(FEED := f, a, w1);\n", fb)
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe(
    "vtw1_eno1 := f;\nvtw1_eno2 := a;\nIF NOT (vtw1_eno1 AND vtw1_eno2) THEN\n\tt1(IN := b);\n\tvtw1_eno3 := t1.Q;\nEND_IF;\nx := (vtw1_eno1 AND (vtw1_eno2 OR vtw1_eno3));",
  )
})
