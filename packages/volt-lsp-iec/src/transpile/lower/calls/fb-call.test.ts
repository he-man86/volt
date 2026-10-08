/**
 * Lowering tests of `fb-call.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { lowerSource } from "../index.js"

/**
 * RUNNING AN FB'S BODY IS A CALL — `holdsCall` counts the `call` node.
 *
 * It counted `invoke` (a FUNCTION or METHOD) and `dispatch` (through an interface) but not `call` (an FB instance's
 * body). That made `fb-init-program` blind to the plainest case it exists to refuse: whether a PROGRAM's FB_Init runs
 * at all is not recorded, so one that calls anything is refused — yet a PROGRAM whose FB_Init ran another FB's BODY
 * lowered with no diagnostic, while the identical FB_Init calling a METHOD was refused.
 *
 * The expression callers are unaffected — a FOR limit or step, an invoke's inputs — because a `call` is a statement
 * and never appears inside an expression.
 */
describe("an FB body call counts as a call", () => {
  test("a PROGRAM whose FB_Init runs another FB's body is refused", () => {
    const r = lowerSource("FUNCTION_BLOCK FB_Inner\nVAR_OUTPUT\n\tq : INT;\nEND_VAR\nq := q + 1;\nEND_FUNCTION_BLOCK\n\nPROGRAM P\nVAR\n\tinner : FB_Inner;\n\tseen : INT;\nEND_VAR\nseen := inner.q;\nEND_PROGRAM\n\nMETHOD FB_Init : BOOL\nVAR_INPUT\n\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\nEND_VAR\ninner();\nEND_METHOD\n", "P")
    expect(r.pou).toBeUndefined()
    expect(r.diagnostics.map((d) => d.code)).toContain("fb-init-program")
  })

  test("and one whose FB_Init touches only its own variables still lowers", () => {
    const r = lowerSource("PROGRAM P\nVAR\n\tn : INT;\n\tseen : INT;\nEND_VAR\nseen := n;\nEND_PROGRAM\n\nMETHOD FB_Init : BOOL\nVAR_INPUT\n\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\nEND_VAR\nn := 5;\nEND_METHOD\n", "P")
    expect(r.diagnostics).toEqual([])
    expect(r.pou).toBeDefined()
  })
})
