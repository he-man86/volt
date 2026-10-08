/**
 * Lowering tests of `prepare.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

/**
 * A DECLARATION FILE THAT DOES NOT PARSE IS REPORTED, not built on.
 *
 * `lowerSource` returns the MAIN source's parse errors, but a library's or a GVL's were dropped and the half-parsed
 * file went into the symbol table regardless. The failure then resurfaced downstream wearing someone else's name: a
 * GVL whose `gN : INT := 7` is missing its semicolon reported `aggregate-init: an aggregate initializer of a shape
 * lowering does not recognise` and `place-not-local: gN is a gvl_var, which has no frame slot yet` — neither true,
 * and neither naming the file that is actually broken.
 */
describe("a library or GVL file that does not parse", () => {
  const PROGRAM = "PROGRAM PLC_PRG\nVAR\n\ta : INT;\nEND_VAR\na := gN;\nEND_PROGRAM\n"

  test("is reported as a parse error naming the file, not as a downstream gap", () => {
    const r = lowerSource(PROGRAM, "PLC_PRG", [{ uri: "file:///p/App/G.gvl", source: "VAR_GLOBAL\n\tgN : INT := 7\nEND_VAR\n" }])
    expect(r.pou).toBeUndefined()
    expect(r.diagnostics.map((d) => d.code)).toEqual(["parse"])
    expect(r.diagnostics[0]!.message).toContain("G.gvl")
  })

  test("and the same GVL, parsing, still lowers", () => {
    const r = lowerSource(PROGRAM, "PLC_PRG", [{ uri: "file:///p/App/G.gvl", source: "VAR_GLOBAL\n\tgN : INT := 7;\nEND_VAR\n" }])
    expect(r.diagnostics).toEqual([])
    const p = run(r.pou!)
    p.scan()
    expect(p.get("a")).toBe(7n)
  })
})
