/**
 * Lowering tests of `unions.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
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

// UNION (conformance `type_dut_union`, little-endian overlay): it had no layout at all (`layout-struct`).
test("a UNION member's store shows through every member it overlays; a write the copy cannot follow is refused", () => {
  const union = (body: string, member = "wide : DWORD;") =>
    `PROGRAM P\nVAR u : U_W; n : INT; out : WORD; inst : FB_O; END_VAR\n${body}\nEND_PROGRAM\nTYPE U_W :\nUNION\n\twd : WORD;\n\tbytes : ARRAY[1..2] OF BYTE;\n\t${member}\nEND_UNION\nEND_TYPE\nFUNCTION_BLOCK FB_O\nVAR_OUTPUT q : WORD; END_VAR\nq := 16#1234;\nEND_FUNCTION_BLOCK\n`
  const runner = run(ir(union("u.wide := 16#11223344;\nu.wd := 16#ABCD;\nout := u.wd;\nu.bytes[2] := 16#EE;"), "P"))
  runner.scan()
  // the DWORD's upper bytes survive the WORD store; the BYTE store shows through both wider members
  expect([runner.get("u.bytes[1]"), runner.get("u.bytes[2]"), runner.get("u.wd"), runner.get("u.wide"), runner.get("out")]).toEqual([0xcdn, 0xeen, 0xeecdn, 0x1122eecdn, 0xabcdn])
  const codes = (body: string, member?: string) => lowerSource(union(body, member), "P").diagnostics.map((d) => d.code)
  expect(codes("inst(q => u.wd);")).toEqual(["union-write"])
  expect(codes("FOR n := 1 TO 2 DO u.wd := 1; END_FOR", "wide : REAL;")).toContain("layout-union")
})
