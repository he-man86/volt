/**
 * Lowering tests of `addresses.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"
import { ir } from "../../../../test/support/transpile.js"

// Review 2026-09-15 (declarations). A root PROGRAM's VAR_IN_OUT lowered as a field the POU owned. An `AT` variable lowered
// as plain storage — which the simulator agrees with (conformance `operand_hw_address_marker`) — even where its address
// aliases another variable's, or one FB field's address is shared by several instances. Why missed: no running fixture
// declares any of these; the declaration fixtures only prove they compile, and the one AT case holds two apart.
test("an AT variable is plain storage unless its address aliases another; a root PROGRAM owns its VAR_IN_OUT", () => {
  const codes = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
  const runner = run(ir("PROGRAM P\nVAR flag AT %MX0.0 : BOOL; reg AT %MW10 : WORD; END_VAR\nreg := reg + 1;\nflag := reg = 1;\nEND_PROGRAM\n", "P"))
  runner.scan()
  expect([runner.get("reg"), runner.get("flag")]).toEqual([1n, true])
  // %MW1 is bytes 1–2 under byte addressing and 2–3 under word addressing, so %MB3 overlaps it under the one of them
  expect(codes("PROGRAM P\nVAR w AT %MW1 : WORD; b AT %MB3 : BYTE; END_VAR\nw := 1;\nEND_PROGRAM\n")).toEqual(["var-at"])
  expect(codes("PROGRAM P\nVAR x AT %I* : BOOL; y : BOOL; END_VAR\ny := TRUE;\nEND_PROGRAM\n")).toEqual(["var-at"])
  const fb = "FUNCTION_BLOCK FB_At\nVAR q AT %QW4 : WORD; END_VAR\nq := q + 1;\nEND_FUNCTION_BLOCK\n"
  expect(codes(`PROGRAM P\nVAR one : FB_At; END_VAR\none();\nEND_PROGRAM\n${fb}`)).toEqual([])
  expect(codes(`PROGRAM P\nVAR one : FB_At; two : FB_At; END_VAR\none();\ntwo();\nEND_PROGRAM\n${fb}`)).toEqual(["var-at-instances"])
  // a root PROGRAM's VAR_IN_OUT: no caller, so the harness owns it — an ordinary variable a test writes and reads
  const root = run(ir("PROGRAM P\nVAR_IN_OUT shared : INT; END_VAR\nshared := shared + 1;\nEND_PROGRAM\n", "P"))
  root.scan()
  root.scan()
  expect(root.get("shared")).toEqual(2n)
  // an ARRAY[*] stays refused: its size is the caller's array's, and there is none
  expect(codes("PROGRAM P\nVAR_IN_OUT many : ARRAY[*] OF INT; END_VAR\nmany[0] := 1;\nEND_PROGRAM\n")).toEqual(["root-inout"])
})
