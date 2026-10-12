/**
 * Lowering tests of `initial-values.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
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

// Aggregate initializers (conformance `array_initializers`, `init_struct_by_field`, `init_array_of_structs`,
// `init_fb_instance_inputs`): refused outright before, so nothing modelled a field left out keeping its TYPE's value.
test("an aggregate initializer sets what it names; everything it leaves out keeps its type's initial value", () => {
  const source =
    "TYPE Pt :\nSTRUCT\n\tx : INT := 5;\n\ty : REAL;\n\ttag : STRING(8) := 'p';\nEND_STRUCT\nEND_TYPE\n" +
    "FUNCTION_BLOCK FB_S\nVAR_INPUT factor : INT := 2; offset : INT; END_VAR\nVAR_OUTPUT result : INT; END_VAR\nresult := factor * 10 + offset;\nEND_FUNCTION_BLOCK\n" +
    "PROGRAM P\nVAR\n\tpart : Pt := (y := 7);\n\tkw : Pt := STRUCT(x := 20, y := 1.5);\n\tpts : ARRAY[0..2] OF Pt := [(x := 1), (tag := 'bcdefghij')];\n" +
    "\tgrid : ARRAY[1..2, 1..3] OF INT := [1, 2(7), 4];\n\tfb : FB_S := (offset := 7);\nEND_VAR\nfb();\nEND_PROGRAM\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect([runner.get("part.x"), runner.get("part.y"), runner.get("part.tag"), runner.get("kw.x"), runner.get("kw.tag")]).toEqual([5n, 7, "p", 20n, "p"])
  expect([runner.get("pts[0].x"), runner.get("pts[1].x"), runner.get("pts[1].tag"), runner.get("pts[2].x")]).toEqual([1n, 5n, "bcdefghi", 5n])
  expect([runner.get("grid[1, 3]"), runner.get("grid[2, 1]"), runner.get("grid[2, 2]"), runner.get("fb.result")]).toEqual([7n, 4n, 0n, 27n])
  // a field the type does not have is refused, not dropped
  expect(lowerSource(source.replace("(y := 7)", "(z := 7)"), "P").diagnostics.map((d) => d.code)).toEqual(["aggregate-init"])
})

// transpile-review 25: an array with no initializer started every element at the family zero. CODESYS
// (`array_element_type_default`) starts each at its ELEMENT type's default — an enum's (zero when it is a member, else the
// first), an alias's own `:=`, an initialized alias-of-array's per element — while a PARTIAL initializer's tail stays 0.
test("an array's elements start at their element type's default; a partial initializer's tail stays zero", () => {
  const source =
    "TYPE E : (A := 3, B := 4);\nEND_TYPE\nTYPE F : (X := 1, Y := 0);\nEND_TYPE\nTYPE MyInt : INT := 5;\nEND_TYPE\n" +
    "TYPE MyArr : ARRAY[0..1] OF INT := [8, 9];\nEND_TYPE\n" +
    "PROGRAM P\nVAR ea : ARRAY[0..1] OF E; eb : ARRAY[0..1] OF F; ma : ARRAY[0..1] OF MyInt; aa : ARRAY[0..1] OF MyArr;\n" +
    "sz : ARRAY[1..2] OF MyInt; part : ARRAY[0..2] OF MyInt := [7]; grid : ARRAY[0..1, 0..1] OF E; END_VAR\nEND_PROGRAM\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  const names = ["ea[0]", "ea[1]", "eb[1]", "ma[0]", "ma[1]", "aa[1][0]", "aa[1][1]", "sz[1]", "sz[2]", "part[0]", "part[2]", "grid[1, 1]"]
  expect(names.map((n) => runner.get(n))).toEqual([3n, 3n, 0n, 5n, 5n, 8n, 9n, 5n, 5n, 7n, 0n, 3n])
})

// transpile-restructure 5.3: the IrInit is COMPLETE — an array states its elements and `rest`, and no backend picks an
// element's default. Recorded first: a partial initializer's tail on an ENUM array is the enum's default, not the family
// zero (`array_element_enum_partial_tail`: 3), while an alias's tail stays 0 (`r_alias_part2`); an alias OF an alias takes
// only its own `:=` (`array_element_alias_of_alias`: `Plain : Base` with `Base : INT := 5` is 0, `Own : Base := 6` is 6).
// The tail is the same through a struct field's declaration (storage erases the enum to its integer there).
test("a partial initializer's tail is the element type's start without an alias's :=; an alias of an alias takes its own only", () => {
  const source =
    "TYPE E : (A := 3, B := 4);\nEND_TYPE\nTYPE MyInt : INT := 5;\nEND_TYPE\nTYPE Base : INT := 5;\nEND_TYPE\nTYPE Plain : Base;\nEND_TYPE\nTYPE Own : Base := 6;\nEND_TYPE\n" +
    "TYPE Holder :\nSTRUCT\n\tes : ARRAY[0..2] OF E;\nEND_STRUCT\nEND_TYPE\n" +
    "PROGRAM P\nVAR ep : ARRAY[0..2] OF E := [E.B]; mp : ARRAY[0..2] OF MyInt := [7]; h : Holder := (es := [E.B]);\n" +
    "ps : Plain; os : Own; pa : ARRAY[0..1] OF Plain; oa : ARRAY[0..1] OF Own; END_VAR\nEND_PROGRAM\n"
  const pou = ir(source, "P")
  const runner = run(pou)
  runner.scan()
  const names = ["ep[0]", "ep[1]", "ep[2]", "mp[2]", "h.es[2]", "ps", "os", "pa[1]", "oa[1]"]
  expect(names.map((n) => runner.get(n))).toEqual([4n, 3n, 3n, 0n, 3n, 0n, 6n, 0n, 6n])
  // compact: one stated element, the rest at `rest`
  expect(pou.slots.find((s) => s.name === "ep")!.init).toEqual({ elements: [4n], rest: 3n })
})

// A scalar constant on an array, a struct or an FB instance is refused by CODESYS (`litc_array_init_one`,
// `litc_struct_init_one`, `litc_fb_init_one`); lowering dropped it in silence, the backends printing the zeros.
test("a scalar initial value on a composite is refused, not dropped", () => {
  const codes = (decl: string) =>
    lowerSource(`TYPE Rec :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\nPROGRAM P\nVAR ${decl} END_VAR\nEND_PROGRAM\n`, "P").diagnostics.map((d) => d.code)
  expect(codes("arr : ARRAY[0..1] OF INT := 1;")).toEqual(["init-composite-scalar"])
  expect(codes("r1 : Rec := 1;")).toEqual(["init-composite-scalar"])
})

// Gate 5c: the repeat refusal for a dynamic element was applied to a direct value only — a nested aggregate inside a repeat
// collected its dynamic leaf once per repetition, so `[2([F_Next(), 7])]` called F_Next twice, a count nothing records.
test("a dynamic element inside a repeated nested aggregate is refused like a repeated dynamic value", () => {
  const codes = (decl: string) =>
    lowerSource(
      `VAR_GLOBAL\ng : INT;\nEND_VAR\nFUNCTION F_Next : INT\ng := g + 1;\nF_Next := g;\nEND_FUNCTION\nPROGRAM P\nVAR ${decl} r0 : INT; END_VAR\nr0 := 1;\nEND_PROGRAM\n`,
      "P",
    ).diagnostics.map((d) => d.code)
  expect(codes("a : ARRAY[0..1] OF INT := [2(F_Next())];")).toEqual(["aggregate-init"])
  expect(codes("a : ARRAY[0..1] OF ARRAY[0..1] OF INT := [2([F_Next(), 7])];")).toEqual(["aggregate-init"])
})

// transpile-restructure 6.A.15 (Appendix A): `n(v)` built all n leaves BEFORE the size check, so a repeat count far past
// the array — `[100000000000(1)]` into two elements — ran out of memory (or ran for minutes) instead of refusing.
test("a repeat count past the array refuses before it builds a leaf", () => {
  const started = performance.now()
  const { pou, diagnostics } = lowerSource("PROGRAM P\nVAR a : ARRAY[0..1] OF INT := [100000000000(1)]; END_VAR\nEND_PROGRAM\n", "P")
  expect(pou).toBeUndefined()
  expect(diagnostics.map((d) => [d.code, d.message])).toEqual([["aggregate-init", expect.stringContaining("more elements than the array holds")]])
  expect(performance.now() - started).toBeLessThan(1000)
})

// transpile-restructure 6.A.25 (Appendix A grouped, "subrange bounds dropped"): a subrange declared with no initializer
// starts at 0 when its range holds 0, else at its LOWER bound — INT(3..9) 3, INT(-5..5) 0, DINT(-10..-2) -10, INT(0..9)
// 0, an ARRAY's elements, a STRUCT's field and a named subrange DUT alike (`tr_a25_subrange_defaults`, CODESYS record:exec
// 2026-10-10; `decl_subrange_unsigned`: UINT(1..5) is 1). Every one started at 0.
test("a subrange with no initializer starts at 0 inside its range, else at its lower bound", () => {
  const source =
    "TYPE R : INT(3..9);\nEND_TYPE\nTYPE H :\nSTRUCT\n\tf : INT(3..9);\nEND_STRUCT\nEND_TYPE\n" +
    "PROGRAM P\nVAR a : INT(3..9); b : INT(-5..5); c : DINT(-10..-2); d : INT(0..9); u : UINT(1..5); arr : ARRAY[0..1] OF INT(3..9); h : H; n : R; END_VAR\nEND_PROGRAM\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect(["a", "b", "c", "d", "u", "arr[0]", "arr[1]", "h.f", "n"].map((v) => runner.get(v))).toEqual([3n, 0n, -10n, 0n, 1n, 3n, 3n, 3n, 3n])
})

// transpile-restructure 8.2: a REAL NaN is its bits (`semantics/nan.ts`), which no IR constant holds, and what CODESYS's
// own initializer fold stores for one is unmeasured — refused by name. It used to reach the IR as the number NaN, which the
// interpreter held as the one quiet NaN and the emitter printed as `NaNf32`, no Rust at all.
test("an initializer that folds to a NaN is refused by name (init-nan)", () => {
  const codes = (init: string): string[] => lowerSource(`PROGRAM P\nVAR x : REAL := ${init}; END_VAR\nEND_PROGRAM\n`, "P").diagnostics.map((d) => d.code)
  expect(codes("SQRT(0.0 - 1.0)")).toEqual(["init-nan"])
  expect(codes("SQRT(4.0)")).toEqual([])
})

// openspec lsp-quick-fixes, review of step 1 (CODESYS record:exec 2026-10-12): a CONSTANT that states no initial value
// (C0228) holds its BASE type's zero, not the start a VARIABLE of its type has — `cap : A` with `TYPE A : INT := 42` runs
// as 0 (`qf_c0228_before_alias`), `cap : INT(3..9)` as 0, outside its range (`qf_c0228_before_inline_subrange`) — save
// a NAMED subrange's, which runs at its lower bound (`qf_c0228_before_subrange`: 3).
test("a CONSTANT with no initial value starts at its base type's zero — not an alias's :=, not an inline subrange's bound", () => {
  const source =
    "TYPE A : INT := 42;\nEND_TYPE\nTYPE R : INT(3..9);\nEND_TYPE\n" +
    "PROGRAM P\nVAR CONSTANT\n\tca : A;\n\tci : INT(3..9);\n\tcr : R;\nEND_VAR\nVAR\n\tva : A;\n\tvi : INT(3..9);\n\toa : INT;\n\toi : INT;\n\tor_ : INT;\nEND_VAR\n" +
    "oa := ca + 1;\noi := ci + 1;\nor_ := cr + 1;\nEND_PROGRAM\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect([runner.get("oa"), runner.get("oi"), runner.get("or_")]).toEqual([1n, 1n, 4n])
  // a VARIABLE of the same types starts as ever: the alias's 42, the subrange's lower bound
  expect([runner.get("va"), runner.get("vi")]).toEqual([42n, 3n])
})
