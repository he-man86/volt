/**
 * The network-text box checks (`_boxes.ts`): an FB instance's pins, and `.ENO` read off a box with no EN.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeNetworkTextDiagnostics, messagesFor } from "../../index.js"
import { doc, vgDiags } from "../../../../test/support/network-docs.js"

const vgByCode = (src: string, code: string): number => vgDiags(src).filter((d) => d.code === code).length

// network-unknown-pin — an FB box passing a pin the FB doesn't declare (checked only for resolved project FBs).
const FB_M = `FUNCTION_BLOCK FB_M
VAR_INPUT a : BOOL; END_VAR
END_FUNCTION_BLOCK
`
test("network text: an unknown FB pin is flagged; a declared pin is not", () => {
  const bad = `${FB_M}FUNCTION_BLOCK F
VAR m : FB_M; x : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
m(b := x);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(bad, "network-unknown-pin")).toBe(1)
  const good = bad.replace("m(b := x)", "m(a := x)")
  expect(vgByCode(good, "network-unknown-pin")).toBe(0)
})

test("network text: a box on an unresolvable (library/standard) FB is not pin-checked", () => {
  const src = `FUNCTION_BLOCK F
VAR tmr : TON; on : BOOL; t : TIME; END_VAR
IMPLEMENTATION FBD
NETWORK
tmr(IN := on, PT := t, MADE_UP := on);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(src, "network-unknown-pin")).toBe(0) // TON is not a project FB → skipped, no guess
})

test("network text: EN is a pin of every box and ENO its suffix, not unknown pins", () => {
  // EN/ENO are IMPLICIT on every FBD/LD box — not declared in the FB. lenze-mid drives EN on four project FBs and its
  // recorded build accepts every one.
  const src = `FUNCTION_BLOCK Outer
VAR inner : Inner; go : BOOL; done : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
  done := inner(EN := go).ENO;
END_NETWORK
END_FUNCTION_BLOCK
FUNCTION_BLOCK Inner
VAR_INPUT x : BOOL; END_VAR
END_FUNCTION_BLOCK`
  expect(vgDiags(src).filter((d) => d.code === "network-unknown-pin")).toEqual([])
})

test("network text: a pin the FB really lacks is still reported", () => {
  const src = `FUNCTION_BLOCK Outer
VAR inner : Inner; go : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
  inner(nosuchpin := go);
END_NETWORK
END_FUNCTION_BLOCK
FUNCTION_BLOCK Inner
VAR_INPUT x : BOOL; END_VAR
END_FUNCTION_BLOCK`
  expect(vgDiags(src).map((d) => d.code)).toContain("network-unknown-pin")
})

test("network text: `.ENO` on an operator box with no EN is CODESYS's 'Missing EN pin'; on an FB it is the FB's own", () => {
  // openspec bridge-refusal-review 1.5: the push builds the box the text describes and CODESYS's build answers it
  // (`rcc_network_eno_without_en`, SP21 2026-10-04; DIALECT N21). An FB may declare ENO without EN (Lenze `Dryer`, N16).
  const fb = (vars: string, statement: string) =>
    `FUNCTION_BLOCK FB_T\nVAR_INPUT IN : BOOL; END_VAR\nVAR_OUTPUT ENO : BOOL; END_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB\nVAR a : INT; b : INT; x : BOOL; go : BOOL; ${vars} END_VAR\nIMPLEMENTATION FBD\nNETWORK\n  ${statement}\nEND_NETWORK\nEND_FUNCTION_BLOCK`
  const missing = "An inconsistent element has been detected (Missing EN pin). Consider making a correction."
  expect(vgDiags(fb("", "x := ADD(a, b).ENO;")).map((d) => d.message)).toContain(missing)
  expect(vgDiags(fb("", "x := ADD(EN := go, a, b).ENO;")).map((d) => d.message)).not.toContain(missing)
  expect(vgDiags(fb("t : FB_T;", "x := t(IN := go).ENO;")).map((d) => d.message)).not.toContain(missing)
})

test("network text: `.ENO` with no EN on a FUNCTION's box is CODESYS's 'The assignment source is incorrect.', a qualified one too", () => {
  // review 5+6, measured (`rcc_network_eno_function_without_en`, SP21 2026-10-04): a FUNCTION's box answers about the
  // source, not the pin — the check had borrowed the operator box's "Missing EN pin" for every head that is no variable.
  // And a member head used to count as a path to a variable whatever it named, so `Lib.F(a, b).ENO` passed for an FB
  // call: a namespace qualifying a POU names a function.
  const lib = "file:///w/Library Manager/Util"
  const manifest = { uri: `${lib}/Util.library`, folder: "Util", dir: `${lib}/`, namespace: "Util", library: "Util", dependencies: [], materialization: 2 }
  const libSrc = "FUNCTION Twice : INT\nVAR_INPUT\n  a : INT;\n  b : INT;\nEND_VAR\nTwice := a + b;\nEND_FUNCTION\n"
  const source = "The assignment source is incorrect."
  const missing = "An inconsistent element has been detected (Missing EN pin). Consider making a correction."
  const run = (statement: string) => {
    const src = `FUNCTION FUN : INT\nVAR_INPUT a : INT; b : INT; END_VAR\nFUN := a + b;\nEND_FUNCTION\nFUNCTION_BLOCK FB\nVAR a : INT; b : INT; x : BOOL; go : BOOL; END_VAR\nIMPLEMENTATION FBD\nNETWORK\n  ${statement}\nEND_NETWORK\nEND_FUNCTION_BLOCK`
    const d = doc(src)
    const p = build.buildSymbolTable(
      [{ uri: d.uri, source: d.source, parseResult: d.parseResult }, { uri: `${lib}/Twice.pou`, source: libSrc, parseResult: parseSource(libSrc, { networkText: true }, "codesys") }],
      [manifest], "codesys",
    )
    return computeNetworkTextDiagnostics(d, p, messagesFor("codesys")).map((m) => m.message)
  }
  expect(run("x := FUN(a, b).ENO;")).toEqual([source])
  expect(run("x := Util.Twice(a, b).ENO;")).toEqual([source])
  expect(run("x := FUN(EN := go, a, b).ENO;")).not.toContain(source)
  expect(run("x := Util.Twice(EN := go, a, b).ENO;")).not.toContain(source)
  expect(run("x := ADD(a, b).ENO;")).toContain(missing)
  // a member the namespace does not show is unknown — it could be a library global instance — so nothing rests on it
  const unknown = run("x := Util.gInst(IN := go).ENO;")
  expect([unknown.includes(source), unknown.includes(missing)]).toEqual([false, false])
  // nor on an unmeasured box kind: MOVE is no operator of the table and resolves to no declared callable
  expect(run("x := MOVE(a).ENO;")).not.toContain(missing)
})
