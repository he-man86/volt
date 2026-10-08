/**
 * Lowering tests of `library-base.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { libraryBase, lowerSource } from "../index.js"

describe("lower — a LIBRARY BASE (libraries bound once, each program bound on top and taken off)", () => {
  const lib = (name: string, source: string) => ({ uri: `Library Manager/Lib/${name}`, source })
  const F = lib("F.pou", "FUNCTION F : INT\nF := 7;\nEND_FUNCTION\n")
  const BASE_FB = lib("B.pou", "FUNCTION_BLOCK B\nVAR_OUTPUT n : INT; END_VAR\nn := 1;\nEND_FUNCTION_BLOCK\n")
  const DERIVED = lib("D.pou", "FUNCTION_BLOCK D EXTENDS B\nn := 2;\nEND_FUNCTION_BLOCK\n")
  const PROGRAM = "PROGRAM P\nVAR x : INT; d : D; y : INT; END_VAR\nx := F();\nd();\ny := d.n;\nEND_PROGRAM\n"
  /** What a base's table IS, as lowering reads it: its units in order, and what each one extends. */
  const shape = (base: ReturnType<typeof libraryBase>) => base.prepared.project.children.map((c) => `${c.defUri}:${c.name}->${c.baseScope?.defUri ?? "-"}`)

  test("a program lowers against it as against the files handed in whole — and leaves it as it was", () => {
    const base = libraryBase([F, BASE_FB, DERIVED])
    const before = shape(base)
    const onBase = lowerSource(PROGRAM, "P", [], "p.pou", base)
    expect(onBase.diagnostics).toEqual([])
    expect(shape(base)).toEqual(before)
    const p = run(onBase.pou!)
    p.scan()
    expect([p.get("x"), p.get("y")]).toEqual([7n, 2n])
  })

  test("a program unit named like a base unit's EXTENDS target is relinked away again", () => {
    // `B` is not in the base, so D links to the PROGRAM's B while it is bound — and must not keep a link into a scope
    // that is gone once it is taken off (a library's own B would win the link, which would prove nothing)
    const base = libraryBase([F, DERIVED])
    const before = shape(base)
    lowerSource("FUNCTION_BLOCK B\nVAR_OUTPUT n : INT; END_VAR\nEND_FUNCTION_BLOCK\n" + PROGRAM, "P", [], "p.pou", base)
    expect(shape(base)).toEqual(before)
  })

  test("a file already in the base, or a manifest beside it, is a caller's mistake — said, not left to corrupt it", () => {
    const base = libraryBase([F])
    expect(() => lowerSource(PROGRAM, "P", [F], "p.pou", base)).toThrow("already bound in the library base")
    const manifest = { uri: "Library Manager/Lib/Lib.library", source: "LIBRARY Lib\nNAMESPACE Lib\nRESOLUTION Lib, 1.0.0.0 (x)\n" }
    expect(() => lowerSource(PROGRAM, "P", [manifest], "p.pou", base)).toThrow(".library manifest")
    // and the base is whole after both
    expect(lowerSource("PROGRAM P\nVAR x : INT; END_VAR\nx := F();\nEND_PROGRAM\n", "P", [], "p.pou", base).diagnostics).toEqual([])
  })
})
