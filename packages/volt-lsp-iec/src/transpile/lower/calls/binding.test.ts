/**
 * Lowering tests of `binding.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

// Recorded first (conformance `callshape_array_star_*`, `callshape_bounds_of_sized_array`): an ARRAY[*] VAR_IN_OUT takes the
// bounds of the array it binds — passed on unchanged, per call on an FB, per dimension — and LOWER_BOUND/UPPER_BOUND are
// DINT (70002 * 40000 wraps). It was refused (`slot-array`, and LOWER_BOUND as `expr-call`). Why missed: no fixture
// declared an ARRAY[*], though pro2193 indexes them 636 times.
test("an ARRAY[*] in-out takes the bounds of the array it binds — in a FUNCTION, passed on, on an FB, in two dimensions", () => {
  const source =
    "PROGRAM P\nVAR numbers : ARRAY[-2..4] OF INT; bounds : DINT; grid : ARRAY[1..2, 0..2] OF INT; second : DINT; filler : FB_Fill; shortRow : ARRAY[1..2] OF INT; longRow : ARRAY[5..8] OF INT; " +
    "shortCount : DINT; longCount : DINT; values : ARRAY[70000..70002] OF BYTE; wide : LINT; sized : DINT; stacks : ARRAY[1..3] OF ARRAY[1..4] OF INT; END_VAR\n" +
    "bounds := F_Outer(numbers := numbers);\nsecond := F_Grid(grid := grid);\nfiller(numbers := shortRow);\nshortCount := filler.elementCount;\nfiller(numbers := longRow);\nlongCount := filler.elementCount;\n" +
    "wide := F_Wide(values := values);\nsized := LOWER_BOUND(grid, 2) * 100 + UPPER_BOUND(numbers, 1);\nstacks[2][3] := 7;\nF_Shift(rows := stacks);\nEND_PROGRAM\n" +
    "FUNCTION F_Inner : DINT\nVAR_IN_OUT numbers : ARRAY[*] OF INT; END_VAR\nnumbers[UPPER_BOUND(numbers, 1)] := 99;\nF_Inner := LOWER_BOUND(numbers, 1) * 100 + UPPER_BOUND(numbers, 1);\nEND_FUNCTION\n" +
    "FUNCTION F_Outer : DINT\nVAR_IN_OUT numbers : ARRAY[*] OF INT; END_VAR\nF_Outer := F_Inner(numbers := numbers) + 10000;\nEND_FUNCTION\n" +
    "FUNCTION F_Grid : DINT\nVAR_IN_OUT grid : ARRAY[*, *] OF INT; END_VAR\nVAR row : DINT; column : DINT; END_VAR\nFOR row := LOWER_BOUND(grid, 1) TO UPPER_BOUND(grid, 1) DO\n  FOR column := LOWER_BOUND(grid, 2) TO UPPER_BOUND(grid, 2) DO\n    grid[row, column] := DINT_TO_INT(row * 10 + column);\n  END_FOR\nEND_FOR\nF_Grid := LOWER_BOUND(grid, 2) * 10 + UPPER_BOUND(grid, 2);\nEND_FUNCTION\n" +
    "FUNCTION_BLOCK FB_Fill\nVAR_IN_OUT numbers : ARRAY[*] OF INT; END_VAR\nVAR_OUTPUT elementCount : DINT; END_VAR\nVAR index : DINT; END_VAR\nelementCount := UPPER_BOUND(numbers, 1) - LOWER_BOUND(numbers, 1) + 1;\nFOR index := LOWER_BOUND(numbers, 1) TO UPPER_BOUND(numbers, 1) DO\n  numbers[index] := DINT_TO_INT(index + elementCount * 100);\nEND_FOR\nEND_FUNCTION_BLOCK\n" +
    "FUNCTION F_Wide : LINT\nVAR_IN_OUT values : ARRAY[*] OF BYTE; END_VAR\nF_Wide := UPPER_BOUND(values, 1) * 40000;\nEND_FUNCTION\n" +
    // pro2193's shape (`ShiftStackStatusFB`): an open array of sized rows, shifted down a row
    "FUNCTION F_Shift : BOOL\nVAR_IN_OUT rows : ARRAY[*] OF ARRAY[1..4] OF INT; END_VAR\nVAR di : DINT; END_VAR\nFOR di := UPPER_BOUND(rows, 1) TO 2 BY -1 DO\n  rows[di] := rows[di - 1];\nEND_FOR\nEND_FUNCTION\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect(["bounds", "numbers[4]", "second", "grid[2][2]", "shortCount", "longCount", "shortRow[2]", "longRow[8]", "wide", "sized", "stacks[3][3]", "stacks[2][3]"].map((v) => runner.get(v))).toEqual([
    9804n, 99n, 2n, 22n, 2n, 4n, 202n, 408n, -1494887296n, 4n, 7n, 0n,
  ])
  // a dimension that does not fold names no bound lowering knows
  expect(lowerSource(source.replace("LOWER_BOUND(grid, 2) * 100", "LOWER_BOUND(grid, shortCount) * 100"), "P").diagnostics.map((d) => d.code)).toEqual(["array-bound"])
})

const st = (...lines: string[]): string => lines.join("\n") + "\n"
const T = "\t"

/** The codes a source is refused with — empty when it lowers. */
const codesFor = (source: string, name = "PLC_PRG"): string[] => {
  const r = lowerSource(source, name)
  return r.pou === undefined ? r.diagnostics.map((d) => d.code) : []
}

