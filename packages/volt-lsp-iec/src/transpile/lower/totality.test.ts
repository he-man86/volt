/**
 * LOWERING IS TOTAL FOR SHAPES THE CORPUS DOES NOT CONTAIN.
 *
 * `src/transpile/index.ts` states the contract: invalid input ends in a `LowerDiagnostic`, never a throw and never
 * an invented meaning. `test/conformance/lowering-totality.test.ts` gates that over 29k files of real customer
 * code — which is evidence, not proof. Real engineers do not write a year 300000 and do not step a pointer over a
 * struct with no fields; a transpiler other people depend on meets both anyway. These live here, beside the code
 * that answers them, rather than in the corpus gate that cannot reach them.
 *
 * Each asserts BOTH halves of the contract — that it does not throw, AND that it does not quietly mean something
 * else. The second half is not decoration: the first fix for the date literal returned `undefined`, which fell
 * through to the string branch (a date literal's AST value IS the string "300000-01-01") and turned
 * `D#300000-01-01` into a STRING constant with no diagnostic at all. Trading a loud crash for a silent wrong
 * answer is a worse bug than the one being fixed, and only an assertion about the DIAGNOSTIC catches it.
 *
 * Found by review 2026-09-17.
 */
import { describe, expect, test } from "bun:test"
import { lowerSource } from "./index.js"

describe("the shapes the corpus cannot reach", () => {
  const lowered = (pou: string, src: string): { codes: string[]; threw: string | null } => {
    try {
      return { codes: lowerSource(src, pou, []).diagnostics.map((d) => d.code), threw: null }
    } catch (error) {
      return { codes: [], threw: (error as Error).message }
    }
  }

  test("a date literal past JS Date's range is reported, not thrown, and is not silently a string", () => {
    // `Date.UTC` answers NaN past about year 275760 and `BigInt(NaN)` throws
    for (const src of [
      "PROGRAM P\nVAR\n\td : DATE;\nEND_VAR\nd := D#300000-01-01;\nEND_PROGRAM\n",
      "PROGRAM P\nVAR\n\td : DATE := D#300000-01-01;\nEND_VAR\nEND_PROGRAM\n", // the initializer path is a second site
    ]) {
      const r = lowered("P", src)
      expect(r.threw).toBeNull()
      expect(r.codes).toEqual(["bad-literal"])
    }
  })

  test("a pointer stepped over an element occupying no bytes is reported, not divided by", () => {
    // `byteSize` legitimately answers 0 for a struct with no laid-out fields; `% 0n` throws on BigInt
    const r = lowered(
      "Q",
      "TYPE EMPTY : STRUCT END_STRUCT END_TYPE\n\nPROGRAM Q\nVAR\n\tarr : ARRAY[0..2] OF EMPTY;\n" +
        "\tp : POINTER TO EMPTY;\n\tq : POINTER TO EMPTY;\nEND_VAR\np := ADR(arr[0]);\nq := p + 4;\nEND_PROGRAM\n",
    )
    expect(r.threw).toBeNull()
    expect(r.codes).toContain("pointer-step")
  })

  test("the ordinary temporal literals still lower, so the refusal did not widen", () => {
    expect(lowered("R", "PROGRAM R\nVAR\n\td : DATE := D#2026-09-17;\nEND_VAR\nd := D#2000-01-01;\nEND_PROGRAM\n")).toEqual({
      codes: [],
      threw: null,
    })
    expect(lowered("T", "PROGRAM T\nVAR\n\tt : TIME := T#1S;\nEND_VAR\nt := T#2M3S;\nEND_PROGRAM\n")).toEqual({
      codes: [],
      threw: null,
    })
  })
})
