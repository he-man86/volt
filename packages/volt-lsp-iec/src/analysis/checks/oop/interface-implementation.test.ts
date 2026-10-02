/**
 * missing-interface-implementation — every path of the presence check + its conservative skips. The check
 * had only corpus coverage before; these pin the intent (esp. the abstract-chain skip added for pro2193's
 * Conveyor_SingleFB, where CODESYS `/build` accepted an interface method neither the FB nor its abstract
 * base chain provides).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

/** missing-interface-implementation messages for one source (codesys) — with `instanced`, every FB of it INSTANCED by
 *  a program, as the vendor checks only an FB it compiles (`analysis/compiled.ts`). */
const missing = (src0: string, instanced = true): string[] => {
  const fbs = [...src0.matchAll(/^FUNCTION_BLOCK (?:ABSTRACT )?(\w+)/gm)].map((m) => m[1])
  const vars = instanced ? fbs.map((n, i) => `\tinst${i} : ${n};`).join("\n") : ""
  const src = `${src0}\n\nPROGRAM P\nVAR\n${vars}\nEND_VAR\nEND_PROGRAM`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "missing-interface-implementation")
    .map((d) => d.message)
}

const IGO = `INTERFACE IGo\nMETHOD Go : BOOL\nEND_METHOD\nEND_INTERFACE\n`

test("a concrete FB missing an interface method is flagged (byte-identical wording)", () => {
  expect(missing(`${IGO}FUNCTION_BLOCK F IMPLEMENTS IGo\nEND_FUNCTION_BLOCK`)).toEqual([
    "There is no implementation for method 'GO' defined in interface 'IGO'",
  ])
})

test("a concrete FB that provides the method is not flagged", () => {
  expect(missing(`${IGO}FUNCTION_BLOCK F IMPLEMENTS IGo\nEND_FUNCTION_BLOCK\nMETHOD Go : BOOL\nGo := TRUE;\nEND_METHOD`)).toEqual([])
})

test("a method inherited from a concrete EXTENDS base is credited (not flagged)", () => {
  const src = `${IGO}FUNCTION_BLOCK Base\nEND_FUNCTION_BLOCK\nMETHOD Go : BOOL\nGo := TRUE;\nEND_METHOD\nFUNCTION_BLOCK F EXTENDS Base IMPLEMENTS IGo\nEND_FUNCTION_BLOCK`
  expect(missing(src)).toEqual([])
})

// The abstract-chain skip (pro2193): CODESYS defers interface obligations through abstract hierarchies.
test("an FB extending an ABSTRACT base is not flagged even if the method is unprovided", () => {
  const src = `${IGO}FUNCTION_BLOCK ABSTRACT Base\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK F EXTENDS Base IMPLEMENTS IGo\nEND_FUNCTION_BLOCK`
  expect(missing(src)).toEqual([])
})

test("an ABSTRACT FB itself is not flagged (may leave interface members abstract)", () => {
  expect(missing(`${IGO}FUNCTION_BLOCK ABSTRACT F IMPLEMENTS IGo\nEND_FUNCTION_BLOCK`)).toEqual([])
})

test("an unresolvable (library) base is not flagged — it could provide the member", () => {
  expect(missing(`${IGO}FUNCTION_BLOCK F EXTENDS SomeLibraryFB IMPLEMENTS IGo\nEND_FUNCTION_BLOCK`)).toEqual([])
})

// ── rule H4: the obligation includes what the implemented interface INHERITS, named by the interface that declares it
test("H4: an FB implementing a derived interface owes the base interface's method (`inh_implements_derived_missing_base_method`)", () => {
  const src =
    `INTERFACE I_B\nMETHOD Mb : INT\nEND_METHOD\nEND_INTERFACE\n\nINTERFACE I_D EXTENDS I_B\nMETHOD Md : INT\nEND_METHOD\nEND_INTERFACE\n\n` +
    `FUNCTION_BLOCK F IMPLEMENTS I_D\nEND_FUNCTION_BLOCK\n\nMETHOD Md : INT\nEND_METHOD`
  expect(missing(src)).toEqual(["There is no implementation for method 'MB' defined in interface 'I_B'"])
})
test("H4: an FB NOTHING instances owes nothing — the vendor compiles it not (`inh_implements_derived_missing_base_method_uninstanced`)", () => {
  const src =
    `INTERFACE I_B\nMETHOD Mb : INT\nEND_METHOD\nEND_INTERFACE\n\nINTERFACE I_D EXTENDS I_B\nMETHOD Md : INT\nEND_METHOD\nEND_INTERFACE\n\n` +
    `FUNCTION_BLOCK F IMPLEMENTS I_D\nEND_FUNCTION_BLOCK\n\nMETHOD Md : INT\nEND_METHOD`
  expect(missing(src, false)).toEqual([])
  expect(missing(`${IGO}FUNCTION_BLOCK F IMPLEMENTS IGo\nEND_FUNCTION_BLOCK`, false)).toEqual([])
})
test("H4: a base interface nothing declares is unprovable — no obligation is guessed", () => {
  const src = `INTERFACE I_D EXTENDS I_Missing\nMETHOD Md : INT\nEND_METHOD\nEND_INTERFACE\n\nFUNCTION_BLOCK F IMPLEMENTS I_D\nEND_FUNCTION_BLOCK\n\nMETHOD Md : INT\nEND_METHOD`
  expect(missing(src)).toEqual([])
})
