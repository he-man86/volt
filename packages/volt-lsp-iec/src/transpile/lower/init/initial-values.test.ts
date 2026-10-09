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
