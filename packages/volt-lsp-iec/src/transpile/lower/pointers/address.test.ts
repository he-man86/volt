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

// Both were refused (`pointer-step`) while a pointer was a tag — "the byte-addressable view" for a step off a single
// variable, "whole elements of its array" for a step that is not one. MODEL 3 (design.md §3.3 step 4d) IS that view:
// a pointer is a byte address and steps by bytes (`pointer_step_past_end`, `pointer_byte_walk_struct_padding`), so a
// step of 3 bytes into a DINT array reads the DINT whose bytes start there, little-endian.
test("a stepped pointer steps BYTES — off a single variable, and by less than an element", () => {
  const single =
    `PROGRAM P\nVAR b : BOOL; p : POINTER TO BOOL; q : POINTER TO BOOL; END_VAR\n` +
    `p := ADR(b);\nq := p + 1;\nEND_PROGRAM\n`
  expect(lowerSource(single, "P").diagnostics).toEqual([])

  const arr =
    `PROGRAM P\nVAR xs : ARRAY[0..3] OF DINT := [16#44332211, 16#08776655, 0, 0]; p : POINTER TO DINT; q : POINTER TO DINT; v : DINT; END_VAR\n` +
    `p := ADR(xs[0]);\nq := p + 3;\nv := q^;\nEND_PROGRAM\n`
  const runner = run(ir(arr, "P"))
  runner.scan()
  expect(runner.get("v")).toBe(0x77665544n)
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
