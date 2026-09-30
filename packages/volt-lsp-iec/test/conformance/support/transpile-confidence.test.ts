/**
 * transpile-review 48: `vendor` is the claim that a RECORDED VALUE came back out of the emitted Rust. A recording whose
 * every value is its type's default, from a program with no non-default constant in it, pins nothing — every variable
 * starts at its default, so a body that computes the wrong thing over zeros (or nothing at all) reads the same.
 */
import { describe, expect, test } from "bun:test"
import { ALL_TESTS } from "../fixtures/index.js"
import { assembleFixture } from "./fixture-units.js"
import { correctnessOf } from "./transpile-confidence.js"

const sourceOf = (name: string): string => {
  const t = ALL_TESTS.find((x) => x.name === name)
  if (t === undefined) throw new Error(`no fixture ${name}`)
  const { source, gvls } = assembleFixture(t, ALL_TESTS)
  return [source, ...gvls.map((g) => g.source)].join("\n")
}
const rated = (name: string): string => correctnessOf(name, "confirmed", true, sourceOf(name))

describe("the vendor oracle needs a recording that discriminates", () => {
  test("all defaults out of all-default inputs is not vendor evidence (cc_ rows)", () => {
    expect(["cc_fp_neg_int_into_int", "cc_add_uint_int", "cc_max_udint_dint"].map(rated)).toEqual(["compiles", "compiles", "compiles"])
  })

  test("a prim_default_* fixture asks for exactly the default, so it keeps vendor", () => {
    expect(["prim_default_int", "prim_default_string"].map(rated)).toEqual(["vendor", "vendor"])
  })

  test("a default ANSWER from non-default constants discriminates, so it keeps vendor", () => {
    // LIMIT(100, 50, 0) = 0 (MX wins when MN > MX); a WHILE false on entry leaves 0; an attribute method that never runs
    expect(["limit_inverted_bounds", "stmt_while_never", "call_after_init"].map(rated)).toEqual(["vendor", "vendor", "vendor"])
  })

  test("a recording with a non-default value stays vendor", () => {
    expect(rated("cc_bitwise_sint_and_literal")).toBe("vendor")
  })
})