/** A source that lowers, run one scan, read one place. */
const valueOf = (source: string, path: string, name = "PLC_PRG"): unknown => {
  const r = lowerSource(source, name)
  expect(r.diagnostics).toEqual([])
  const p = run(r.pou!)
  p.scan()
  return p.get(path)
}

describe("what a call may bind", () => {
  test("an FB called with a POSITIONAL argument is refused — a body call names its parameters", () => {
    const source = st(
      "FUNCTION_BLOCK FB_S", "VAR_INPUT", T + "n : INT;", "END_VAR", "END_FUNCTION_BLOCK", "",
      "PROGRAM PLC_PRG", "VAR", T + "sx : FB_S;", "END_VAR", "sx(5);", "END_PROGRAM",
    )
    expect(codesFor(source)).toContain("call-positional")
  })

  test("the same call naming its parameter lowers, and the input is stored before the body", () => {
    const source = st(
      "FUNCTION_BLOCK FB_S", "VAR_INPUT", T + "n : INT;", "END_VAR", "VAR_OUTPUT", T + "seen : INT;", "END_VAR",
      "seen := n;", "END_FUNCTION_BLOCK", "",
      "PROGRAM PLC_PRG", "VAR", T + "sx : FB_S;", T + "a : INT;", "END_VAR", "sx(n := 5);", "a := sx.seen;", "END_PROGRAM",
    )
    expect(valueOf(source, "a")).toBe(5n)
  })

  test("a VAR_IN_OUT bound to a place the call ALREADY holds is refused", () => {
    // the callee would reach one variable through two names, and which write wins is not recorded
    const source = st(
      "FUNCTION_BLOCK FB_K", "VAR_IN_OUT", T + "io : INT;", "END_VAR", "io := io + 1;", "END_FUNCTION_BLOCK", "",
      "FUNCTION_BLOCK FB_O", "VAR", T + "count : INT;", T + "k : FB_K;", "END_VAR", "END_FUNCTION_BLOCK", "",
      "METHOD Bump : INT", "k(io := THIS^.count);", "Bump := count;", "END_METHOD", "",
      "PROGRAM PLC_PRG", "VAR", T + "o : FB_O;", T + "a : INT;", "END_VAR", "a := o.Bump();", "END_PROGRAM",
    )
    expect(codesFor(source)).toContain("call-inout-alias")
  })

  test("a VAR_IN_OUT bound to an ordinary variable lowers and writes back", () => {
    const source = st(
      "FUNCTION_BLOCK FB_K", "VAR_IN_OUT", T + "io : INT;", "END_VAR", "io := io + 1;", "END_FUNCTION_BLOCK", "",
      "PROGRAM PLC_PRG", "VAR", T + "n : INT := 10;", T + "k : FB_K;", "END_VAR", "k(io := n);", "END_PROGRAM",
    )
    expect(valueOf(source, "n")).toBe(11n)
  })
})

// `cc5_in_out_type_mismatch` (refused by CODESYS): a REAL bound to an INT VAR_IN_OUT was lent, and the callee read the
// REAL's storage as an INT — refused now, by name; an INT bound to an INT in-out still lends (7.3.1 found it)
test("a REAL bound to an integer VAR_IN_OUT is refused call-inout-type", () => {
  const fb = "FUNCTION_BLOCK FB_W\nVAR_IN_OUT target : INT; END_VAR\ntarget := target + 1;\nEND_FUNCTION_BLOCK\n"
  const wrong = lowerSource(`${fb}PROGRAM P\nVAR worker : FB_W; rv : REAL; END_VAR\nworker(target := rv);\nEND_PROGRAM\n`, "P")
  expect(wrong.diagnostics.map((d) => d.code)).toEqual(["call-inout-type"])
  const right = lowerSource(`${fb}PROGRAM P\nVAR worker : FB_W; i : INT; END_VAR\nworker(target := i);\nEND_PROGRAM\n`, "P")
  expect(right.diagnostics).toEqual([])
})
