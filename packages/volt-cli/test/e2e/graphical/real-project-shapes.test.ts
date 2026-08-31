/**
 * ROUND-TRIP PROOF for the shapes a REAL project turned out to contain.
 *
 * These did not come from imagining what a ladder might hold. They came from pulling
 * `Lenze_MID-S100_V5_00_602_T51` — 373 graphical networks drawn by engineers over years — through the CODESYS
 * bridge and feeding the result straight back into Volt's own push gate. 152 of the 373 were REFUSED: text the
 * writer had just produced and the reader could not read back, which means those POUs could be pulled and never
 * pushed again. Not one of them was reachable from a fixture Volt had authored itself, because Volt only ever
 * wrote the shapes it already knew how to read.
 *
 * `NetworkTextRoundTripTests` pins the same cases offline, where they run in milliseconds against the format
 * alone. This file asks the harder question the offline test cannot: does the IDE ACCEPT the shape and hand it
 * back unchanged? A format that round-trips against itself and loses a pin on the way through the vendor is
 * still lossy — so each case here is pushed into a live IDE, pulled, and compared byte for byte.
 *
 * Vendor-blind, like the rest of the graphical e2e: the parity boundary is the wire, so both bridges must
 * answer identically for the same body.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, fetchItem, requireHealthy, savePlcPrg, restorePlcPrg, fixPlcPrg, BASE } from "../harness"

setDefaultTimeout(30000)

/** Push a body, pull it back, and return what the IDE actually holds. */
async function roundTrip(fullName: string, src: string): Promise<string> {
	const refs = await bridge.refs()
	const r = await bridge.push({
		expectedProjectVersion: refs.projectVersion,
		ops: [{ op: "set", name: fullName, toFolder: "", sourceText: src, ifVersion: refs.items[fullName] ?? null }],
	})
	expect(r.accepted, `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
	return (await fetchItem(fullName)).sourceText
}

/** A PROGRAM wrapping one network body, with the declarations the shapes below reference. */
function program(name: string, networks: string): string {
	return (
		`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\n\tn : INT;\n\tm : INT;\n` +
		`\tt1 : TON;\n\tgo : BOOL;\n\tpt : TIME;\nEND_VAR\n\n` +
		networks +
		`\nEND_PROGRAM\n`
	)
}

describe(`graphical / real-project shapes (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })

	/**
	 * AN UNCONNECTED PIN SURVIVES THE IDE.
	 *
	 * The writer rendered a pin wired to nothing as nothing at all, so the vendor's own bodies came out as
	 * `( * iRPM * 6)` and `RESET := , PV := )` — text no reader could take back. 110 of the 373 networks.
	 * The fix is not a token but a POSITION: `?` was tried and withdrawn, because CODESYS writes `???` into a
	 * box whose instance is unresolved and that is real content Volt has to carry.
	 *
	 * What this adds over the offline test is the half that matters here: the IDE has to ACCEPT a box with an
	 * empty input and hand the same shape back, rather than filling it in or dropping the pin.
	 */
	it("a box with an unconnected input round-trips through the IDE", async () => {
		const name = id("rp_pin")
		const full = fid("rp_pin", "prg")
		const src = program(name, `NETWORK 0 LD\n  n := ( * m * 6);\nEND_NETWORK\n`)

		expect(await roundTrip(full, src)).toBe(src)
	})

	/**
	 * NAMED PINS WITH NOTHING ON THEM. The same fact in the other syntax — an FB call whose pins are declared
	 * but unwired, which is how a half-finished block sits in a live project.
	 */
	it("an FB call with unwired named pins round-trips through the IDE", async () => {
		const name = id("rp_pins")
		const full = fid("rp_pins", "prg")
		const src = program(name, `NETWORK 0 FBD\n  t1(IN := , PT := );\nEND_NETWORK\n`)

		expect(await roundTrip(full, src)).toBe(src)
	})

	/**
	 * A POSITIONAL CALL AS A BARE STATEMENT — a box whose output is connected to nothing. 34 networks. The
	 * reader refused it as "a call whose result goes nowhere, which is an authoring mistake rather than a shape
	 * the IDE gave us"; the IDE gave us 34 of them.
	 */
	it("a call whose output goes nowhere round-trips through the IDE", async () => {
		const name = id("rp_stmt")
		const full = fid("rp_stmt", "prg")
		const src = program(name, `NETWORK 0 LD\n  MOVE(a, b);\nEND_NETWORK\n`)

		expect(await roundTrip(full, src)).toBe(src)
	})

	/**
	 * A NOT BOX IS NOT A NEGATION FLAG. Reading `NOT(a)` as the modifier deleted a box item from the drawing
	 * and put a dot on a pin instead — logically equal, visually not, and a push would have committed it.
	 * Both spellings go through the IDE here, because only the IDE can say they stayed different.
	 */
	it("a NOT box and a negated operand stay different through the IDE", async () => {
		const boxName = id("rp_notbox")
		const boxFull = fid("rp_notbox", "prg")
		const boxSrc = program(boxName, `NETWORK 0 FBD\n  out := NOT(a);\nEND_NETWORK\n`)
		expect(await roundTrip(boxFull, boxSrc)).toBe(boxSrc)

		const flagName = id("rp_notflag")
		const flagFull = fid("rp_notflag", "prg")
		const flagSrc = program(flagName, `NETWORK 0 FBD\n  out := NOT a;\nEND_NETWORK\n`)
		expect(await roundTrip(flagFull, flagSrc)).toBe(flagSrc)
	})

	/**
	 * A FAN-OUT WIRE WITH ONE CONSUMER IS STILL A WIRE — a `BoxTreeDemux`, a branch point drawn on the rung.
	 * A use-count heuristic dissolved it into its single consumer, so the item was gone from the IDE on the
	 * next push with nothing in the diff to say so. This is the case the offline test cannot prove at all: the
	 * text is identical either way, and only the IDE can be asked whether the item is still there.
	 */
	it("a wire with a single consumer survives the IDE", async () => {
		const name = id("rp_wire")
		const full = fid("rp_wire", "prg")
		const src = program(name, `NETWORK 0 LD\n  LET g0 := (a AND b);\n  out := g0;\nEND_NETWORK\n`)

		expect(await roundTrip(full, src)).toBe(src)
	})

	/**
	 * A TITLE WITH A QUOTE IN IT, and a comment the engineer indented. Both are text a person typed, both came
	 * back changed: the title truncated at its own quote, the comment flattened to the left margin.
	 */
	it("a quoted title and an indented comment come back as written", async () => {
		const name = id("rp_text")
		const full = fid("rp_text", "prg")
		const src = program(
			name,
			`NETWORK 0 LD "Muting of alarm ""No bunch"""\n  //     aligned on purpose\n  out := (a AND b);\nEND_NETWORK\n`,
		)

		expect(await roundTrip(full, src)).toBe(src)
	})

	/**
	 * AND THE WHOLE SET IS A FIXED POINT. Pushing back exactly what came out must change nothing — the property
	 * the change gates exist for, and the one measured across all 40 graphical POUs of the real project (40/40,
	 * no drift, nothing refused) once the shapes above could be read at all.
	 */
	it("pushing back what came out changes nothing", async () => {
		const name = id("rp_fix")
		const full = fid("rp_fix", "prg")
		const src = program(
			name,
			`NETWORK 0 LD "a rung"\n  LET g0 := (a AND b);\n  out := g0;\n  MOVE(a, b);\n  t1(IN := , PT := );\nEND_NETWORK\n`,
		)

		const once = await roundTrip(full, src)
		const twice = await roundTrip(full, once)

		expect(twice).toBe(once)
	})
})
