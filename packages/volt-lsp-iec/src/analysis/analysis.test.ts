import { test, expect } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { buildSymbolTable } from "../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type DiagnosticItem, type Vendor } from "./index.js"

function diag(src: string, vendor: Vendor): DiagnosticItem[] {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
}

const codes = (src: string, v: Vendor): string[] =>
  diag(src, v)
    .map((d) => d.code)
    .sort()

test("clean code produces no diagnostics (no false positives)", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n a : INT; b : INT;\nEND_VAR\na := b + 1;\nEND_FUNCTION_BLOCK`
  expect(diag(src, "codesys")).toEqual([])
  expect(diag(src, "twincat")).toEqual([])
})

// The active IDE is used because CODESYS and TwinCAT diverge — same input, different wording.
test("vendor-keyed wording: narrowing LREAL→REAL", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n r : REAL; l : LREAL;\nEND_VAR\nr := l;\nEND_FUNCTION_BLOCK`
  expect(diag(src, "codesys")[0]?.message).toBe(
    "Implicit conversion from 'LREAL' to 'REAL': Possible loss of information",
  )
  expect(diag(src, "twincat")[0]?.message).toBe(
    "Implicit conversion from 'LREAL' to 'REAL': possible loss of information",
  )
})

test("vendor-keyed wording: MOD on REAL", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n a : REAL; b : REAL; c : REAL;\nEND_VAR\nc := a MOD b;\nEND_FUNCTION_BLOCK`
  expect(diag(src, "codesys").find((d) => d.code === "binary-op-type-mismatch")?.message).toBe(
    "MOD is not defined for REAL",
  )
  expect(diag(src, "twincat").find((d) => d.code === "binary-op-type-mismatch")?.message).toBe(
    "'MOD' is not defined for 'REAL'",
  )
})

test("vendor-keyed wording: ABSTRACT instantiation", () => {
  const src = `FUNCTION_BLOCK ABSTRACT FB_A\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK F\nVAR\n x : FB_A;\nEND_VAR\nEND_FUNCTION_BLOCK`
  expect(diag(src, "codesys").find((d) => d.code === "abstract-instantiation")?.message).toBe(
    "Function block FB_A is ABSTRACT and cannot be instantiated",
  )
  expect(diag(src, "twincat").find((d) => d.code === "abstract-instantiation")?.message).toBe(
    "Functionblock FB_A is ABSTRACT and cannot be instantiated",
  )
})

test("assignment type mismatch, duplicate declaration, external write fire with the right codes", () => {
  expect(
    codes(`FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK`, "codesys"),
  ).toContain("assignment-type-mismatch")
  expect(codes(`FUNCTION_BLOCK F\nVAR\n x : INT;\n x : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`, "codesys")).toContain(
    "duplicate-declaration",
  )
  const ext = `FUNCTION_BLOCK FB_A\nVAR\n secret : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nPROGRAM P\nVAR\n fb : FB_A;\nEND_VAR\nfb.secret := 1;\nEND_PROGRAM`
  expect(codes(ext, "codesys")).toContain("external-non-input-write")
})

test("constant overflow detection (message provisional pending bridge recording)", () => {
  // 40000 > INT max (32767) → overflow; a foldable const-ref that fits does NOT.
  expect(codes(`FUNCTION_BLOCK F\nVAR\n v : INT := 40000;\nEND_VAR\nEND_FUNCTION_BLOCK`, "codesys")).toContain(
    "constant-overflow",
  )
  expect(codes(`FUNCTION_BLOCK F\nVAR\n v : INT := -40000;\nEND_VAR\nEND_FUNCTION_BLOCK`, "codesys")).toContain(
    "constant-overflow",
  )
  expect(codes(`FUNCTION_BLOCK F\nVAR\n v : BYTE := 300;\nEND_VAR\nEND_FUNCTION_BLOCK`, "codesys")).toContain(
    "constant-overflow",
  )
  // In-range and const-ref folding within range → no overflow.
  expect(codes(`FUNCTION_BLOCK F\nVAR\n v : INT := 30000;\nEND_VAR\nEND_FUNCTION_BLOCK`, "codesys")).not.toContain(
    "constant-overflow",
  )
  expect(
    codes(
      `FUNCTION_BLOCK F\nVAR CONSTANT\n Base : INT := 100;\nEND_VAR\nVAR\n v : INT := Base * 2;\nEND_VAR\nEND_FUNCTION_BLOCK`,
      "codesys",
    ),
  ).not.toContain("constant-overflow")
})

test("subrange + array-bounds detection (const-eval; messages provisional)", () => {
  // subrange: INT(0..100) init out of range
  expect(codes(`FUNCTION_BLOCK F\nVAR\n x : INT(0..100) := 150;\nEND_VAR\nEND_FUNCTION_BLOCK`, "codesys")).toContain(
    "subrange-out-of-range",
  )
  expect(codes(`FUNCTION_BLOCK F\nVAR\n x : INT(0..100) := 50;\nEND_VAR\nEND_FUNCTION_BLOCK`, "codesys")).not.toContain(
    "subrange-out-of-range",
  )
  // array-bounds: constant index outside ARRAY[0..3]
  expect(
    codes(`FUNCTION_BLOCK F\nVAR\n a : ARRAY[0..3] OF INT;\nEND_VAR\na[5] := 1;\nEND_FUNCTION_BLOCK`, "codesys"),
  ).toContain("array-index-out-of-bounds")
  expect(
    codes(`FUNCTION_BLOCK F\nVAR\n a : ARRAY[0..3] OF INT;\nEND_VAR\na[2] := 1;\nEND_FUNCTION_BLOCK`, "codesys"),
  ).not.toContain("array-index-out-of-bounds")
})

test("message pragmas surface the author's text at matching severity", () => {
  const src = `{warning 'deliberate'}\nFUNCTION_BLOCK F\nEND_FUNCTION_BLOCK`
  const d = diag(src, "codesys").find((x) => x.code === "message-pragma-warning")
  expect(d).toMatchObject({ severity: "warning", message: "deliberate" })
})
