/**
 * Lowering tests of `enums.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

/**
 * AN ENUM WHOSE FIRST ENUMERATOR IS NOT 0 IS REFUSED, not started at 0.
 *
 * A variable of an enum starts at its FIRST enumerator. Lowering started every enum at 0 — which for
 * `(Reverse := -1, Neutral := 0)` or `(DEVICE := 101, …)` is not even a value of the type. 446 corpus enum types
 * declare a non-zero first enumerator, 21 of them in project source, and 15 corpus BODIES were lowering on that
 * wrong start (pro2193's `L_IMHP_ComponentType` = 101, `PlcDataType` = 23, `enumRecipeCommandResult` = 257).
 *
 * Nothing measured it: every enum fixture starts at 0 and assigns explicitly before reading. So this is refused on
 * exactly the grounds the type-level default (`TYPE E : (A, B) := B`) already was — a guess is worse than a gap —
 * and `type_enum_default_*` record the answer. Refusing cost 9 of 55 lowering bodies, which is reach that had been
 * bought with a wrong value.
 */
/**
 * WHERE AN UNINITIALIZED ENUM VARIABLE STARTS — measured on CODESYS 3.5.21.40, 2026-09-18.
 *
 * **Zero if zero is one of the values; otherwise the FIRST enumerator.** Neither half was guessable, and the shape
 * that decides it is the one nobody writes down: an enum whose members STRADDLE zero starts at the member that IS
 * zero, even when another is declared first.
 *
 * Lowering used to start every enum at 0, which for `(Forward := 1, Reverse := 2)` is a value the type does not have;
 * then it refused the shape while unmeasured, which cost 9 of 55 corpus bodies. `type_enum_default_*` ended both.
 */
describe("an enum's default", () => {
  test("no member is zero — the FIRST enumerator", () => {
    const r = lowerSource("TYPE Mode : (Forward := 1, Reverse := 2);\nEND_TYPE\n\nPROGRAM PLC_PRG\nVAR\n\tm : Mode;\n\tx : DINT;\nEND_VAR\nx := m;\nEND_PROGRAM\n", "PLC_PRG")
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    expect(p.get("x")).toBe(1n)
  })
  test("a member IS zero — zero, even though another is declared first", () => {
    const r = lowerSource("TYPE Dir : (Reverse := -1, Neutral := 0, Forward := 1);\nEND_TYPE\n\nPROGRAM PLC_PRG\nVAR\n\td : Dir;\n\tx : DINT;\nEND_VAR\nx := d;\nEND_PROGRAM\n", "PLC_PRG")
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    expect(p.get("x")).toBe(0n)
  })
  test("a zero that is declared LAST still wins", () => {
    const r = lowerSource("TYPE Level : (High := 10, None := 0);\nEND_TYPE\n\nPROGRAM PLC_PRG\nVAR\n\tl : Level;\n\tx : DINT;\nEND_VAR\nx := l;\nEND_PROGRAM\n", "PLC_PRG")
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    expect(p.get("x")).toBe(0n)
  })
  test("an enum with no written values starts at zero", () => {
    const r = lowerSource("TYPE Mode : (Idle, Busy);\nEND_TYPE\n\nPROGRAM PLC_PRG\nVAR\n\tm : Mode;\n\tx : DINT;\nEND_VAR\nx := m;\nEND_PROGRAM\n", "PLC_PRG")
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    expect(p.get("x")).toBe(0n)
  })
  test("an INLINE enum follows the same rule", () => {
    const r = lowerSource("PROGRAM PLC_PRG\nVAR\n\tm : (Forward := 1, Reverse := 2);\n\tx : DINT;\nEND_VAR\nx := m;\nEND_PROGRAM\n", "PLC_PRG")
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    expect(p.get("x")).toBe(1n)
  })
})
