/**
 * constancyOf — the constant / variable / unknown classifier that "must be a constant" checks (C0218 CASE
 * labels, C0162 repeat counts) flag on. The load-bearing distinction: an enum member and a `VAR CONSTANT`
 * are `constant` (not flagged); only a genuine mutable variable is `variable`; unresolved / library → `unknown`.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { buildSymbolTable, bodies } from "../symbols/index.js"
import { constancyOf } from "./index.js"

/** Classify the value of the single `n := <value>;` assignment in F's body. */
function classify(decls: string, value: string): string {
  const src = `FUNCTION_BLOCK F\nVAR\n${decls}\n  n : INT;\nEND_VAR\nn := ${value};\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  for (const { scope, statements } of bodies(pr.units, project)) {
    const s = statements[0]
    if (s?.kind === "assign") return constancyOf(s.value, scope)
  }
  throw new Error("no assignment parsed")
}

test("literals and constant expressions are constant", () => {
  expect(classify(``, `5`)).toBe("constant")
  expect(classify(``, `2 + 3`)).toBe("constant")
  expect(classify(``, `-7`)).toBe("constant")
})

test("a plain variable is variable", () => {
  expect(classify(`  v : INT;`, `v`)).toBe("variable")
})

test("a plain variable is variable; a VAR CONSTANT is constant", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n  v : INT;\nEND_VAR\nVAR CONSTANT\n  K : INT := 7;\nEND_VAR\nv := K;\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  for (const { scope, statements } of bodies(pr.units, project)) {
    const s = statements[0]
    if (s?.kind === "assign") {
      expect(constancyOf(s.target, scope)).toBe("variable") // v
      expect(constancyOf(s.value, scope)).toBe("constant") // K (VAR CONSTANT)
    }
  }
})

test("a constant from a library file resolves as non-variable under a live `%20` URI (not flagged)", () => {
  // The live server keys library files by `file://` URI with `Library%20Manager` (encoded space). A raw
  // `.includes("Library Manager")` missed it, so a library global used as e.g. an array bound false-positived
  // as `variable`. constancyOf must NOT return "variable" for a library symbol regardless of URI encoding.
  const libUri = "file:///App/Library%20Manager/CANopen/GC.gvl"
  const libSrc = `VAR_GLOBAL\n  GC_MAX : USINT := 9;\nEND_VAR`
  const useSrc = `FUNCTION_BLOCK F\nVAR\n  n : INT;\nEND_VAR\nn := GC_MAX;\nEND_FUNCTION_BLOCK`
  const libPr = parseSource(libSrc)
  const usePr = parseSource(useSrc)
  const project = buildSymbolTable([
    { uri: libUri, parseResult: libPr, source: libSrc },
    { uri: "file:///F.fb", parseResult: usePr, source: useSrc },
  ])
  for (const { scope, statements } of bodies(usePr.units, project)) {
    const s = statements[0]
    if (s?.kind === "assign") expect(constancyOf(s.value, scope)).not.toBe("variable") // GC_MAX — library symbol
  }
})

test("an enum member is constant (inline enum), an unresolved name is unknown", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n  st : (A, B, C);\n  n : INT;\nEND_VAR\nCASE st OF\n  A: n := Missing;\nEND_CASE\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F", parseResult: pr, source: src }])
  for (const { scope, statements } of bodies(pr.units, project)) {
    for (const s of statements) {
      if (s.kind !== "case") continue
      const label = s.arms[0].labels[0].value
      expect(constancyOf(label, scope)).toBe("constant") // A — enum member
      const rhs = s.arms[0].body[0]
      if (rhs?.kind === "assign") expect(constancyOf(rhs.value, scope)).toBe("unknown") // Missing — unresolved
    }
  }
})
