/**
 * inheritance — C0091 (self-cycle), C0090 (unknown base class) with C0077 (the type it therefore lacks), C0086 (unknown interface).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const codes = (src: string, vendor: "codesys" | "twincat" = "codesys"): { code: string; message: string }[] => {
  const pr = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], vendor)
  return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor }) }).map(
    (d) => ({ code: d.code, message: d.message }),
  )
}
const msgs = (src: string, code: string) => codes(src).filter((d) => d.code === code).map((d) => d.message)
/** The base-not-found pair, each sentence with its own code: "No definition found for base class" is C0090's
 *  (`base-class-not-found`), "Unknown type" C0077's (`unknown-type`) — one wire code for both named the wrong rule. */
const baseMsgs = (src: string, vendor: "codesys" | "twincat" = "codesys") =>
  codes(src, vendor).filter((d) => d.code === "base-class-not-found" || d.code === "unknown-type").map((d) => `${d.code}: ${d.message}`)
const NOT_FOUND = (name: string) => `base-class-not-found: No definition found for base class '${name}'`
const UNKNOWN = (name: string) => `unknown-type: Unknown type: '${name}'`

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
  expect(baseMsgs(src, "codesys")).toEqual([NOT_FOUND("UnknownBase"), UNKNOWN("UnknownBase")])
  expect(baseMsgs(src, "twincat")).toEqual([NOT_FOUND("UnknownBase")])
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
  expect(baseMsgs(`FUNCTION_BLOCK FB EXTENDS UnknownBase\nEND_FUNCTION_BLOCK`)).toEqual([NOT_FOUND("UnknownBase"), UNKNOWN("UnknownBase")])
  expect(baseMsgs(`FUNCTION_BLOCK FB EXTENDS B\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK B\nEND_FUNCTION_BLOCK`)).toEqual([])
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
      [{ uri: "file:///w/F.pou", parseResult: pr, source: src }, { uri: `${lib}/TON.pou`, parseResult: parseSource(ton, { networkText: true }), source: ton }],
      [manifest],
    )
    return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "base-class-not-found" || d.code === "unknown-type")
      .map((d) => `${d.code}: ${d.message}`)
  }
  expect(run("FUNCTION_BLOCK FB EXTENDS Standard.TON\nPT := T#5MS;\nEND_FUNCTION_BLOCK\n")).toEqual([])
  expect(run("FUNCTION_BLOCK FB EXTENDS NoSuchLib.FB_X\nEND_FUNCTION_BLOCK\n")).toEqual([NOT_FOUND("NoSuchLib.FB_X"), UNKNOWN("NoSuchLib.FB_X")])
})

test("a base whose header is refused is not found — it is no FB, as it is no type", () => {
  // the refused FB declares nothing (`headerRefused`): its name is "Unknown type" where it is used, and the same name
  // as a base is the base-class-not-found pair — and the derived body does not reach its members
  const src = `FUNCTION_BLOCK FINAL PUBLIC FB_A\nVAR\n  n : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_D EXTENDS FB_A\nVAR\n  out : INT;\nEND_VAR\nout := n;\nEND_FUNCTION_BLOCK`
  expect(baseMsgs(src)).toEqual([NOT_FOUND("FB_A"), UNKNOWN("FB_A")])
})

// ── rule H9: every kind that extends closes a cycle, all worded as FBs' (`inh_*_cycle`, both vendors 2026-10-02)
test("H9: an INTERFACE cycle and a STRUCT cycle are recursion in the base list, reported once", () => {
  expect(
    msgs(`INTERFACE I_A EXTENDS I_B\nEND_INTERFACE\n\nINTERFACE I_B EXTENDS I_A\nEND_INTERFACE`, "circular-inheritance"),
  ).toEqual(["Recursion in base function block list: I_A -> I_B -> I_A"])
  expect(
    msgs(`TYPE S_A EXTENDS S_B :\nSTRUCT\n a : INT;\nEND_STRUCT\nEND_TYPE\n\nTYPE S_B EXTENDS S_A :\nSTRUCT\n b : INT;\nEND_STRUCT\nEND_TYPE`, "circular-inheritance"),
  ).toEqual(["Recursion in base function block list: S_A -> S_B -> S_A"])
})
test("H9: a three-FB ring is one path (`inh_extends_cycle`), and a qualified base of the FB's own name is no cycle", () => {
  expect(
    msgs(`FUNCTION_BLOCK A EXTENDS B\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK B EXTENDS C\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK C EXTENDS A\nEND_FUNCTION_BLOCK`, "circular-inheritance"),
  ).toEqual(["Recursion in base function block list: A -> B -> C -> A"])
  expect(msgs(`FUNCTION_BLOCK TON EXTENDS Standard.TON\nEND_FUNCTION_BLOCK`, "circular-inheritance")).toEqual([])
})

