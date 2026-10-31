/**
 * The operand-survival oracle, checked against itself. Needs no bridge.
 *
 * <p>`expectNoOperandsLost` is the only assertion in this suite that compares what was PUSHED to what came
 * back, and it is deliberately loose — a body is legitimately reformatted on the way through the IDE. Loose
 * assertions rot into vacuous ones, which is precisely how the graphical round-trip evidence in this repo
 * managed to stay green over a body it was destroying. So the three loss shapes the audit actually measured
 * are pinned here as cases the oracle MUST refuse, and the rewrites measured against the live IDEs are
 * pinned as cases it must accept. (Plain-ST network text since openspec network-text-st: a network opens with its
 * `%NETWORK` line, a wire is `w<n>`, declared on its `VAR` line.)</p>
 */
import { describe, it, expect } from "bun:test"
import { expectNoOperandsLost } from "../e2e/harness"
const wrap = (lang: string, b: string) => `PROGRAM P\nVAR\nEND_VAR\n%LANGUAGE ${lang}\n${b}\n\nEND_PROGRAM\n`
describe("oracle self-check", () => {
	it("catches an unconsumed block deleted by the writer", () => {
		expect(() => expectNoOperandsLost(
			wrap("LD", "%NETWORK\ntmr(IN := a, PT := T#5S);\nout := b;"),
			wrap("LD", "%NETWORK\nout := b;"))).toThrow()
	})
	it("catches a jump's discarded condition spine", () => {
		expect(() => expectNoOperandsLost(
			wrap("LD", "%NETWORK\nJMP.done := a AND b;"),
			wrap("LD", "%NETWORK\nJMP.done := RAIL();"))).toThrow()
	})
	it("catches an FB instance type written as empty", () => {
		expect(() => expectNoOperandsLost(
			wrap("FBD", "%NETWORK\nout := fbUp(CLK := a);"),
			wrap("FBD", "%NETWORK\nout := a;"))).toThrow()
	})
	it("tolerates reparenthesisation, a wire the importer folds into one assign, and rung splitting", () => {
		expectNoOperandsLost(
			wrap("LD", "%NETWORK\nVAR w1 : ANY; END_VAR\nw1 := NOT a AND b AND c;\nout := w1;\nq := w1;\nq2 := d;"),
			wrap("LD", "%NETWORK\nout := q := (NOT a AND b) AND c;\n%NETWORK\nq2 := d;"))
	})
})
