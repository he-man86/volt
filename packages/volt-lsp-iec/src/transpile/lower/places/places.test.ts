/**
 * Lowering tests of `places.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { lowerSource } from "../index.js"

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
