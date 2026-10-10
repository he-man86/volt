/**
 * Lowering tests of `specialize.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
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

// Recorded (`callshape_positional_arguments` `Mixed(counter, 3)`, `callshape_array_star_of_struct` `Shift(line := points)`):
// an FB lending its own field to its own METHOD — two `&mut` of one instance. An open array is copied in and written back,
// which reads the same while the callee reaches that field only through the in-out; anything else is SUBSTITUTED, the
// routine specialized on the path from the instance (`specialize.ts`), exact however the callee reaches it.
// Why missed: every in-out test lent the callee something the caller owned apart from the instance.
test("an FB's own field lent to its own METHOD: an open array copied back, everything else substituted", () => {
  const source = (body: string, method = "target := target + amount;\nMixed := target * 10;") =>
    `PROGRAM P\nVAR user : FB_U; END_VAR\nuser();\nEND_PROGRAM\nFUNCTION_BLOCK FB_U\nVAR counter : INT := 7; result : INT; values : ARRAY[0..2] OF INT; i : INT; END_VAR\n${body}\nEND_FUNCTION_BLOCK\n` +
    `METHOD Mixed : INT\nVAR_IN_OUT target : INT; END_VAR\nVAR_INPUT amount : INT; END_VAR\n${method}\nEND_METHOD\n` +
    "METHOD Fill\nVAR_IN_OUT line : ARRAY[*] OF INT; END_VAR\nVAR k : DINT; END_VAR\nFOR k := LOWER_BOUND(line, 1) TO UPPER_BOUND(line, 1) DO\n  line[k] := DINT_TO_INT(k) + 1;\nEND_FOR\nEND_METHOD\n"
  const runner = run(ir(source("result := Mixed(counter, 3);\nFill(values);"), "P"))
  runner.scan()
  expect(["user.counter", "user.result", "user.values[2]"].map((v) => runner.get(v))).toEqual([10n, 100n, 3n])
  const codes = (body: string, method?: string) => lowerSource(source(body, method), "P").diagnostics.map((d) => d.code)
  // The callee also reads the field by name: through the in-out it sees the new value at once, which a copy would not
  // (conformance `callshape_own_field_inout_read_by_name`: 10). Substituted, both reads are the one field.
  const byName = run(ir(source("result := Mixed(counter, 3);", "target := target + amount;\nMixed := counter;"), "P"))
  byName.scan()
  expect([byName.get("user.counter"), byName.get("user.result")]).toEqual([10n, 10n])
  // a runtime index: the path from the instance is not static, so there is nothing to substitute
  expect(codes("result := Mixed(values[i], 3);")).toContain("call-inout-alias")
  // Each of these wrote a wrong value when the first cut COPIED whenever the callee did not NAME the field. Substituted,
  // each is by reference and equals its recording.
  const held = (methods: string, vars = "") =>
    `PROGRAM P\nVAR user : FB_V; END_VAR\nuser();\nEND_PROGRAM\nFUNCTION_BLOCK FB_V\nVAR n : INT; inner : FB_In; ${vars} END_VAR\n${methods.split("|")[0]}\nEND_FUNCTION_BLOCK\n${methods.split("|")[1]}` +
    "FUNCTION_BLOCK FB_In\nVAR x : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Bump\nVAR_IN_OUT v : INT; END_VAR\nv := v + 1;\nx := x + 10;\nEND_METHOD\n"
  const extra = (methods: string, vars = "") => lowerSource(held(methods, vars), "P").diagnostics.map((d) => d.code)
  const ran = (methods: string, vars = "") => {
    const runner = run(ir(held(methods, vars), "P"))
    runner.scan()
    return runner
  }
  // the same field lent to two in-outs of one call — the last write-back won (conformance `callshape_own_field_two_inouts`: 6)
  expect(ran("Two(a := n, b := n);|METHOD Two\nVAR_IN_OUT a : INT; b : INT; END_VAR\na := 5;\nb := b + 1;\nEND_METHOD\n").get("user.n")).toEqual(6n)
  // a sub-instance reached through THIS^, its METHOD writing the field by name too (conformance `callshape_inout_sub_instance_field`: 11)
  expect(ran("THIS^.inner.Bump(v := inner.x);|").get("user.inner.x")).toEqual(11n)
  // a callee that CALLS anything stays refused — here a FUNCTION given THIS^, which could reach the field through it, and
  // which a substituted place would meet as a second `&mut` of the instance
  expect(extra("M(v := n);|METHOD M\nVAR_IN_OUT v : INT; END_VAR\nv := v + 1;\nn := F_Id(k := 1);\nEND_METHOD\nFUNCTION F_Id : INT\nVAR_INPUT k : INT; END_VAR\nF_Id := k;\nEND_FUNCTION\n")).toContain("call-inout-alias")
  // Review of the narrowed cut: SUPER^ built its held list from the bound places alone, so a field bound twice was copied
  // twice (n = 101 where by reference it is 6). Why missed: the two-in-out case above went through a METHOD call only.
  const derived = (superCall: string) =>
    `PROGRAM P\nVAR d : FB_D; x : INT; y : INT; END_VAR\nd(a := x, b := y);\nEND_PROGRAM\nFUNCTION_BLOCK FB_B\nVAR_IN_OUT a : INT; b : INT; END_VAR\na := 5;\nb := b + 1;\nEND_FUNCTION_BLOCK\n` +
    `FUNCTION_BLOCK FB_D EXTENDS FB_B\nVAR n : INT := 100; m : INT := 200; END_VAR\n${superCall}\nEND_FUNCTION_BLOCK\n`
  // conformance `callshape_super_own_field_twice`: by reference n is 6, not the 101 two copies gave
  const twice = run(ir(derived("SUPER^(a := n, b := n);"), "P"))
  twice.scan()
  expect(twice.get("d.n")).toEqual(6n)
  const viaSuper = run(ir(derived("SUPER^(a := n, b := m);"), "P"))
  viaSuper.scan()
  expect([viaSuper.get("d.n"), viaSuper.get("d.m"), viaSuper.get("x")]).toEqual([5n, 201n, 0n])
})

const st = (...lines: string[]): string => lines.join("\n") + "\n"
const T = "\t"

// transpile-review 42: an ANY input's variant was keyed by the bare kind `array`, so every array after the first reused
// the first one's instantiation — its hidden in-out typed for THAT array, which the emitted Rust rejects (E0308,
// `tr_42_any_array_variant_key`). Keyed by element type and bounds, recursively.
test("an ANY input instantiates once per array type — element, bounds and nesting each tell two apart", () => {
  const r = lowerSource(
    st(
      "FUNCTION F : DINT",
      `VAR_INPUT${T}v : ANY; END_VAR`,
      "F := v.diSize;",
      "END_FUNCTION",
      "PROGRAM P",
      "VAR ai : ARRAY[0..3] OF INT; ab : ARRAY[0..9] OF BYTE; ad : ARRAY[1..4] OF INT; ai2 : ARRAY[0..3] OF INT;",
      "n : ARRAY[0..1] OF ARRAY[0..1] OF INT; m : ARRAY[0..1] OF ARRAY[0..2] OF INT; sx : ARRAY[0..5] OF DINT; END_VAR",
      "sx[0] := F(ai); sx[1] := F(ab); sx[2] := F(ad); sx[3] := F(n); sx[4] := F(m); sx[5] := F(ai2);",
      "END_PROGRAM",
    ),
    "P",
  )
  expect(r.diagnostics).toEqual([])
  // ai and ai2 are one array type and share their instantiation; every other pair differs
  expect(r.pou!.routines.length).toBe(5)
  const p = run(r.pou!)
  p.scan()
  expect([0, 1, 2, 3, 4, 5].map((i) => p.get(`sx[${i}]`))).toEqual([8n, 10n, 8n, 8n, 12n, 8n])
})

// 7.7.11: a routine every call specialized is lowered once for the specializations to copy, and runs nowhere — it is not
// in the POU (`ptrparam_method` printed its generic `read` beside `read_ptr_p_0` / `read_ptr_p_1`, a fn nothing calls)
test("a generic routine every call replaced by a specialization is not in the POU", () => {
  const pou = ir(
    "FUNCTION_BLOCK FB_M\nVAR a : INT := 3; b : INT := 4; fa : INT; fb : INT; END_VAR\nfa := Read(p := ADR(a));\nfb := Read(p := ADR(b));\nEND_FUNCTION_BLOCK\n" +
      "METHOD Read : INT\nVAR_INPUT p : POINTER TO INT; END_VAR\nRead := p^ * 10;\nEND_METHOD\n" +
      "PROGRAM P\nVAR inst : FB_M; END_VAR\ninst();\nEND_PROGRAM\n",
    "P",
  )
  const names = pou.routines.map((r) => r.name.toUpperCase())
  expect(names.filter((n) => n.startsWith("FB_M.READ")).length).toBeGreaterThanOrEqual(2)
  expect(names).not.toContain("FB_M.READ")
  const runner = run(pou)
  runner.scan()
  expect(["inst.fa", "inst.fb"].map((v) => runner.get(v))).toEqual([30n, 40n])
})
