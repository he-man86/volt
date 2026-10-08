/**
 * Lowering tests of `address.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
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

test("a stepped pointer names the byte view when there is no array, and the element rule when there is", () => {
  // `size === undefined` meant "no element to step at all" and was reported as "not whole elements of its ARRAY",
  // which names an array that does not exist. Measured (pointer-model.md §3): 88 stepped uses in the corpus,
  // almost all of them walking a byte's bits through a pointer to a single BOOL — every one is this case.
  const single =
    `PROGRAM P\nVAR b : BOOL; p : POINTER TO BOOL; q : POINTER TO BOOL; END_VAR\n` +
    `p := ADR(b);\nq := p + 1;\nEND_PROGRAM\n`
  const one = lowerSource(single, "P").diagnostics.find((d) => d.code === "pointer-step")
  expect(one?.message).toContain("byte-addressable view")

  // an ARRAY element stepped by a non-multiple keeps the rule it actually broke
  const arr =
    `PROGRAM P\nVAR xs : ARRAY[0..3] OF DINT; p : POINTER TO DINT; q : POINTER TO DINT; END_VAR\n` +
    `p := ADR(xs[0]);\nq := p + 3;\nEND_PROGRAM\n`
  const two = lowerSource(arr, "P").diagnostics.find((d) => d.code === "pointer-step")
  expect(two?.message).toContain("whole elements of its array")
})

// transpile-review 44: array element k was tagged k+1 with 0 as NULL, so `ADR(arr[0]) - SIZEOF(INT)` read as NULL, and a
// step by `2 * SIZEOF(INT)` was refused as not whole elements. CODESYS (`tr_44_pointer_step_below_first_element`): a pointer
// is a byte address — one or two elements below arr[0] is not NULL, and stepping back up reads arr[0] (11) again.
test("a pointer stepped below its array's first element is not NULL and steps back to it", () => {
  const source =
    "PROGRAM P\nVAR arr : ARRAY[0..3] OF INT := [11, 22, 33, 44]; p : POINTER TO INT; q : POINTER TO INT;\n" +
    "isNull : BOOL; back : INT; isNullTwo : BOOL; backTwo : INT; END_VAR\n" +
    "p := ADR(arr[0]);\np := p - SIZEOF(INT);\nisNull := p = 0;\np := p + SIZEOF(INT);\nback := p^;\n" +
    "q := ADR(arr[0]);\nq := q - 2 * SIZEOF(INT);\nisNullTwo := q = 0;\nq := q + 2 * SIZEOF(INT);\nbackTwo := q^;\nEND_PROGRAM\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect(["isNull", "back", "isNullTwo", "backTwo"].map((n) => runner.get(n))).toEqual([false, 11n, false, 11n])
})
