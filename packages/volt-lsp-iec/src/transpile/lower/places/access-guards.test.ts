/**
 * Lowering tests of `access-guards.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"
import { ir } from "../../../../test/support/transpile.js"

// VAR_IN_OUT CONSTANT (conformance `inout_const_*`): bound like a plain VAR_IN_OUT, so a STRING literal and a METHOD's
// own field were refused, and a write inside the callee lowered. Why missed: no fixture held the section.
test("a VAR_IN_OUT CONSTANT is lent read-only: a literal or the instance's own field as a copy, a write refused", () => {
  const source = (body: string, method = "Twice := value * 2;") =>
    `PROGRAM P\nVAR x : INT := 3; fromFn : INT; matches : BOOL; inst : FB_C; END_VAR\n${body}\nEND_PROGRAM\n` +
    "FUNCTION F_Match : BOOL\nVAR_IN_OUT CONSTANT text : STRING; END_VAR\nF_Match := text = 'abc';\nEND_FUNCTION\n" +
    "FUNCTION F_Twice : INT\nVAR_IN_OUT CONSTANT value : INT; END_VAR\nF_Twice := value * 2;\nEND_FUNCTION\n" +
    `FUNCTION_BLOCK FB_C\nVAR own : INT := 4; got : INT; END_VAR\ngot := Twice(value := own);\nEND_FUNCTION_BLOCK\nMETHOD Twice : INT\nVAR_IN_OUT CONSTANT value : INT; END_VAR\n${method}\nEND_METHOD\n`
  const runner = run(ir(source("matches := F_Match(text := 'abc');\nfromFn := F_Twice(value := x);\ninst();"), "P"))
  runner.scan()
  expect(["matches", "fromFn", "inst.got"].map((v) => runner.get(v))).toEqual([true, 6n, 8n])
  const codes = (body: string, method?: string) => lowerSource(source(body, method), "P").diagnostics.map((d) => d.code)
  // the method writes its instance while it reads the copy — which a reference would see, so it stays refused
  expect(codes("inst();", "own := 0;\nTwice := value * 2;")).toEqual(["call-inout-alias"])
  // (the METHOD holding the write lowers only when something calls it — `inst()` does)
  expect(codes("inst();", "value := 1;\nTwice := value;")).toContain("inout-constant-write")
})

// Review of the VAR_IN_OUT CONSTANT batch (2026-09-15), each finding reproduced with lowerSource or rustc: only the `:=`
// write was pinned; a parenthesised variable took the copy path past the alias check; an FB instance lent read-only was
// called through `&` (E0596); its address was refused in compiler wording no recording backs.
test("VAR_IN_OUT CONSTANT: every write form refused, `(x)` checked as x, a lent instance called and its address read", () => {
  const source = (body: string, write = "") =>
    `PROGRAM P\nVAR x : INT := 3; y : INT; inst : FB_K; END_VAR\n${body}\nEND_PROGRAM\n` +
    `FUNCTION F_W : INT\nVAR_IN_OUT CONSTANT value : INT; END_VAR\nVAR t : INT; p : POINTER TO INT; END_VAR\n${write}\nF_W := value;\nEND_FUNCTION\n` +
    "FUNCTION_BLOCK FB_K\nVAR_OUTPUT q : INT; END_VAR\nq := q + 1;\nEND_FUNCTION_BLOCK\nMETHOD Get : INT\nGet := q;\nEND_METHOD\n" +
    "FUNCTION F_Lent : INT\nVAR_IN_OUT CONSTANT lent : FB_K; END_VAR\nF_Lent := lent.Get();\nEND_FUNCTION\n"
  const codes = (body: string, write?: string) => lowerSource(source(body, write), "P").diagnostics.map((d) => d.code)
  for (const write of ["value := 1;", "t := value := 1;", "FOR value := 0 TO 2 DO\n  t := 1;\nEND_FOR"])
    expect(codes("y := F_W(value := x);", write)).toEqual(["inout-constant-write"])
  // The review had these refused as unmodelled; recorded since, CODESYS takes the address and calls the lent instance
  // (`inout_const_adr_11`, `inout_const_fb_method_12`) — so both lower, the instance lent `&mut`.
  const runner = run(ir(source("y := F_W(value := x) + F_Lent(lent := inst);", "p := ADR(value);\nt := p^;"), "P"))
  runner.scan()
  expect(runner.get("y")).toEqual(3n)
  // a store through that address is still a store into the in-out
  expect(codes("y := F_W(value := x);", "p := ADR(value);\np^ := 1;")).toEqual(["inout-constant-write"])
  const paren =
    "PROGRAM P\nVAR inst : FB_P; END_VAR\ninst();\nEND_PROGRAM\nFUNCTION_BLOCK FB_P\nVAR own : INT := 4; got : INT; END_VAR\ngot := Twice(value := (own));\nEND_FUNCTION_BLOCK\n" +
    "METHOD Twice : INT\nVAR_IN_OUT CONSTANT value : INT; END_VAR\nown := 0;\nTwice := value * 2;\nEND_METHOD\n"
  expect(lowerSource(paren, "P").diagnostics.map((d) => d.code)).toEqual(["call-inout-alias"])
})

// transpile-restructure 6.A.18: every store site names one of three lists (PLAIN_WRITE, STORE_WRITE, FULL_WRITE) instead of
// a list of its own, and each holds `constant` — so every kind of store into a VAR_IN_OUT CONSTANT is refused, whatever
// the store is: a latch, a character, an output, an input stored into a lent instance, a reference's target, an
// in-out binding, an ANY argument (the `:=`, a chain link and a FOR variable are the test above).
test("every kind of store into a VAR_IN_OUT CONSTANT is refused, the list each store site names holding `constant`", () => {
  const source = (write: string) =>
    "PROGRAM P\nVAR x : INT := 3; flag : BOOL; text : STRING; y : INT; inst : FB_In; END_VAR\ny := F_W(n := x, flag := flag, text := text, lent := inst);\nEND_PROGRAM\n" +
    "FUNCTION_BLOCK FB_In\nVAR_INPUT inp : INT; END_VAR\nVAR_OUTPUT q : INT; END_VAR\nq := inp;\nEND_FUNCTION_BLOCK\n" +
    "FUNCTION F_Inc : INT\nVAR_IN_OUT v : INT; END_VAR\nv := v + 1;\nF_Inc := v;\nEND_FUNCTION\n" +
    "FUNCTION F_Any : INT\nVAR_INPUT a : ANY; END_VAR\nF_Any := 1;\nEND_FUNCTION\n" +
    `FUNCTION F_W : INT\nVAR_IN_OUT CONSTANT n : INT; flag : BOOL; text : STRING; lent : FB_In; END_VAR\nVAR rn : REFERENCE TO INT; other : FB_In; t : INT; END_VAR\n${write}\nF_W := n;\nEND_FUNCTION\n`
  const codes = (write: string) => lowerSource(source(write), "P").diagnostics.map((d) => d.code)
  const writes = ["flag S= TRUE;", "text[0] := 65;", "other(q => n);", "lent(inp := 1);", "rn REF= n;\nrn := 1;", "t := F_Inc(v := n);", "t := F_Any(a := n);"]
  expect(writes.filter((w) => !codes(w).includes("inout-constant-write"))).toEqual([])
})
