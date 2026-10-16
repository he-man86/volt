/**
 * Lowering tests of `unions.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"
import { emitRust } from "../../emit/rust/index.js"
import { ir } from "../../../../test/support/transpile.js"

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
  // a member whose bytes are not measured — a duration — is refused (a REAL's were measured since: lean 7.8.4)
  expect(codes("FOR n := 1 TO 2 DO u.wd := 1; END_FOR", "wide : TIME;")).toContain("union-overlay")
  // a member under a byte — BOOL, BIT — has no bytes of its own to overlay: refused by name, though BOOL is ANY_BIT
  // (the architecture.md list says "a bit string of 8 bits or more", the 7.11b+8b review); an enum is its base integer
  for (const member of ["flag : BOOL;", "x : BIT;"]) expect(codes("u.wd := 1;", member)).toContain("union-overlay")
  const withEnum = run(ir(union("u.wd := 16#0102;", "e : E_C;") + "TYPE E_C : (A, B); END_TYPE\n", "P"))
  withEnum.scan()
  expect(withEnum.get("u.e")).toBe(0x0102n)
})

// lean 7.8.4: a store is followed by ONE assignment per other member — its bytes read at that member's type — never a
// byte-by-byte chain; signed integers and REALs overlay too (`tr_c8_union_*`), a shorter member keeping the longer's bytes.
test("a UNION store is one reinterpret per other member; INT, DINT, REAL and bytes overlay", () => {
  const source =
    "TYPE U :\nUNION\n\ti : INT;\n\td : DINT;\n\tre : REAL;\n\tb : ARRAY[0..3] OF BYTE;\nEND_UNION\nEND_TYPE\n" +
    "PROGRAM P\nVAR u : U; i : INT; d : DINT; b3 : BYTE; END_VAR\nu.d := 16#11223344;\nu.i := -2;\nd := u.d;\nb3 := u.b[3];\nu.re := 1.0;\ni := u.i;\nEND_PROGRAM\n"
  const pou = ir(source, "P")
  const stores = pou.body.filter((s) => s.kind === "assign" && s.target.root === undefined && s.target.path.length === 1)
  // u.d := …, then i, r, b each once; the same for u.i := … and u.r := …
  expect(stores.length).toBe(12)
  expect(stores.filter((s) => s.kind === "assign" && s.value.kind === "reinterpret").length).toBe(9)
  const runner = run(pou)
  runner.scan()
  // INT -2 over DINT 16#11223344: fe ff 22 11; REAL 1.0 is 16#3F800000, whose low INT is 0
  expect([runner.get("d"), runner.get("b3"), runner.get("u.d"), runner.get("i")]).toEqual([0x1122fffen, 0x11n, 0x3f800000n, 0n])
})

// Gate 7.8d (review): 7.8.4 laid a UNION of pointers out as ONE field, its first member's — which deleted every other
// member from the emitted DUT struct, whose fields are the Rust surface's contract (`emit/rust/index.ts`): `u.pw` no
// longer compiled and `runner.get("u.pw")` threw. Every member stays a field, a plain copy of the one stored.
test("a UNION of pointers keeps every member as a field, each a copy of the stored one", () => {
  const pou = ir(
    "TYPE UP :\nUNION\n\tpb : POINTER TO BYTE;\n\tpw : POINTER TO WORD;\nEND_UNION\nEND_TYPE\n" +
      "PROGRAM P\nVAR u : UP; w : WORD := 16#ABCD; seen : WORD; END_VAR\nu.pb := ADR(w);\nseen := u.pw^;\nEND_PROGRAM\n",
    "P",
  )
  expect(pou.layouts.find((l) => l.name === "UP")!.fields.map((f) => f.name)).toEqual(["pb", "pw"])
  expect(emitRust(pou).code).toMatch(/pub struct UP \{\s*pub pb: usize,\s*pub pw: usize,\s*\}/)
  const runner = run(pou)
  runner.scan()
  expect(runner.get("seen")).toBe(0xabcdn)
  expect(runner.get("u.pw")).toBe(runner.get("u.pb"))
})
