/**
 * The operand-survival oracle, checked against itself. Needs no bridge.
 *
 * <p>`expectNoOperandsLost` is the only assertion in this suite that compares what was PUSHED to what came
 * back, and it is deliberately loose — a body is legitimately reformatted on the way through the IDE. Loose
 * assertions rot into vacuous ones, which is precisely how the graphical round-trip evidence in this repo
 * managed to stay green over a body it was destroying. So the three loss shapes the audit actually measured
 * are pinned here as cases the oracle MUST refuse, and the four rewrites measured against live CODESYS are
 * pinned as cases it must accept.</p>
 */
import { describe, it, expect } from "bun:test"
import { expectNoOperandsLost } from "../e2e/harness"
const wrap = (b: string) => `PROGRAM P\nVAR\nEND_VAR\n\n${b}\nEND_PROGRAM\n`
describe("oracle self-check", () => {
	it("catches an unconsumed block deleted by the writer", () => {
		expect(() => expectNoOperandsLost(
			wrap("NETWORK 0 LD\n  tmr(IN := a, PT := T#5S);\n  out := b;\nEND_NETWORK"),
			wrap("NETWORK 0 LD\n  out := b;\nEND_NETWORK"))).toThrow()
	})
	it("catches a jump's discarded condition spine", () => {
		expect(() => expectNoOperandsLost(
			wrap("NETWORK 0 LD\n  IF (a AND b) THEN JMP done; END_IF\nEND_NETWORK"),
			wrap("NETWORK 0 LD\n  JMP done;\nEND_NETWORK"))).toThrow()
	})
	it("catches an FB instance type written as empty", () => {
		expect(() => expectNoOperandsLost(
			wrap("NETWORK 0 FBD\n  fbUp(CLK := a);\n  out := fbUp.Q;\nEND_NETWORK"),
			wrap("NETWORK 0 FBD\n  out := a;\nEND_NETWORK"))).toThrow()
	})
	it("tolerates reparenthesisation, LET inlining, renumbering and rung splitting", () => {
		expectNoOperandsLost(
			wrap("NETWORK 0 LD\n  LET i1 := NOT a;\n  out := (i1 AND b AND c);\n  r := d;\nEND_NETWORK"),
			wrap("NETWORK 1 LD\n  out := ((NOT a AND b) AND c);\nEND_NETWORK\nNETWORK 2 LD\n  r := d;\nEND_NETWORK"))
	})
})
