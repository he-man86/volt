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

test("network text: ENO with no EN on a LIBRARY function's box is no component of its result; a project one's builds", () => {
  // Measured (SP21): since 2R.4 the push gives a PROJECT function's box its CallType and output list from the declaration,
  // and `rcc_network_eno_function_without_en` builds clean (re-recorded 2026-10-17). A LIBRARY function's box has no
  // declaration to derive from, and the build still reads its ENO as a member of the result — "'ENO' is no component of
  // 'LEN'", the function's own name even through its namespace, then the coil's conversion of the head's ENO
  // (`ng_m_library_function_eno`, `ng_m_library_function_qualified_eno`, 2R.4 gate). With EN nothing is said; its value
  // consumed, CODESYS answers the pushed box "The assignment source is incorrect." (`ng_m_library_function`), which the
  // LSP does not say: the box the editor draws builds, and a pulled text cannot tell the two apart (`checkCallBoxes`).
  const lib = "file:///w/Library Manager/Util"
  const manifest = { uri: `${lib}/Util.library`, folder: "Util", dir: `${lib}/`, namespace: "Util", library: "Util", dependencies: [], materialization: 2 }
  const libSrc = "FUNCTION Twice : INT\nVAR_INPUT\n  a : INT;\n  b : INT;\nEND_VAR\nTwice := a + b;\nEND_FUNCTION\n"
  const run = (statement: string) => {
    const src = `FUNCTION FUN : INT\nVAR_INPUT a : INT; b : INT; END_VAR\nFUN := a + b;\nEND_FUNCTION\nFUNCTION_BLOCK FB\nVAR a : INT; b : INT; x : BOOL; go : BOOL; END_VAR\nIMPLEMENTATION FBD\nNETWORK\n  ${statement}\nEND_NETWORK\nEND_FUNCTION_BLOCK`
    const d = doc(src)
    const p = build.buildSymbolTable(
      [{ uri: d.uri, source: d.source, parseResult: d.parseResult }, { uri: `${lib}/Twice.pou`, source: libSrc, parseResult: parseSource(libSrc, { networkText: true }, "codesys") }],
      [manifest], "codesys",
    )
    return computeNetworkTextDiagnostics(d, p, messagesFor("codesys")).map((m) => m.message)
  }
  expect(run("FUN(a, b)\n  x := ENO;")).toEqual([])
  expect(run("Util.Twice(a, b)\n  x := ENO;")).toEqual([
    "'ENO' is no component of 'Twice'",
    "Cannot convert type 'Unknown type: 'Util.Twice.ENO'' to type 'BOOL'",
  ])
  expect(run("Twice(a, b)\n  x := ENO;")).toEqual(["'ENO' is no component of 'Twice'", "Cannot convert type 'Unknown type: 'Twice.ENO'' to type 'BOOL'"])
  expect(run("FUN(a, b) EN go\n  x := ENO;")).toEqual([])
  expect(run("Util.Twice(a, b) EN go\n  x := ENO;")).toEqual([])
  expect(run("a := FUN(a, b);")).toEqual([])
})

// The rest of the call-box answers (ld-fbd-coverage 2R.4 gate, `ng_m_*`, SP21): a project function's box whose pins do
// not match its inputs once the push has named them (too few; a positional value then a named pin of the same formal), a
// METHOD of an instance given a positional pin (the push names none) — TwinCAT words that one as an empty input name.
test("network text: a call box's pins and kind, as CODESYS builds the box the push writes", () => {
  const fns =
    "FUNCTION F_inc : INT\nVAR_INPUT i : INT; END_VAR\nF_inc := i + 1;\nEND_FUNCTION\n" +
    "FUNCTION F_add : INT\nVAR_INPUT first : INT; second : INT; END_VAR\nF_add := first + second;\nEND_FUNCTION\n" +
    "FUNCTION_BLOCK FB_O\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD M_twice : INT\nVAR_INPUT k : INT; END_VAR\nM_twice := k * 2;\nEND_METHOD\n"
  const caller = (statement: string) =>
    `${fns}FUNCTION_BLOCK F\nVAR v : INT; w : INT; y : INT; fbm : FB_O; END_VAR\nIMPLEMENTATION FBD\nNETWORK\n  ${statement}\nEND_NETWORK\nEND_FUNCTION_BLOCK\n`
  const messages = (src: string) => vgDiags(src).map((d) => d.message)
  expect(messages(caller("y := F_add(v);"))).toEqual(["Function 'F_add' requires exactly '2' inputs"])
  expect(messages(caller("y := F_inc(v, i := w);"))).toEqual(["Function 'F_inc' requires exactly '1' inputs"])
  expect(messages(caller("y := F_add(v, w);"))).toEqual([])
  expect(messages(caller("y := fbm.M_twice(v);"))).toEqual(["Function 'M_twice' requires exactly '1' inputs"])
  expect(messagesFor("twincat").methodBoxPositionalPins("M_twice", 1)).toBe("'' is no input of 'M_TWICE'")
  expect(messages(caller("y := fbm.M_twice(k := v);"))).toEqual([])
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

// function-argument-count — a FUNCTION's box given more positional values than it declares inputs (ld-fbd-coverage 2R.4,
// `ng_m_function_too_many`): the push derives no name for the extra one, and CODESYS's build says
// "Function 'F_NG_m_inc' requires exactly '1' inputs" — the ST check's message.
const F_INC = `FUNCTION F_inc : INT
VAR_INPUT i : INT; END_VAR
F_inc := i + 1;
END_FUNCTION
`
test("network text: a function box given more positional values than it declares inputs is the arity error", () => {
  const src = `${F_INC}FUNCTION_BLOCK F
VAR v : INT; w : INT; y : INT; END_VAR
IMPLEMENTATION FBD
NETWORK
  y := F_inc(v, w);
END_NETWORK
END_FUNCTION_BLOCK`
  const found = vgDiags(src).filter((d) => d.code === "function-argument-count")
  expect(found.map((d) => d.message)).toEqual(["Function 'F_inc' requires exactly '1' inputs"])
  expect(vgByCode(src.replace("F_inc(v, w)", "F_inc(v)"), "function-argument-count")).toBe(0)
})
