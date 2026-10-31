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
  const parseResult = parseSource(source, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const project = build.buildSymbolTable([{ uri: "file:///P.pou", parseResult, source }], [], "codesys")
  return twinFile(source, parseResult, project)
}

/** The ST lines of the twin's body, without its VAR block. */
const code = (source: string) => source.slice(source.lastIndexOf("%LANGUAGE ST\n") + "%LANGUAGE ST\n".length, source.indexOf("END_PROGRAM")).trim()

test("a box with EN and no ENO read by its value under a coil holds the coil when disabled (1.4)", () => {
  const t = twin("\ty : INT := 5;\n\tk : INT := 7;\n\tc : BOOL;", "%NETWORK\ny := MOVE(EN := c, k);\n")
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("IF c THEN\n\ty := k;\nEND_IF;")
})

test("a comparison with EN and no ENO read by its value is FALSE when disabled (1.3)", () => {
  const t = twin("\tx, a : BOOL;\n\ti : INT;\n\tc : BOOL;", "%NETWORK\nx := a AND GT(EN := c, i, 3);\n")
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("IF c THEN\n\tvtw1_eno1 := (i > 3);\nELSE\n\tvtw1_eno1 := FALSE;\nEND_IF;\nx := (a AND vtw1_eno1);")
})

test("a box with EN and no ENO at the root runs under its EN", () => {
  const t = twin("\ta, b : INT;\n\tc : BOOL;", "%NETWORK\nMOVE(EN := c, b, OUT => a);\n")
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("IF c THEN\n\ta := b;\nEND_IF;")
})

test("a jump and a return on a value are the IF that takes them; in a tree, on the value held", () => {
  const t = twin("\tx, a, c, d : BOOL;", "%NETWORK\nJMP.l1 := a;\nRETURN := c;\nx := (JMP.l1 := c) AND d;\n%NETWORK\nl1:\nx := a;\n")
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe(
    "IF a THEN JMP l1; END_IF;\nIF c THEN RETURN; END_IF;\nvtw1_eno1 := c;\nIF vtw1_eno1 THEN JMP l1; END_IF;\nx := ((vtw1_eno1) AND d);\nl1:\nx := a;",
  )
})

test("an edge is an edge detector called on every scan, read by its Q (1.3: rt(CLK := a); out := en AND rt.Q)", () => {
  const t = twin("\tx, en, a : BOOL;", "%NETWORK\nx := en AND RISING(NOT a);\n")
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
  const t = twin("\tx, f, a, b : BOOL;\n\tt1 : FB_T;", "%NETWORK\nx := BRANCH_SHORTCIRCUIT(FEED := f, a, t1(IN := b));\n", fb)
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe(
    "vtw1_eno1 := f;\nvtw1_eno2 := a;\nIF NOT (vtw1_eno1 AND vtw1_eno2) THEN\n\tt1(IN := b);\n\tvtw1_eno3 := t1.Q;\nEND_IF;\nx := (vtw1_eno1 AND (vtw1_eno2 OR vtw1_eno3));",
  )
})

const timer = "FUNCTION_BLOCK FB_T2\nVAR_INPUT\n\tIN : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\n\tET : INT;\nEND_VAR\n%LANGUAGE ST\nQ := IN;\nEND_FUNCTION_BLOCK\n"

test("an FB box is its instance called before the item that reads it, read by the output its call names (network-output-member)", () => {
  const t = twin("\tx, a, b : BOOL;\n\tn : INT;\n\tt1 : FB_T2;", "%NETWORK\nx := AND(t1(IN := a).Q, b);\nn := t1(IN := a).ET;\n", timer)
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("t1(IN := a);\nx := (t1.Q AND b);\nt1(IN := a);\nn := t1.ET;")
})

