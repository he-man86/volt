/**
 * constant-cycle (rule CE5): a CONSTANT defined through itself is refused once per constant of the cycle — CODESYS
 * "Recursive definition of constant value" (`ce_cycle` twice, `ce_cycle_self` once, 2026-10-03). It was silent: the fold
 * stopped at the cycle and said nothing.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

function cycleMessages(src: string): string[] {
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys")
  return computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "constant-cycle")
    .map((d) => d.message)
}

const fb = (constants: string): string => `FUNCTION_BLOCK F\nVAR CONSTANT\n${constants}\nEND_VAR\nEND_FUNCTION_BLOCK\n`

test("each constant of a cycle is refused; one naming the cycle, and one beside it, are not", () => {
  expect(cycleMessages(fb("\tcs : INT := cs + 1;"))).toEqual(["Recursive definition of constant value"])
  expect(cycleMessages(fb("\tca : INT := cb + 1;\n\tcb : INT := ca + 1;\n\tcx : INT := ca;\n\tok : INT := 3;"))).toEqual([
    "Recursive definition of constant value",
    "Recursive definition of constant value",
  ])
})

// Step 4d review: SIZEOF folded through its operand's type, whose bound folds the SIZEOF again — the walk overflowed the
// stack and the file got no diagnostics at all. It must answer, and say nothing it has no recording for.
test("a SIZEOF reaching its own size through a bound does not crash the diagnostics", () => {
  const src = "FUNCTION_BLOCK F\nVAR CONSTANT\n\tc : DINT := SIZEOF(arr);\nEND_VAR\nVAR\n\tarr : ARRAY[0..c] OF INT;\n\ta : ARRAY[0..SIZEOF(a)] OF INT;\n\tx : INT (0..SIZEOF(x));\n\tq : STRING(SIZEOF(q));\nEND_VAR\nEND_FUNCTION_BLOCK\n"
  expect(() => cycleMessages(src)).not.toThrow()
})

// Step 4d review: a cycle through an enum member's written value was not seen — the enum's fold dropped the walk's start.
test("a cycle through an enum member's value is refused at the constant", () => {
  const src = "TYPE E :\n(\n\tA := c\n);\nEND_TYPE\n\nVAR_GLOBAL CONSTANT\n\tc : INT := E.A;\nEND_VAR\n"
  expect(cycleMessages(src)).toEqual(["Recursive definition of constant value"])
})

// Step 4d review: TwinCAT has no recorded answer to a recursive constant (its XAE exits building one), so it is said on
// CODESYS only — an unmeasured sentence on TwinCAT is an LSP-only message.
test("a recursive constant is refused on CODESYS only — TwinCAT has no recorded answer", () => {
  const src = fb("\tcs : INT := cs + 1;")
  const parseResult = parseSource(src, { networkText: true }, "twincat")
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "twincat")
  const tc = computeSemanticDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "twincat" }) }).filter((d) => d.code === "constant-cycle")
  expect(tc).toEqual([])
})

/** Every error a file of several declarations gets on CODESYS — the file split as the project holds it. */
function errorsOf(files: readonly { uri: string; source: string }[]): string[] {
  const all = files.map((f) => ({ ...f, parseResult: parseSource(f.source, { networkText: true }) }))
  const project = build.buildSymbolTable(all, [], "codesys")
  return all.flatMap((f) =>
    computeSemanticDiagnostics({ uri: uriFor(f.parseResult), parseResult: f.parseResult, source: f.source, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code}: ${d.message}`),
  )
}

// Step 4d review 2: a constant's declared type that is an ALIAS whose bound names the constant resolved the alias, which
// folded the bound, which folded the constant again — the stack overflowed and the file got no diagnostics at all.
test("a constant typed by an alias whose bound names the constant does not crash the diagnostics", () => {
  const cases = [
    ["TYPE A : INT(0..c);\nEND_TYPE\n", "VAR_GLOBAL CONSTANT\n\tc : A := 5;\nEND_VAR\n"],
    ["TYPE S : STRING(c);\nEND_TYPE\n", "VAR_GLOBAL CONSTANT\n\tc : S := 'x';\nEND_VAR\n"],
    ["TYPE A : INT(0..GVL.c);\nEND_TYPE\n", "VAR_GLOBAL CONSTANT\n\tc : A := 5;\nEND_VAR\n"],
    ["TYPE A : INT(0..d);\nEND_TYPE\n", "VAR_GLOBAL CONSTANT\n\tc : A := 5;\n\td : INT := c;\nEND_VAR\n"],
  ]
  for (const [type, gvl] of cases)
    expect(() => errorsOf([{ uri: "file:///p/A.dut", source: type! }, { uri: "file:///p/GVL.gvl", source: gvl! }])).not.toThrow()
})

// Step 4d review 2: the cycle watch entered every member of the enum, so a constant naming a member whose own value does
// not reach it was refused because a SIBLING's did — an LSP-only sentence. A member's value is its own written value, or
// the nearest written one before it plus the distance; nothing after it, nothing beside it.
test("a constant naming an enum member is not recursive because a sibling member names it", () => {
  const src = "TYPE E :\n(\n\tA := 1,\n\tB := k\n);\nEND_TYPE\n\nVAR_GLOBAL CONSTANT\n\tk : INT := E.A;\nEND_VAR\n"
  expect(cycleMessages(src)).toEqual([])
})

// Step 4d review 2: `x : INT (0..SIZEOF(x))` typed x as INT(0..2) — a range CODESYS never computed — and refused a store of 5
// with it. A size that reaches itself has no value, at the outer SIZEOF too, so the bound is unknown and nothing is said.
test("a subrange sized by its own variable states no range", () => {
  const files = [
    { uri: "file:///p/GVL.gvl", source: "VAR_GLOBAL\n\tx : INT (0..SIZEOF(x));\nEND_VAR\n" },
    { uri: "file:///p/F.pou", source: "FUNCTION_BLOCK F\nx := 5;\nEND_FUNCTION_BLOCK\n" },
  ]
  expect(errorsOf(files).filter((e) => e.startsWith("subrange-out-of-range"))).toEqual([])
})
