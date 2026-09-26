/**
 * The operand-survival oracle, checked against itself. Needs no bridge.
 *
 * <p>`expectNoOperandsLost` is the only assertion in this suite that compares what was PUSHED to what came
 * back, and it is deliberately loose — a body is legitimately reformatted on the way through the IDE. Loose
 * assertions rot into vacuous ones, which is precisely how the graphical round-trip evidence in this repo
 * managed to stay green over a body it was destroying. So the three loss shapes the audit actually measured
 * are pinned here as cases the oracle MUST refuse, and the rewrites measured against the live IDEs are
 * pinned as cases it must accept. (Network text v2 since task 4.4: the language rides on the body marker, the
 * header has no number, and a wire is declared in its network's VAR_TEMP block.)</p>
 */
import { describe, it, expect } from "bun:test"
import { expectNoOperandsLost } from "../e2e/harness"
const wrap = (lang: string, b: string) => `PROGRAM P\nVAR\nEND_VAR\n(* @volt-implementation ${lang} *)\n${b}\n\nEND_PROGRAM\n`
describe("oracle self-check", () => {
	it("catches an unconsumed block deleted by the writer", () => {
		expect(() => expectNoOperandsLost(
			wrap("LD", "NETWORK\n  tmr(IN := a, PT := T#5S);\n  out := b;\nEND_NETWORK"),
			wrap("LD", "NETWORK\n  out := b;\nEND_NETWORK"))).toThrow()
	})
	it("catches a jump's discarded condition spine", () => {
		expect(() => expectNoOperandsLost(
			wrap("LD", "NETWORK\n  IF (a AND b) THEN JMP done; END_IF;\nEND_NETWORK"),
			wrap("LD", "NETWORK\n  JMP done;\nEND_NETWORK"))).toThrow()
	})
	it("catches an FB instance type written as empty", () => {
		expect(() => expectNoOperandsLost(
			wrap("FBD", "NETWORK\n  fbUp(CLK := a);\n  out := fbUp.Q;\nEND_NETWORK"),
			wrap("FBD", "NETWORK\n  out := a;\nEND_NETWORK"))).toThrow()
	})
	it("tolerates reparenthesisation, a wire the importer folds into one assign, and rung splitting", () => {
		expectNoOperandsLost(
			wrap("LD", "NETWORK\n  VAR_TEMP g1 : BOOL; END_VAR\n  g1 := (NOT a AND b AND c);\n  out := g1;\n  q := g1;\n  r := d;\nEND_NETWORK"),
			wrap("LD", "NETWORK\n  out :=\n  q := ((NOT a AND b) AND c);\nEND_NETWORK\nNETWORK\n  r := d;\nEND_NETWORK"))
	})
})
