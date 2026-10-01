/**
 * inheritance — C0091 (self-cycle), C0090 (unknown base class), C0086 (unknown interface).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const codes = (src: string, vendor: "codesys" | "twincat" = "codesys"): { code: string; message: string }[] => {
  const pr = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], vendor)
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor }) }).map(
    (d) => ({ code: d.code, message: d.message }),
  )
}
const msgs = (src: string, code: string) => codes(src).filter((d) => d.code === code).map((d) => d.message)

test("C0091: an FB extending itself is flagged (cycle, not not-found)", () => {
  expect(msgs(`FUNCTION_BLOCK FB EXTENDS FB\nEND_FUNCTION_BLOCK`, "circular-inheritance")).toEqual([
    "Recursion in base function block list: FB -> FB",
  ])
  expect(codes(`FUNCTION_BLOCK FB EXTENDS FB\nEND_FUNCTION_BLOCK`).some((d) => d.code === "base-class-not-found")).toBe(false)
})

// The chain is the one thing the vendors word differently: TwinCAT upper-cases every name in it, CODESYS
// echoes them as declared (`cc2_circular_inheritance`, both recordings 2026-09-20).
// TwinCAT says the base is not found and stops; CODESYS goes on to say the FB therefore has no type
// (`cc2_base_and_interface_not_found`, both recordings 2026-09-20).
test("C0090: the second message is CODESYS's alone", () => {
  const src = `FUNCTION_BLOCK FB EXTENDS UnknownBase\nEND_FUNCTION_BLOCK`
  const of = (v: "codesys" | "twincat") => codes(src, v).filter((d) => d.code === "base-class-not-found").map((d) => d.message)
  expect(of("codesys")).toEqual([
    "No definition found for base class 'UnknownBase'",
    "Unknown type: 'UnknownBase'",
  ])
  expect(of("twincat")).toEqual(["No definition found for base class 'UnknownBase'"])
})
test("C0091: TwinCAT upper-cases the names in the chain", () => {
  const src = `FUNCTION_BLOCK FB_circleA EXTENDS FB_circleA\nEND_FUNCTION_BLOCK`
  const of = (v: "codesys" | "twincat") => codes(src, v).filter((d) => d.code === "circular-inheritance").map((d) => d.message)
  expect(of("codesys")).toEqual(["Recursion in base function block list: FB_circleA -> FB_circleA"])
  expect(of("twincat")).toEqual(["Recursion in base function block list: FB_CIRCLEA -> FB_CIRCLEA"])
})
test("C0090: an EXTENDS base that resolves nowhere is flagged TWICE; a resolved base is not", () => {
  // the definition it could not find, and the TYPE the FB therefore does not have — an unresolved INTERFACE gets
  // only the first (conformance `cc2_base_and_interface_not_found`)
  expect(msgs(`FUNCTION_BLOCK FB EXTENDS UnknownBase\nEND_FUNCTION_BLOCK`, "base-class-not-found")).toEqual([
    "No definition found for base class 'UnknownBase'",
    "Unknown type: 'UnknownBase'",
  ])
  expect(msgs(`FUNCTION_BLOCK FB EXTENDS B\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK B\nEND_FUNCTION_BLOCK`, "base-class-not-found")).toEqual([])
})

test("C0086: an IMPLEMENTS interface that resolves nowhere is flagged; a resolved one is not", () => {
  const src = `INTERFACE I\nEND_INTERFACE\nFUNCTION_BLOCK FB IMPLEMENTS I, IMissing\nEND_FUNCTION_BLOCK`
  expect(msgs(src, "interface-not-found")).toEqual(["No definition found for interface 'IMissing'"])
})

test("a qualified library base the symbol table linked is found (`EXTENDS Standard.TON`); one no library holds is not", () => {
  // `unit_fb_extends_qualified` builds on CODESYS; `unit_fb_extends_qualified_unknown` is both messages, the base as written
  const ton = "FUNCTION_BLOCK TON\nVAR_INPUT\n  PT : TIME;\nEND_VAR\nEND_FUNCTION_BLOCK\n"
  const lib = "file:///w/Library Manager/Standard"
  const manifest = { uri: `${lib}/Standard.library`, folder: "standard", namespace: "Standard", library: "Standard", dependencies: [], materialization: 2 }
  const run = (src: string) => {
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable(
      [{ uri: "file:///w/F.fb", parseResult: pr, source: src }, { uri: `${lib}/TON.fb`, parseResult: parseSource(ton, { networkText: true }), source: ton }],
      [manifest],
    )
    return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "base-class-not-found")
      .map((d) => d.message)
  }
  expect(run("FUNCTION_BLOCK FB EXTENDS Standard.TON\nPT := T#5MS;\nEND_FUNCTION_BLOCK\n")).toEqual([])
  expect(run("FUNCTION_BLOCK FB EXTENDS NoSuchLib.FB_X\nEND_FUNCTION_BLOCK\n")).toEqual([
    "No definition found for base class 'NoSuchLib.FB_X'",
    "Unknown type: 'NoSuchLib.FB_X'",
  ])
})

test("a base whose header is refused is not found — it is no FB, as it is no type", () => {
  // the refused FB declares nothing (`headerRefused`): its name is "Unknown type" where it is used, and the same name
  // as a base is the base-class-not-found pair — and the derived body does not reach its members
  const src = `FUNCTION_BLOCK FINAL PUBLIC FB_A\nVAR\n  n : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_D EXTENDS FB_A\nVAR\n  out : INT;\nEND_VAR\nout := n;\nEND_FUNCTION_BLOCK`
  expect(msgs(src, "base-class-not-found")).toEqual([
    "No definition found for base class 'FB_A'",
    "Unknown type: 'FB_A'",
  ])
})
