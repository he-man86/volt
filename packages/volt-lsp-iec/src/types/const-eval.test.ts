/**
 * constEval — folding a CONSTANT named through its global variable list or its PROGRAM (`GVL_Constants.N`,
 * `XiUnits.MaxVacuums`), as pro2193 sizes arrays. Neither folded: every such array had no size, every such initializer
 * no value (transpiler corpus: `init-not-constant`, "an index on something that is not a sized array").
 */
import { expect, test } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { bodies, buildSymbolTable } from "../symbols/index.js"
import { constEval } from "./index.js"

const LISTS = [
  { uri: "file:///p/GVL_Constants.gvl", source: "{attribute 'qualified_only'}\nVAR_GLOBAL CONSTANT\n  Count : INT := 12;\nEND_VAR\nVAR_GLOBAL\n  plain : INT := 3;\nEND_VAR\n" },
  { uri: "file:///p/XiUnits.prg", source: "PROGRAM XiUnits\nVAR\n  runs : INT := 4;\nEND_VAR\nVAR CONSTANT\n  MaxVacuums : USINT := GVL_Constants.Count - 2;\nEND_VAR\nEND_PROGRAM\n" },
]

/** The value of `n := <value>;` in an FB beside `files`. */
function folded(value: string, files: readonly { uri: string; source: string }[] = LISTS): unknown {
  const all = [...files, { uri: "file:///p/F.fb", source: `FUNCTION_BLOCK F\nVAR\n  n : INT;\nEND_VAR\nn := ${value};\nEND_FUNCTION_BLOCK\n` }].map((f) => ({ ...f, parseResult: parseSource(f.source) }))
  const project = buildSymbolTable(all)
  for (const { scope, statements } of bodies(all.at(-1)!.parseResult.units, project)) {
    const s = statements[0]
    if (s?.kind === "assign") return constEval(s.value, scope)
  }
  throw new Error("no assignment parsed")
}

test("a constant named through its GVL or its PROGRAM folds — its own initializer, in its own scope", () => {
  expect(folded("GVL_Constants.Count")).toBe(12n)
  // a PROGRAM's VAR CONSTANT whose own initializer is qualified in turn
  expect(folded("XiUnits.MaxVacuums * 2")).toBe(20n)
})

test("a variable named through its GVL or its PROGRAM does not fold", () => {
  expect(folded("GVL_Constants.plain")).toBeUndefined()
  expect(folded("XiUnits.runs")).toBeUndefined()
})

// Review of the batch (adversarial verify), each reproduced before its fix. Why missed: every test constant was an
// integer, acyclic, and alone of its name.
test("a cycle does not fold — it recursed forever, freezing the editor's diagnostics", () => {
  expect(folded("P.N", [{ uri: "file:///p/P.prg", source: "PROGRAM P\nVAR CONSTANT\n  N : INT := P.N;\nEND_VAR\nEND_PROGRAM\n" }])).toBeUndefined()
  const lists = [
    { uri: "file:///p/GA.gvl", source: "VAR_GLOBAL CONSTANT\n  X : INT := GB.Y;\nEND_VAR\n" },
    { uri: "file:///p/GB.gvl", source: "VAR_GLOBAL CONSTANT\n  Y : INT := GA.X;\nEND_VAR\n" },
  ]
  expect(folded("GA.X", lists)).toBeUndefined()
  // the bare cycle hung before qualified names folded at all
  expect(folded("X", [{ uri: "file:///p/C.gvl", source: "VAR_GLOBAL CONSTANT\n  X : INT := Y;\n  Y : INT := X;\nEND_VAR\n" }])).toBeUndefined()
})

test("a REAL constant written as an integer is a REAL — `RC / 4` is 2.5, not 2", () => {
  const real = [{ uri: "file:///p/G.gvl", source: "VAR_GLOBAL CONSTANT\n  RC : REAL := 10;\nEND_VAR\n" }, { uri: "file:///p/P.prg", source: "PROGRAM P\nVAR CONSTANT\n  RP : LREAL := 10;\nEND_VAR\nEND_PROGRAM\n" }]
  expect(folded("G.RC / 4", real)).toBe(2.5)
  expect(folded("P.RP / 4", real)).toBe(2.5)
  expect(folded("RC / 4", real)).toBe(2.5)
})

test("inside a list's own initializer a bare name is its sibling first — not another list's constant of that name", () => {
  const lists = [
    { uri: "file:///p/GQ.gvl", source: "{attribute 'qualified_only'}\nVAR_GLOBAL CONSTANT\n  A : INT := 5;\n  B : INT := A * 2;\nEND_VAR\n" },
    { uri: "file:///p/GP.gvl", source: "VAR_GLOBAL CONSTANT\n  A : INT := 100;\nEND_VAR\n" },
  ]
  expect(folded("GQ.B", lists)).toBe(10n)
})
