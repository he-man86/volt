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

test("an enabled box read by its value under a coil holds the coil when disabled (1.4: IF en THEN x := <box>; END_IF)", () => {
  const t = twin("\ty : INT := 5;\n\tk : INT := 7;\n\tc : BOOL;", "%NETWORK\n%WIRES w1\nMOVE_EN(EN := c, k, OUT => w1);\ny := w1;\n")
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("IF c THEN\n\ty := k;\nEND_IF;")
})

test("an enabled comparison read by its value is FALSE when disabled (1.3)", () => {
  const t = twin("\tx : BOOL;\n\ti : INT;\n\tc : BOOL;", "%NETWORK\n%WIRES w1\nGT_EN(EN := c, i, 3, OUT => w1);\nx := w1;\n")
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("IF c THEN\n\tvtw1_w1 := (i > 3);\nELSE\n\tvtw1_w1 := FALSE;\nEND_IF;\nx := vtw1_w1;")
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
