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
