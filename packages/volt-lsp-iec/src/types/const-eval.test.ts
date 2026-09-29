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

// transpile-review-2026-09-29 task 2 (conformance `named_const_literal_wrap`, `named_const_expression_keeps`, LIVE):
// a constant initialised from a LITERAL holds it at its declared width, as its slot does — but one initialised from a
// constant EXPRESSION keeps the unwrapped value, even read back from the constant itself.
test("a named constant from a literal folds to what its type holds; from an expression, unwrapped", () => {
  const list = [
    { uri: "file:///p/G.gvl", source: "VAR_GLOBAL CONSTANT\n  C : INT := 40000;\n  Q : SINT := 200;\n  K : SINT := 127;\n  D : SINT := K + 1;\n  U : USINT := 255;\n  E : USINT := U + 3;\nEND_VAR\n" },
  ]
  expect(folded("C", list)).toBe(-25536n)
  expect(folded("Q", list)).toBe(-56n)
  expect(folded("D", list)).toBe(128n)
  expect(folded("E", list)).toBe(258n)
})

// transpile-review-2026-09-29 task 3 (conformance `real_constant_fold_width`, LIVE): a fold over REAL computes wide and
// rounds ONCE, to float32, at the end — the value its runtime twin reads. An LREAL constant from a REAL one is the literal.
test("an expression over REAL folds wide and rounds once to float32; an LREAL constant keeps the literal", () => {
  const list = [
    { uri: "file:///p/G.gvl", source: "VAR_GLOBAL CONSTANT\n  C01 : REAL := 0.1;\n  CBig : REAL := 16777216;\n  C1 : REAL := 1;\n  C3 : REAL := 3;\n  DChain : LREAL := C01;\nEND_VAR\n" },
  ]
  expect(folded("C01", list)).toBe(0.10000000149011612)
  expect(folded("CBig + 1", list)).toBe(16777216)
  expect(folded("C1 / C3", list)).toBe(0.3333333432674408)
  expect(folded("REAL#0.1 * 1", list)).toBe(0.10000000149011612)
  expect(folded("(CBig + 1) - CBig", list)).toBe(1)
  expect(folded("DChain", list)).toBe(0.1)
  expect(folded("LREAL#0.1 * 1", list)).toBe(0.1)
  expect(folded("0.1", list)).toBe(0.1)
})

// transpile-review-2026-09-29 task 4 (conformance `var_input_constant_default_as_step`, LIVE: F(n := 3) steps by 3): a
// VAR_INPUT CONSTANT is a PARAMETER holding the caller's argument, so its default is not a compile-time constant.
test("a VAR_INPUT CONSTANT parameter does not fold to its default; a VAR CONSTANT beside it does", () => {
  const source = "FUNCTION F : INT\nVAR_INPUT CONSTANT\n  n : INT := 1;\nEND_VAR\nVAR CONSTANT\n  K : INT := 2;\nEND_VAR\nF := n;\nF := K;\nEND_FUNCTION\n"
  const all = [{ uri: "file:///p/F.fun", source, parseResult: parseSource(source) }]
  const project = buildSymbolTable(all)
  const [{ scope, statements }] = [...bodies(all[0]!.parseResult.units, project)]
  const values = statements.map((s) => (s.kind === "assign" ? constEval(s.value, scope) : null))
  expect(values).toEqual([undefined, 2n])
})
