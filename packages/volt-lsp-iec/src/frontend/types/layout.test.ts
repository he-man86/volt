import { expect, test } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { build } from "../symbols/index.js"
import { constEval } from "./index.js"
import { bodies } from "../symbols/index.js"
import type { CompileEnvironment } from "../syntax/index.js"

/** The 64-bit target every measured layout was recorded on (`CODESYS Control Win V3 x64`, `TwinCAT RT (x64)`). */
const X64: CompileEnvironment = { project: { defines: new Set<string>() }, target: { pointerBits: 64 } }

/** `SIZEOF(<operand>)` folded in an FB that declares `vars`, beside `units`, in `environment` (the 64-bit target's; "none": no environment at all). */
function sizeOf(operand: string, units: string, vars = "", environment: CompileEnvironment | "none" = X64): unknown {
  const files = [
    { uri: "file:///p/T.dut", source: units },
    { uri: "file:///p/F.pou", source: `FUNCTION_BLOCK F\nVAR\n  n : ULINT;\n${vars}\nEND_VAR\nn := SIZEOF(${operand});\nEND_FUNCTION_BLOCK\n` },
  ].map((f) => ({ ...f, parseResult: parseSource(f.source, { networkText: true }) }))
  const project = build.buildSymbolTable(files, [], "codesys", environment === "none" ? undefined : environment)
  for (const { scope, statements } of bodies(files.at(-1)!.parseResult.units, project)) {
    const s = statements[0]
    if (s?.kind === "assign") return constEval(s.value, scope)
  }
  throw new Error("no assignment parsed")
}

const struct = (name: string, fields: string, pragma = "") => `${pragma}TYPE ${name} :\nSTRUCT\n${fields}\nEND_STRUCT\nEND_TYPE\n`

// transpile-restructure 6.A.31 (recorded as array bounds, `tr_a31_sizeof_bound_*`, both vendors 2026-10-10; and as run
// values, `mem_sizeof_*`, `ct_bit_packing_sizes`, `fb_header_offsets_*`): the front-end's SIZEOF sized no STRUCT, FB
// instance or ARRAY of either, so `ARRAY[0..SIZEOF(S)]` had no bound and the index past it no error. Why missed: the
// layout model lived in lowering alone (`lower/storage/bytes.ts`), and the fold-agreement test filed the 24 as KNOWN.
test("SIZEOF of a STRUCT, a packed STRUCT, BITs, an ARRAY of STRUCTs and an FB instance folds to the measured layout", () => {
  expect(sizeOf("S", struct("S", "b : BYTE;\nd : DINT;"))).toBe(8n)
  expect(sizeOf("sv", struct("S", "b : BYTE;\ni : INT;\nl : LREAL;\nx : BOOL;"), "sv : S;")).toBe(24n)
  expect(sizeOf("O", struct("I", "w : WORD;\nb : BYTE;") + struct("O", "c : BYTE;\ntxt : STRING(5);\nnest : I;\nd : DINT;"))).toBe(16n)
  expect(sizeOf("P", struct("P", "x : BOOL;\nd : DINT;", "{attribute 'pack_mode' := '1'}\n"))).toBe(5n)
  expect(sizeOf("B", struct("B", [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `b${i} : BIT;`).join("\n") + "\ni : INT;"))).toBe(4n)
  expect(sizeOf("arr", struct("E", "d : DINT;\nb : BYTE;"), "arr : ARRAY[0..2] OF E;")).toBe(24n)
  const inner = "FUNCTION_BLOCK G\nVAR_INPUT\n  i : INT;\nEND_VAR\nVAR\n  d : DINT;\nEND_VAR\nEND_FUNCTION_BLOCK\n"
  expect(sizeOf("g", inner, "g : G;")).toBe(16n)
})

test("what is not measured has no size", () => {
  // a derived STRUCT, a pack mode other than 1, an FB with a VAR_IN_OUT, a pointer field
  expect(sizeOf("D", struct("A", "a : INT;") + "TYPE D EXTENDS A :\nSTRUCT\n  b : INT;\nEND_STRUCT\nEND_TYPE\n")).toBeUndefined()
  expect(sizeOf("P", struct("P", "x : BOOL;\nd : DINT;", "{attribute 'pack_mode' := '2'}\n"))).toBeUndefined()
  expect(sizeOf("g", "FUNCTION_BLOCK G\nVAR_IN_OUT\n  io : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n", "g : G;")).toBeUndefined()
  expect(sizeOf("S", struct("S", "p : POINTER TO INT;"))).toBeUndefined()
})

// 6Af gate review: the layout answered as if every project were the 64-bit target the recordings were made on — an FB's
// header and interface slots are pointers, and an 8-byte field's alignment inside a STRUCT is unmeasured on a 32-bit
// target. The LSP binds most workspaces with NO target (only `CODESYS Control Win V3 x64` is a measured device), so
// `ARRAY[0..12 - SIZEOF(g)]` was checked against the 64-bit size wherever. A STRUCT or an FB instance has a size on the
// 64-bit target alone; an elementary type, an array of one, an enum keep theirs (the target does not change them).
test("a STRUCT or an FB instance has no size where the target is not the measured 64-bit one", () => {
  const fbG = `FUNCTION_BLOCK G
VAR_INPUT
  i : INT;
END_VAR
VAR
  d : DINT;
END_VAR
END_FUNCTION_BLOCK
`
  const noTarget: CompileEnvironment = { project: { defines: new Set<string>() } }
  const x86: CompileEnvironment = { project: { defines: new Set<string>() }, target: { pointerBits: 32 } }
  for (const env of ["none", noTarget, x86] as const) {
    expect(sizeOf("g", fbG, "g : G;", env)).toBeUndefined()
    expect(sizeOf("S", struct("S", `b : BYTE;
d : DINT;`), "", env)).toBeUndefined()
    expect(sizeOf("arr", "", "arr : ARRAY[0..2] OF INT;", env)).toBe(6n)
  }
})

// 6Af gate review (recorded `tr_a31_sizeof_bound_fb_var_input_constant`, both vendors, and `tr_a31_sizeof_fb_var_input_constant`
// run, 2026-10-10: 24): a VAR_INPUT CONSTANT is a per-call PARAMETER (`var_input_constant*`), not a constant the compiler
// replaces — it takes its room in the instance. The layout skipped it with the replaced VAR CONSTANTs (16).
test("a VAR_INPUT CONSTANT takes its room in the instance", () => {
  const fb = `FUNCTION_BLOCK G
VAR_INPUT CONSTANT
  i : LINT;
END_VAR
VAR
  d : DINT;
END_VAR
END_FUNCTION_BLOCK
`
  expect(sizeOf("g", fb, "g : G;")).toBe(24n)
})