test("an FB box with EN runs under it, and its call closed by .ENO hands on its ENO, the EN (1.3)", () => {
  const t = twin("\tx, a, c : BOOL;\n\tt1 : FB_T2;", "%NETWORK\nx := t1(EN := c, IN := a).ENO;\n", timer)
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("IF c THEN\n\tt1(IN := a);\n\tvtw1_eno1 := TRUE;\nELSE\n\tvtw1_eno1 := FALSE;\nEND_IF;\nx := vtw1_eno1;")
})

test("a function box showing ENO and no EN runs on every scan, its ENO FALSE (network-output-member 2.3, measured)", () => {
  const fn = "FUNCTION F_inc : INT\nVAR_INPUT\n\ti : INT;\nEND_VAR\n%LANGUAGE ST\nF_inc := i + 1;\nEND_FUNCTION\n"
  const t = twin("\tx : BOOL;\n\ti, n : INT;", "%NETWORK\nx := F_inc(i := i, OUT => n).ENO;\n", fn)
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("n := F_inc(i := i);\nx := FALSE;")
})

// Measured 2.3: CODESYS compiles neither — a root function box showing ENO without EN ("Type of lazy typed variable …
// could not be resolved", `rcc_network_eno_function_without_en_root`), nor an FB box showing ENO without EN ("'ENO' is no
// component of …"). The twin writes no ST for a network the IDE does not compile.
test("a box showing ENO and no EN at a root, or on an FB, is refused: CODESYS compiles neither", () => {
  const fn = "FUNCTION F_inc : INT\nVAR_INPUT\n\ti : INT;\nEND_VAR\n%LANGUAGE ST\nF_inc := i + 1;\nEND_FUNCTION\n"
  expect(twin("\ti, n : INT;", "%NETWORK\nF_inc(i := i, OUT => n).ENO;\n", fn).refused).toHaveLength(1)
  expect(twin("\tx, a : BOOL;\n\tt1 : FB_T2;", "%NETWORK\nx := t1(IN := a).ENO;\n", timer).refused).toHaveLength(1)
})

// Measured 2.3 (`st-spellings-run.test.ts`): what an enabled box's pins evaluate runs on every scan, whatever its EN — an FB
// box read in a pin is called, an edge detector called; only the box itself runs under its EN.
test("an FB box in a pin of an enabled function box is called before the item, on every scan", () => {
  const t = twin("\tc, a : BOOL;\n\tn : INT;\n\tt1 : FB_T2;", "%NETWORK\nMOVE(EN := c, t1(IN := a).ET, OUT => n).ENO;\n", timer)
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("t1(IN := a);\nIF c THEN\n\tn := t1.ET;\nEND_IF;")
})

test("an edge in an enabled FB box's pin runs on every scan; the FB under its EN", () => {
  const t = twin("\tc, a : BOOL;\n\tt1 : FB_T2;", "%NETWORK\nt1(EN := c, IN := RISING(a)).ENO;\n", timer)
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("vtw1_trig1(CLK := a);\nIF c THEN\n\tt1(IN := vtw1_trig1.Q);\nEND_IF;")
})

test("an edge in an enabled function box's pin runs on every scan; the box under its EN", () => {
  const t = twin("\tc, a, x : BOOL;", "%NETWORK\nx := MOVE(EN := c, RISING(a));\n")
  expect(t.refused).toEqual([])
  expect(code(t.source)).toBe("vtw1_trig1(CLK := a);\nIF c THEN\n\tx := vtw1_trig1.Q;\nEND_IF;")
})

// Measured 2.3: a wire read before its definition reads the value its definition held on the previous scan, so the twin
// keeps its wires across scans (VAR), as CODESYS keeps the network's own.
test("a wire is a VAR of the twin: read before its definition, the previous scan's value", () => {
  const t = twin("\tx, y, a, b, c : BOOL;", "%NETWORK\nVAR_TEMP w1 : ANY; END_VAR\nx := a AND w1;\nw1 := b OR c;\ny := w1;\n")
  expect(t.refused).toEqual([])
  expect(t.source).not.toContain("VAR_TEMP")
  expect(t.source).toContain("VAR\n\tvtw1_w1 : BOOL;\nEND_VAR\n")
})
