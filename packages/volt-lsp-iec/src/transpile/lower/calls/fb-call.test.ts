/**
 * Lowering tests of `fb-call.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { describe, expect, test } from "bun:test"
import { lowerSource } from "../index.js"
import { run } from "../../interp/index.js"

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

// transpile-restructure 6.A.19 (Appendix A grouped): an FB body call binds each in-out WHERE IT IS WRITTEN, as the routine
// path does — `fb(io := arr[i], inp := Bump(i))` arr[0], `fb(inp := Bump(j), io := arr[j])` arr[1]
// (`tr_a19_fb_call_inout_beside_moving_input`, record:exec 2026-10-10: 101, 201). It was refused `call-inout-order`.
test("an FB call binds an in-out where it is written, before or after an input that moves its index", () => {
  const source =
    "FUNCTION F_Bump : INT\nVAR_IN_OUT k : INT; END_VAR\nk := k + 1;\nF_Bump := k;\nEND_FUNCTION\n" +
    "FUNCTION_BLOCK FB_O\nVAR_INPUT inp : INT; END_VAR\nVAR_IN_OUT io : INT; END_VAR\nVAR_OUTPUT seen : INT; END_VAR\nseen := io * 100 + inp;\nEND_FUNCTION_BLOCK\n" +
    "PROGRAM P\nVAR a : FB_O; b : FB_O; arr : ARRAY[0..3] OF INT := [1, 2, 3, 4]; i : INT; j : INT; s1 : INT; s2 : INT; END_VAR\n" +
    "a(io := arr[i], inp := F_Bump(i), seen => s1);\nb(inp := F_Bump(j), io := arr[j], seen => s2);\nEND_PROGRAM\n"
  const { pou, diagnostics } = lowerSource(source, "P")
  expect(diagnostics).toEqual([])
  const runner = run(pou!)
  runner.scan()
  expect([runner.get("s1"), runner.get("s2")]).toEqual([101n, 201n])
})
