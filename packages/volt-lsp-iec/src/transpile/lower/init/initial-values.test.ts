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
