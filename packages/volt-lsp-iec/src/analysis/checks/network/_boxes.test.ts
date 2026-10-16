/**
 * The network-text box checks (`_boxes.ts`): an FB instance's pins, and ENO read off a box with no EN (an open line).
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

test("network text: EN and ENO are every box's own, not unknown pins", () => {
  // EN/ENO are IMPLICIT on every FBD/LD box — not declared in the FB. lenze-mid drives EN on four project FBs and its
  // recorded build accepts every one.
  const src = `FUNCTION_BLOCK Outer
VAR inner : Inner; go : BOOL; done : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
  inner() EN go
  done := ENO;
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

test("network text: an operator box read through ENO with no EN has no text; on an FB its ENO is the FB's own", () => {
  // N21: an operator box shows ENO only with EN, so the reader refuses an open line holding one (P3) — the push never
  // builds it. An FB may declare ENO without EN (Lenze `Dryer`, N16): nothing is said.
  const fb = (vars: string, statement: string) =>
    `FUNCTION_BLOCK FB_T\nVAR_INPUT IN : BOOL; END_VAR\nVAR_OUTPUT ENO : BOOL; END_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB\nVAR a : INT; b : INT; x : BOOL; go : BOOL; sv : INT; ${vars} END_VAR\nIMPLEMENTATION FBD\nNETWORK\n  ${statement}\nEND_NETWORK\nEND_FUNCTION_BLOCK`
  expect(vgDiags(fb("", "a ADD b => sv\n  x := ENO;")).map((d) => d.code)).toEqual(["NETWORK_BAD_EXPRESSION"])
  expect(vgDiags(fb("", "a ADD b => sv EN go\n  x := ENO;"))).toEqual([])
  expect(vgDiags(fb("t : FB_T;", "t(IN := go)\n  x := ENO;"))).toEqual([])
})

test("network text: ENO with no EN on a FUNCTION's box is no component of its result, a qualified one too", () => {
  // Measured (`rcc_network_eno_function_without_en`, SP21, re-recorded 2026-10-16 on the box 2R.3's push builds): a
  // FUNCTION's box read through its ENO, its ENO read as a member of the result, and the coil typed against it. (Before
  // 2R.3 the build answered "The assignment source is incorrect." of a box built without its output list.) A member head
  // used to count as a path to a variable whatever it named, so `Lib.F(a, b)` read through ENO passed for an FB call: a
  // namespace qualifying a POU names a function.
  const lib = "file:///w/Library Manager/Util"
  const manifest = { uri: `${lib}/Util.library`, folder: "Util", dir: `${lib}/`, namespace: "Util", library: "Util", dependencies: [], materialization: 2 }
  const libSrc = "FUNCTION Twice : INT\nVAR_INPUT\n  a : INT;\n  b : INT;\nEND_VAR\nTwice := a + b;\nEND_FUNCTION\n"
  const member = (head: string) => [`'ENO' is no component of '${head}'`, `Cannot convert type 'Unknown type: '${head}.ENO'' to type 'BOOL'`]
  const source = "'ENO' is no component of"
  const run = (statement: string) => {
    const src = `FUNCTION FUN : INT\nVAR_INPUT a : INT; b : INT; END_VAR\nFUN := a + b;\nEND_FUNCTION\nFUNCTION_BLOCK FB\nVAR a : INT; b : INT; x : BOOL; go : BOOL; END_VAR\nIMPLEMENTATION FBD\nNETWORK\n  ${statement}\nEND_NETWORK\nEND_FUNCTION_BLOCK`
    const d = doc(src)
    const p = build.buildSymbolTable(
      [{ uri: d.uri, source: d.source, parseResult: d.parseResult }, { uri: `${lib}/Twice.pou`, source: libSrc, parseResult: parseSource(libSrc, { networkText: true }, "codesys") }],
      [manifest], "codesys",
    )
    return computeNetworkTextDiagnostics(d, p, messagesFor("codesys")).map((m) => m.message)
  }
  expect(run("FUN(a, b)\n  x := ENO;")).toEqual(member("FUN"))
  expect(run("Util.Twice(a, b)\n  x := ENO;")).toEqual(member("Util.Twice"))
  const none = (statement: string) => expect(run(statement).filter((m) => m.startsWith(source))).toEqual([])
  none("FUN(a, b) EN go\n  x := ENO;")
  none("Util.Twice(a, b) EN go\n  x := ENO;")
  // a member the namespace does not show is unknown — it could be a library global instance — so nothing rests on it
  none("Util.gInst(IN := go)\n  x := ENO;")
})

// `??? := ENO` is recorded on three heads only — an operator (NOT), a PROGRAM and a FUNCTION (network-unresolved.ts:
// _unnamed_target_en, _void_caller, _valued_call). An FB INSTANCE read through its ENO has no recording, so nothing is
// said there (gate 2R.3, finding 4): a missing diagnostic is a coverage gap, a wrong one a hard failure.
test("network text: `??? := ENO` off an FB instance's box is unrecorded and says nothing; off a function it is the target complaint", () => {
  const fb = `FUNCTION_BLOCK F
VAR t1 : TON; go : BOOL; a : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
  t1(IN := a, PT := T#1S) EN go
  ??? := ENO;
END_NETWORK
END_FUNCTION_BLOCK`
  const said = (src: string) => vgDiags(src).filter((d) => d.message === "The assignment target is not specified.").length
  expect(said(fb)).toBe(0)
  const fn = `FUNCTION FN : BOOL
VAR_INPUT x : BOOL; END_VAR
FN := x;
END_FUNCTION
FUNCTION_BLOCK F
VAR go : BOOL; a : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
  FN(a) EN go
  ??? := ENO;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(said(fn)).toBe(1)
})