// ── rules H4/H7: an interface base nothing declares, as an FB's (`inh_interface_extends_unknown`, both vendors 2026-10-02)
test("H4: an INTERFACE EXTENDS a name nothing declares — CODESYS twice, TwinCAT once", () => {
  const src = `INTERFACE I_D EXTENDS I_Missing\nEND_INTERFACE`
  expect(baseMsgs(src, "codesys")).toEqual([NOT_FOUND("I_Missing"), UNKNOWN("I_Missing")])
  expect(baseMsgs(src, "twincat")).toEqual([NOT_FOUND("I_Missing")])
  expect(baseMsgs(`INTERFACE I_B\nEND_INTERFACE\n\nINTERFACE I_D EXTENDS I_B\nEND_INTERFACE`)).toEqual([])
})

// analysis-conformance 3.6 (both vendors, recorded 2026-10-06, `oopa_*`): a base that EXISTS but is no function block —
// an INTERFACE, a STRUCT — is "No definition found for base class", and only that (no "Unknown type" on CODESYS); a
// STRUCT named in IMPLEMENTS is "No definition found for interface", as an FB is
test("EXTENDS an interface or a struct is no base class found; IMPLEMENTS a struct no interface", () => {
  const itf = "INTERFACE I_X\nEND_INTERFACE\nFUNCTION_BLOCK FB EXTENDS I_X\nVAR\n n : INT;\nEND_VAR\nEND_FUNCTION_BLOCK"
  const st = "TYPE S_X :\nSTRUCT\n x : INT;\nEND_STRUCT\nEND_TYPE\nFUNCTION_BLOCK FB EXTENDS S_X\nVAR\n n : INT;\nEND_VAR\nEND_FUNCTION_BLOCK"
  for (const vendor of ["codesys", "twincat"] as const) {
    expect(baseMsgs(itf, vendor)).toEqual([NOT_FOUND("I_X")])
    expect(baseMsgs(st, vendor)).toEqual([NOT_FOUND("S_X")])
  }
  const impl = "TYPE S_Y :\nSTRUCT\n x : INT;\nEND_STRUCT\nEND_TYPE\nFUNCTION_BLOCK FB IMPLEMENTS S_Y\nVAR\n n : INT;\nEND_VAR\nEND_FUNCTION_BLOCK"
  expect(msgs(impl, "interface-not-found")).toEqual(["No definition found for interface 'S_Y'"])
})

// gate review (3.4+3.6): only an INTERFACE and a STRUCT base were measured — an ALIAS (even of an FB), a FUNCTION and a
// PROGRAM in EXTENDS were not asked, so the existing-but-no-FB message is not given for them
test("EXTENDS an ALIAS, a FUNCTION or a PROGRAM: no 'No definition found for base class' (unmeasured)", () => {
  const fbx = `FUNCTION_BLOCK FB_X\nEND_FUNCTION_BLOCK\n`
  expect(msgs(`${fbx}TYPE T : FB_X;\nEND_TYPE\nFUNCTION_BLOCK FB_A EXTENDS T\nEND_FUNCTION_BLOCK`, "base-class-not-found")).toEqual([])
  expect(msgs(`FUNCTION F : INT\nF := 1;\nEND_FUNCTION\nFUNCTION_BLOCK FB_A EXTENDS F\nEND_FUNCTION_BLOCK`, "base-class-not-found")).toEqual([])
  expect(msgs(`PROGRAM PR\nEND_PROGRAM\nFUNCTION_BLOCK FB_A EXTENDS PR\nEND_FUNCTION_BLOCK`, "base-class-not-found")).toEqual([])
})
