/**
 * Lowering tests of `bounds.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

// Corpus research (2026-09-15), each confirmed in a real project: an array bound that is the POU's or an FB's own VAR
// CONSTANT (pro2193 `ARRAY[1..numberOfXYControls]`) was "not a sized array" — bounds folded in the project scope only; a
// GVL variable named like its own list (lenze-mid `Mach1_Alarms.Alm001`) resolved to the list; a FOR step decided at run
// time was refused. Why missed: every fixture bound was a literal or a GVL constant, every list named apart from its
// variables, and every FOR step a literal.
test("bounds from a POU's own constant, a GVL variable named like its list, a FOR step decided at run time", () => {
  const source =
    "PROGRAM P\nVAR CONSTANT count : INT := 3; END_VAR\nVAR arr : ARRAY[1..count] OF INT; inst : FB_C; up : INT; down : INT; i : INT; step : INT := 2; backwards : BOOL := TRUE; END_VAR\n" +
    "arr[count] := 7;\ninst();\nFOR i := 1 TO 5 BY step DO\n  up := up + 1;\nEND_FOR\nFOR i := 5 TO 1 BY SEL(backwards, 2, -2) DO\n  down := down + i;\nEND_FOR\nEND_PROGRAM\n" +
    "FUNCTION_BLOCK FB_C\nVAR CONSTANT size : INT := 2; END_VAR\nVAR cells : ARRAY[0..size] OF INT; END_VAR\ncells[size] := 5;\nEND_FUNCTION_BLOCK\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  // 1, 3, 5 counted up; 5 + 3 + 1 summed counting down
  expect(["arr[3]", "inst.cells[2]", "up", "down"].map((v) => runner.get(v))).toEqual([7n, 5n, 3n, 9n])
  const alarms = "PROGRAM P\nVAR seen : BOOL; END_VAR\nseen := Alarms.Alm001;\nEND_PROGRAM\nTYPE T_Alarms : STRUCT Alm001 : BOOL := TRUE; END_STRUCT END_TYPE\n"
  const listed = lowerSource(alarms, "P", [{ uri: "file:///project/Alarms.gvl", source: "VAR_GLOBAL\n  Alarms : T_Alarms;\nEND_VAR\n" }])
  expect(listed.diagnostics).toEqual([])
  const alarmRun = run(listed.pou!)
  alarmRun.scan()
  expect(alarmRun.get("seen")).toEqual(true)
})

// Review of batch 3b (4 lenses, adversarial verify), each reproduced before its fix. Why missed: the batch's tests used an
// ARRAY[*] only the recorded ways — indexed, bounded, passed on — never whole, by address, through a union, rebound under
// SUPER^, read from a METHOD, or lent as a copy; each of those lowered silently once the slice became representable.
test("review of ARRAY[*]: whole values, addresses, unions, SUPER^ rebinding, METHOD reads and copies are refused", () => {
  const codes = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
  const union = "TYPE U_W :\nUNION\n\twd : WORD;\n\tbytes : ARRAY[1..2] OF BYTE;\nEND_UNION\nEND_TYPE\n"
  const program = (body: string) =>
    `PROGRAM P\nVAR row : ARRAY[2..5] OF INT; words : ARRAY[0..1] OF U_W; rv : INT; END_VAR\nrv := F(numbers := row, us := words);\nEND_PROGRAM\n` +
    `FUNCTION F : INT\nVAR_IN_OUT numbers : ARRAY[*] OF INT; us : ARRAY[*] OF U_W; END_VAR\nVAR tmp : ARRAY[2..5] OF INT; p : POINTER TO INT; END_VAR\n${body}\nEND_FUNCTION\n` +
    `FUNCTION G : INT\nVAR_INPUT whole : ARRAY[2..5] OF INT; END_VAR\nG := whole[2];\nEND_FUNCTION\n${union}`
  // the recorded uses still lower
  expect(codes(program("numbers[UPPER_BOUND(numbers, 1)] := 1;\nF := numbers[2];"))).toEqual([])
  // a slice clone rustc rejects, and a store that swapped the caller's array for another under the old bounds
  expect(codes(program("tmp := numbers;"))).toContain("open-array-value")
  expect(codes(program("numbers := tmp;"))).toContain("open-array-value")
  expect(codes(program("F := G(whole := numbers);"))).toContain("open-array-value")
  // the store vanished with no diagnostic
  expect(codes(program("p := ADR(numbers[2]);"))).toContain("pointer-shape")
  // the overlay walk stopped at the open index: no copy made, no refusal
  expect(codes(program("us[0].wd := 16#ABCD;"))).toContain("union-write")
  // SUPER^ rebinding an open in-out overwrote the bounds the derived body indexes its own by
  const inherit = (binding: string) =>
    `PROGRAM P\nVAR d : FB_D; g : ARRAY[1..3] OF INT; h : ARRAY[10..12] OF INT; END_VAR\nd(data := g, other := h);\nEND_PROGRAM\n` +
    `FUNCTION_BLOCK FB_B\nVAR_IN_OUT data : ARRAY[*] OF INT; END_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_D EXTENDS FB_B\nVAR_IN_OUT other : ARRAY[*] OF INT; END_VAR\nSUPER^(${binding});\nEND_FUNCTION_BLOCK\n`
  expect(codes(inherit("data := other"))).toContain("call-open-array")
  expect(codes(inherit("data := data"))).toEqual([])
  // a METHOD reading its FB's open in-out: which bounds it sees is not recorded
  expect(codes("PROGRAM P\nVAR m : FB_M; g : ARRAY[1..3] OF INT; END_VAR\nm(data := g);\nEND_PROGRAM\nFUNCTION_BLOCK FB_M\nVAR_IN_OUT data : ARRAY[*] OF INT; END_VAR\nVAR top : DINT; END_VAR\nPeek();\nEND_FUNCTION_BLOCK\nMETHOD Peek\ntop := UPPER_BOUND(data, 1);\nEND_METHOD\n")).toContain("array-bound")
  // a VAR_IN_OUT CONSTANT lent as a copy carries no bounds
  expect(codes("PROGRAM P\nVAR sv : FB_S; n : DINT; END_VAR\nn := sv.Sum(v := sv.arr);\nEND_PROGRAM\nFUNCTION_BLOCK FB_S\nVAR arr : ARRAY[1..3] OF INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Sum : DINT\nVAR_IN_OUT CONSTANT v : ARRAY[*] OF INT; END_VAR\nSum := v[1];\nEND_METHOD\n")).toContain("call-open-array")
})
