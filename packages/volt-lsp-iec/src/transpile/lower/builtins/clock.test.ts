/**
 * Lowering tests of `clock.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { CLOCK } from "../builtins/clock.js"
import { lowerSource } from "../index.js"

describe("lower — the clock, TIME() and LTIME()", () => {
  // CODESYS's operators, not a library's: `cs_clock_reads` builds with no library at all. What time it is belongs to
  // whoever runs the program, so both read one LTIME global (`CLOCK`, nanoseconds) the harness sets per scan.
  const clocked = (body: string) => {
    const p = run(lowerSource(`PROGRAM P\nVAR t : TIME; long : LTIME; END_VAR\n${body}\nEND_PROGRAM\n`, "P").pou!)
    p.set(CLOCK, 1_500_250_000n)
    p.scan()
    return p
  }

  test("LTIME() is the clock, and TIME() the same instant in milliseconds", () => {
    const p = clocked("t := TIME(); long := LTIME();")
    expect([p.get("t"), p.get("long")]).toEqual([1500n, 1_500_250_000n])
  })

  test("TIME() wraps as a 32-bit count of milliseconds, as the PLC's does after 49.7 days", () => {
    const p = run(lowerSource("PROGRAM P\nVAR t : TIME; END_VAR\nt := TIME();\nEND_PROGRAM\n", "P").pou!)
    p.set(CLOCK, (2n ** 32n + 7n) * 1_000_000n)
    p.scan()
    expect(p.get("t")).toBe(7n)
  })

  test("the clock is keyed by a name no identifier can spell, and no GVL variable can be called like it", () => {
    // `__clock` is no name a declaration may hold: both vendors refuse a name with consecutive underscores
    // (`identifier_double_underscore`), and since frontend-conformance 2.8.3 so does the parser — the GVL does not parse
    const gvl = { uri: "GVL.gvl", source: "VAR_GLOBAL\n\t__clock : INT := 3;\nEND_VAR\n" }
    const { pou, diagnostics } = lowerSource("PROGRAM P\nVAR a : INT; t : TIME; END_VAR\nt := TIME();\nEND_PROGRAM\n", "P", [gvl])
    expect([pou, diagnostics.map((d) => d.message)]).toEqual([undefined, ["GVL.gvl did not parse: Unexpected token '__clock' found"]])
    const alone = lowerSource("PROGRAM P\nVAR a : INT; t : TIME; END_VAR\nt := TIME();\nEND_PROGRAM\n", "P").pou!
    expect(alone.globals.map((g) => g.type.kind === "elementary" && g.type.name)).toEqual(["LTIME"])
  })
})
