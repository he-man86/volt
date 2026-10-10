/**
 * Lowering tests of `places.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { lowerSource } from "../index.js"
import { run } from "../../interp/index.js"

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

const wrap = (body: string, vars = "iCount : INT;") => `PROGRAM P\nVAR\n  ${vars}\nEND_VAR\n${body}\nEND_PROGRAM\n`

describe("lower — STRING (design §18)", () => {
  test("a STRING slot carries its capacity — 80 when sizeless, as measured", () => {
    const pou = ir(wrap("iCount := 1;", "iCount : INT;\n  plain : STRING;\n  five : STRING(5);"))
    expect(pou.slots.slice(1).map((s) => s.type.kind === "elementary" && s.type.length)).toEqual([80, 5])
  })

  test("a string initializer is folded into the slot with its measured escapes decoded", () => {
    const pou = ir(wrap("iCount := 1;", "iCount : INT;\n  text : STRING := 'x$Ty$$z$N$41$'';"))
    expect(pou.slots[1]!.init).toBe("x\ty$z\nA'")
  })

  test("an escape not measured is refused, not guessed", () => {
    const { diagnostics } = lowerSource(wrap("text := '$Q';", "text : STRING;"))
    expect(diagnostics.map((d) => d.code)).toEqual(["string-escape"])
  })

  test("a sizeless WSTRING holds 80, like STRING, and its four-digit escape is one UTF-16 unit", () => {
    // This first asserted a non-ASCII WSTRING literal is refused, pending `wstring_code_units`; that case has been
    // recorded — "h$00E9llo" equals "héllo", one unit per character — so the premise no longer holds.
    const pou = ir(wrap("iCount := 1;", "iCount : INT;\n  wide : WSTRING := \"h$00E9llo\";"))
    expect(pou.slots[1]!.type.kind === "elementary" && pou.slots[1]!.type.length).toBe(80)
    expect(pou.slots[1]!.init).toBe("héllo")
  })

  test("a non-ASCII character typed into a STRING is refused — which byte it becomes is not measured", () => {
    const { diagnostics } = lowerSource(wrap("iCount := 1;", "iCount : INT;\n  text : STRING := 'héllo';"))
    expect(diagnostics.map((d) => d.code)).toEqual(["string-non-ascii"])
  })
})

/**
 * `r.3` ON A REFERENCE IS A BIT OF WHAT IT REFERENCES (transpile-restructure 4.13 (d)) — implicitly dereferenced, as `r.x`
 * and `r[i]` already were. It was refused `bit-on-reference`. Recorded: conformance `reference_bit_access` (bit 3 TRUE,
 * bit 2 FALSE, and after `r.0 := TRUE; r.3 := FALSE` the WORD is 1) and `_local` (a FUNCTION's reference, a tag).
 */
describe("a bit through a REFERENCE", () => {
  test("is read and written on the referenced variable — one the image holds, and a FUNCTION's local", () => {
    const image = run(ir(wrap("w := 16#0008;\nrw REF= w;\nb3 := rw.3;\nb2 := rw.2;\nrw.0 := TRUE;\nrw.3 := FALSE;", "w : WORD; rw : REFERENCE TO WORD; b3 : BOOL; b2 : BOOL;"), "P"))
    image.scan()
    expect([image.get("b3"), image.get("b2"), image.get("w")]).toEqual([true, false, 1n])
    const local =
      "PROGRAM P\nVAR b3 : BOOL; after : WORD; END_VAR\nb3 := F(after => after);\nEND_PROGRAM\n\n" +
      "FUNCTION F : BOOL\nVAR_OUTPUT after : WORD; END_VAR\nVAR w : WORD := 16#0008; rw : REFERENCE TO WORD; END_VAR\nrw REF= w;\nF := rw.3;\nrw.0 := TRUE;\nafter := w;\nEND_FUNCTION\n"
    const tagged = run(ir(local, "P"))
    tagged.scan()
    expect([tagged.get("b3"), tagged.get("after")]).toEqual([true, 9n])
  })
})

// transpile-restructure 6.A.17 (Appendix A grouped): one name in two plain lists is TWO variables, each reached qualified by
// its own list. Every plain list's variable was keyed by its bare name, so `GVL1.g` and `GVL2.g` shared one slot — the
// second list read the first's value and saw its writes (`tr_a17_two_lists_one_name_both_qualified`, CODESYS 3, 5, 5).
test("the same name in two plain lists is two globals, each reached through its own list", () => {
  const lists = [
    { uri: "file:///GVL_One.gvl", source: "VAR_GLOBAL\n\tg : INT := 3;\nEND_VAR\n" },
    { uri: "file:///GVL_Two.gvl", source: "VAR_GLOBAL\n\tg : INT := 5;\nEND_VAR\n" },
  ]
  const { pou, diagnostics } = lowerSource(
    "PROGRAM P\nVAR outA : INT; outB : INT; afterB : INT; END_VAR\noutA := GVL_One.g;\noutB := GVL_Two.g;\nGVL_One.g := 7;\nafterB := GVL_Two.g;\nEND_PROGRAM\n",
    "P",
    lists,
  )
  expect(diagnostics).toEqual([])
  const runner = run(pou!)
  runner.scan()
  expect([runner.get("outA"), runner.get("outB"), runner.get("afterB")]).toEqual([3n, 5n, 5n])
})
