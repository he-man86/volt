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
 * On TwinCAT the same invariant, not the same outcome: a shape no import has been measured for is REFUSED by name before
 * the PLCopen import (`TcUnmeasured`), never accepted and reshaped — its TwinCAT measurement is the native writer's
 * (openspec twincat-inproc-host).
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
	const body = networks.map((n) => `NETWORK${n.startsWith(" LABEL:") ? "" : "\n"}${n}\nEND_NETWORK\n`).join("")
	return (
		`FUNCTION_BLOCK ${name}\nVAR\n\tc : BOOL;\n\td : BOOL;\n\tone : BOOL := TRUE;\n\tx : BOOL;\n\tx1 : BOOL;\n\ty : BOOL;\n` +
		`\tlamp : BOOL;\n\ta : BOOL;\n\tb : BOOL;\n\ti : INT;\n\tj : INT;\n\tv : INT := 50;\n${vars}END_VAR\n` +
		`IMPLEMENTATION ${lang}\n${body}\nEND_FUNCTION_BLOCK\n`
	)
}

const labelled = (l: string): string => ` LABEL: ${l}\n  y := TRUE;`

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
		await shape("r5eno2", (n) => fb(n, "LD", ["  MOVE 1 => i EN c\n  MOVE 2 => j EN d\n  x := ENO AND ENO;"]), TC.twoEno)
	})

	it("#9–#12: a jump and a return are coils — beside a coil, two on a rung, with S=, nested", async () => {
		await shape("r5cj", (n) => fb(n, "LD", ["  x1 := JMP Done := c;", "  x := TRUE;", labelled("Done")]), TC.flowBeside)
		await shape("r5cr", (n) => fb(n, "LD", ["  x1 := RETURN := c;", "  x := TRUE;"]), TC.flowBeside)
		await shape("r5jj", (n) => fb(n, "LD", ["  JMP L1 := JMP L2 := c;", "  x := TRUE;", labelled("L1"), labelled("L2")]), TC.flowBeside)
		await shape("r5js", (n) => fb(n, "LD", ["  JMP Done S= c;", "  x := TRUE;", labelled("Done")]), TC.flowSet)
		await shape("r5rs", (n) => fb(n, "LD", ["  RETURN S= c;", "  x := TRUE;"]), TC.flowSet)
		await shape("r5jn", (n) => fb(n, "LD", ["  x := (JMP Done := c);", "  x1 := TRUE;", labelled("Done")]), TC.nestedJump)
	})

	it("#13, #14: a coil's negation and edge stand before it", async () => {
		await shape("r5nc", (n) => fb(n, "LD", ["  NOT x := c;"]), TC.negatedCoil)
		await shape("r5ec", (n) => fb(n, "LD", ["  R_EDGE x := c;", "  F_EDGE x1 := c;"]), TC.edgeCoil)
	})

	it("#15, #16, #6a: an edge on a pin, a negated EN pin, a negated empty slot", async () => {
		await shape("r5ep", (n) => fb(n, "FBD", ["  x := AND(R_EDGE IN1 := c, one);"]), TC.edgePin)
		await shape("r5ne", (n) => fb(n, "FBD", ["  MOVE 5 => i NOT EN c;"]), TC.negatedEn)
		await shape("r5nt", (n) => fb(n, "LD", ["  x := NOT ;"]), TC.negatedEmpty)
	})

	it("#17: an element of an array of FBs heads its call", async () => {
		await shape("r5af", (n) => fb(n, "FBD", ["  `fbs[1]`(CU := c, PV := 10, CV => i);"], "\tfbs : ARRAY [1..2] OF CTU;\n"), TC.arrayInstance)
	})

	it("#19, #20: a split referenced above its definition, and one defined below the top level", async () => {
		await shape("r5sb", (n) => fb(n, "LD", ["  x := split1;\n  split1 := a AND b;\n  y := split1 AND c;"]), TC.splitBefore)
		await shape("r5sn", (n) => fb(n, "LD", ["  x := (split1 := a AND b);\n  y := split1 AND c;"]), TC.splitNested)
	})

	it("Open c: an empty branch of a parallel", async () => {
		const col = " ".repeat(17)   // the branches one per line, under the first (P2)
		await shape("r5eb", (n) => fb(n, "LD", [`  x := c BRANCH (a,\n${col});`, `  y := c BRANCH (a,\n${col},\n${col}b);`]), TC.emptyBranch)
	})

	it("#22, #23, #26: a comparison's ENO, the named ENO pin, an enabled comparison as a value", async () => {
		await shape("r5ce", (n) => fb(n, "LD", ["  v GT 5 => x EN c\n  lamp := ENO;"]), TC.comparisonEno)
		await shape("r5ne2", (n) => fb(n, "FBD", ["  MOVE(7, ENO => lamp, => i) EN c;"]), TC.namedEno)
		await shape("r5cv", (n) => fb(n, "FBD", ["  x := a AND (v GT 40 EN c);"]), TC.comparisonValue)
	})
})

/** TwinCAT's refusals, by the words `TcUnmeasured` (and the PLCopen lowering) name them — undefined where the shape is
 *  expected to round-trip. */
const TC: Record<string, string | undefined> = {
	twoEno: "the result pin `=> i` of the 'MOVE' box",
	flowBeside: "a jump or a return beside another coil on one rung",
	flowSet: "a jump or a return with S= or R=",
	nestedJump: "an assignment to 'Done' below the top level",
	negatedCoil: "a negated coil on 'x'",
	edgeCoil: "an edge coil on 'x'",
	edgePin: "an edge on an input pin",
	negatedEn: "a modifier on the EN pin",
	negatedEmpty: "a negated empty slot",
	arrayInstance: "writes a box's output pin straight to a variable",
	splitBefore: "referenced above its definition",
	splitNested: "defined below the top level",
	comparisonEno: "the result pin `=> x` of the 'GT' box",
	namedEno: "the result pin `=> i` of the 'MOVE' box",
	comparisonValue: undefined,
	emptyBranch: "a parallel branch",
}
