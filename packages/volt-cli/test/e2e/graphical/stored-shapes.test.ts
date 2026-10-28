/**
 * EVERY STORED SHAPE THAT RUNS, LIVE (openspec ld-fbd-coverage 2R.5): the rows of `awkward-sweep.md` the IDE stores and
 * runs, each spelled by a rule that already exists once its refusal clause went (design "2R.5") — pushed as the text
 * spells it, pulled back exactly, pushed again: a fixed point, and a clean build.
 *
 * The offline case set (`test/fixtures/network-text/accept/r5-stored-shapes.cases`) proves the text reads to the model
 * and writes back; only the IDE can say whether it KEEPS what the push builds — a target's own bits beside a jump, an
 * edge on a pin and on the EN pin through `SetInputFlag`, the named ENO's variable on the ENO slot — and whether it
 * compiles. The build answers are the conformance fixtures `ng_r5_*` (volt-lsp-iec, `network-graphical-e.ts`).
 *
 * On TwinCAT the same invariant, not the same outcome: a shape no TwinCAT build has been measured for is REFUSED by name
 * before anything is built (`TcUnmeasured`, the native builder), never accepted and reshaped; one the native writer
 * builds (openspec twincat-inproc-host) round-trips and builds here as on CODESYS.
 */
import { describe, beforeAll, setDefaultTimeout } from "bun:test"
import { id, fid, requireHealthy, VENDOR, BASE } from "../harness"
import { itGapped, PLATFORM_GAPS } from "../lib/platform"
import { expectRoundTrip, expectRoundTripOrRefusal } from "../lib/roundtrip"
import { ensureCompiles, withMainProgramRestored } from "../lib/compile"
import { removeItem } from "../lib/workspace"

/** On a CODESYS version that cannot take an LD/FBD write, every test here must end in that refusal (lib/platform.ts). */
const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(120_000)

/** A FUNCTION_BLOCK holding `networks` in `lang`, with every variable the rows reference. */
function fb(name: string, lang: "FBD" | "LD", networks: readonly string[], vars = ""): string {
	const body = networks.map((n) => `%NETWORK\n${n}\n`).join("")
	return (
		`FUNCTION_BLOCK ${name}\nVAR\n\tc : BOOL;\n\td : BOOL;\n\tone : BOOL := TRUE;\n\tx : BOOL;\n\tx1 : BOOL;\n\ty : BOOL;\n` +
		`\tlamp : BOOL;\n\ta : BOOL;\n\tb : BOOL;\n\ti : INT;\n\tj : INT;\n\tv : INT := 50;\n${vars}END_VAR\n` +
		`%LANGUAGE ${lang}\n${body}\nEND_FUNCTION_BLOCK\n`
	)
}

/** Round-trips and builds on CODESYS; on TwinCAT round-trips or is refused naming `twincatRefusal`. */
async function shape(key: string, src: (name: string) => string, twincatRefusal?: string): Promise<void> {
	const name = id(key)
	const item = fid(key, "pou")
	try {
		const text = src(name)
		if (VENDOR === "twincat" && twincatRefusal !== undefined) {
			if ((await expectRoundTripOrRefusal(item, text, twincatRefusal)) === "refused") return
		} else await expectRoundTrip(item, text)
		await withMainProgramRestored(() => ensureCompiles(name))
	} finally {
		await removeItem(item)
	}
}

describe(`graphical / stored shapes, ld-fbd-coverage 2R.5 (${BASE})`, () => {
	beforeAll(async () => {
		await requireHealthy()
	})

	it("#1: one box consuming two ENOs", async () => {
		await shape("r5eno2", (n) => fb(n, "LD", ["x := MOVE_EN(EN := c, 1, OUT => i) AND MOVE_EN(EN := d, 2, OUT => j);"]), TC.twoEno)
	})

	// #9–#14 (a jump or a return among coils, with S=, nested; a coil's negation and edge) have no plain-ST spelling to
	// push: jumps among coils wait on the owner (openspec network-text-st design.md "3.0"), and a negated or edge coil is a
	// stored member (`x := NOT c;`, `x := c;`) a push builds as the contact it spells.

	it("#15, #16, #6a: an edge on a contact in a box, a negated EN contact, a negated rail", async () => {
		await shape("r5ep", (n) => fb(n, "FBD", ["x := AND(R_EDGE(c), one);"]), TC.edgePin)
		await shape("r5ne", (n) => fb(n, "FBD", ["MOVE_EN(EN := NOT c, 5, OUT => i);"]), TC.negatedEn)
		await shape("r5nt", (n) => fb(n, "LD", ["x := NOT TRUE;"]), TC.negatedEmpty)
	})

	it("#17: an element of an array of FBs heads its call", async () => {
		await shape("r5af", (n) => fb(n, "FBD", ["fbs[1](CU := c, PV := 10, CV => i);"], "\tfbs : ARRAY [1..2] OF CTU;\n"), TC.arrayInstance)
	})

	it("#19, #20: a wire read above its definition, and one defined below the top level", async () => {
		await shape("r5sb", (n) => fb(n, "LD", ["%WIRES w1\nx := w1;\nw1 := a AND b;\ny := w1 AND c;"]), TC.splitBefore)
		await shape("r5sn", (n) => fb(n, "LD", ["%WIRES w1\nx := (w1 := a AND b);\ny := w1 AND c;"]), TC.splitNested)
	})

	it("Open c: a shorted branch of a parallel is the rail, TRUE", async () => {
		await shape("r5eb", (n) => fb(n, "LD", ["x := BRANCH(FEED := c, a, TRUE);", "y := BRANCH(FEED := c, a, TRUE, b);"]), TC.emptyBranch)
	})

	it("#22, #23, #26: a comparison's ENO, the named ENO pin, an enabled comparison as a value", async () => {
		await shape("r5ce", (n) => fb(n, "LD", ["lamp := GT_EN(EN := c, v, 5, OUT => x);"]), TC.comparisonEno)
		await shape("r5ne2", (n) => fb(n, "FBD", ["MOVE_EN(EN := c, 7, ENO => lamp, OUT => i);"]), TC.namedEno)
		await shape("r5cv", (n) => fb(n, "FBD", ["%WIRES w1\nGT_EN(EN := c, v, 40, OUT => w1);\nx := AND(a, w1);"]), TC.comparisonValue)
	})
})

/** TwinCAT's refusals, by the words `TcUnmeasured` and the native builder name them — undefined where the shape is
 *  expected to round-trip. (The four the PLCopen lowering refused — a result pin, a nested jump, an output pin of an
 *  array element's call, a named ENO — the native writer builds, measured here.) */
const TC: Record<string, string | undefined> = {
	twoEno: undefined,
	edgePin: "a modifier on its input pin",
	negatedEn: "a modifier on the EN pin",
	negatedEmpty: "a negated empty slot",
	arrayInstance: undefined,
	splitBefore: "referenced above its definition",
	splitNested: "defined below the top level",
	comparisonEno: undefined,
	namedEno: undefined,
	comparisonValue: undefined,
	emptyBranch: "a parallel branch",
}
