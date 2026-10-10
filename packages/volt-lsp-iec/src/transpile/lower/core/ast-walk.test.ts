/**
 * `overridesCalled` (transpile-restructure 6.A.11, Appendix A): `SUPER^.M()` calls the BASE's M — never an override below
 * the routine's own chain — so it does not reach the frame's in-outs. It was looked up against the FRAME, found the leaf's
 * override, and bound the leaf's VAR_IN_OUT into a middle METHOD that never reaches it: unbound on the instance, the call
 * faulted where CODESYS runs it (`tr_a11_super_method_on_overriding_leaf`, record:exec 2026-10-10: hits 1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

const SOURCE = [
  "FUNCTION_BLOCK Base\nVAR hits : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Hit\nhits := hits + 1;\nEND_METHOD\n",
  "FUNCTION_BLOCK Mid EXTENDS Base\nEND_FUNCTION_BLOCK\nMETHOD Hit\nhits := hits + 100;\nEND_METHOD\nMETHOD Run\nSUPER^.Hit();\nEND_METHOD\n",
  "FUNCTION_BLOCK Leaf EXTENDS Mid\nVAR_IN_OUT io : INT; END_VAR\nio := io + 1;\nEND_FUNCTION_BLOCK\nMETHOD Hit\nio := io + 1000;\nEND_METHOD\n",
  "PROGRAM P\nVAR leaf : Leaf; END_VAR\nleaf.Run();\nEND_PROGRAM\n",
].join("\n")

test("SUPER^.M() from a middle METHOD runs the base's M, binding none of the leaf's in-outs", () => {
  const { pou, diagnostics } = lowerSource(SOURCE, "P")
  expect(diagnostics).toEqual([])
  const runner = run(pou!)
  runner.scan()
  expect(runner.get("leaf.hits")).toBe(1n)
})
