/**
 * ROUND-TRIP PROOF for the shapes a REAL project turned out to contain.
 *
 * These did not come from imagining what a ladder might hold. They came from pulling
 * `Lenze_MID-S100_V5_00_602_T51` — 373 graphical networks drawn by engineers over years — through the CODESYS
 * bridge and feeding the result straight back into Volt's own push gate. 152 of the 373 were REFUSED: text the
 * writer had just produced and the reader could not read back, which means those POUs could be pulled and never
 * pushed again. Not one was reachable from a fixture, because Volt only ever wrote the shapes it already knew
 * how to read.
 *
 * `NetworkTextRoundTripTests` pins the same cases offline, where they run in milliseconds against the format
 * alone. This file asks the harder question the offline test cannot: does the IDE ACCEPT the shape and hand it
 * back unchanged? A format that round-trips against itself and loses a pin on the way through the vendor is
 * still lossy.
 *
 * **On the two vendors it asserts the same INVARIANT, not the same outcome.** The parity boundary is the wire,
 * but TwinCAT's only route to a body it does not yet have is a PLCopen import, and PLCopen genuinely cannot
 * spell some of what the 3S object model holds — an unconnected pin, a parallel branch, a branch point feeding
 * one place. So the property worth pinning is the one that actually matters: **either the body round-trips
 * exactly, or the push is refused and says why. Never accepted-and-reshaped.** That distinction is the whole
 * point — a refusal costs an engineer a detour through the IDE, while a silent reshape costs them a drawing
 * they will not know changed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, fetchItem, requireHealthy, savePlcPrg, restorePlcPrg, fixPlcPrg, BASE } from "../harness"

setDefaultTimeout(30000)

/** Push a body and pull it back. Fails the test if the push is refused. */
async function roundTrip(fullName: string, src: string): Promise<string> {
	const refs = await bridge.refs()
	const r = await bridge.push({
		expectedProjectVersion: refs.projectVersion,
		ops: [{ op: "set", name: fullName, toFolder: "", sourceText: src, ifVersion: refs.items[fullName] ?? null }],
	})
	expect(r.accepted, `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
	return (await fetchItem(fullName)).sourceText
}

/**
 * THE INVARIANT: exact round-trip, or an explicit refusal. Anything else — a push accepted while the body comes
 * back different — is the failure, and it is the one this whole file was written after finding.
 */
async function survivesOrIsRefused(fullName: string, src: string): Promise<"round-tripped" | "refused"> {
	const refs = await bridge.refs()
	const r = await bridge.push({
		expectedProjectVersion: refs.projectVersion,
		ops: [{ op: "set", name: fullName, toFolder: "", sourceText: src, ifVersion: refs.items[fullName] ?? null }],
	})

	if (!r.accepted) {
		// A refusal has to be legible: it names what it cannot express and what to do instead.
		const why = JSON.stringify(r.conflicts)
		expect(why, `refused without saying why: ${why}`).toMatch(/cannot|unable|refus/i)
		return "refused"
	}

	expect(await fetchItem(fullName)).toMatchObject({ sourceText: src })
	return "round-tripped"
}

/** A PROGRAM wrapping one network body, with the declarations the shapes below reference. */
function program(name: string, networks: string): string {
	return (
		`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\n\tout2 : BOOL;\n\tn : INT;\n\tm : INT;\n` +
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
	 * AN UNCONNECTED PIN.
	 *
	 * The writer rendered a pin wired to nothing as nothing at all, so the vendor's own bodies came out as
	 * `( * iRPM * 6)` and `RESET := , PV := )` — text no reader could take back. 110 of the 373 networks. The
	 * fix is a POSITION, not a token: `?` was tried and withdrawn, because CODESYS writes `???` into a box whose
	 * instance is unresolved and that is real content Volt has to carry.
	 *
	 * CODESYS builds this natively. TwinCAT refuses it on CREATE — PLCopen has no way to say "this pin is
	 * connected to nothing" — and says so.
	 */
	it("a box with an unconnected input survives, or is refused", async () => {
		const name = id("rp_pin")
		await survivesOrIsRefused(fid("rp_pin", "prg"), program(name, `NETWORK 0 LD\n  n := ( * m * 6);\nEND_NETWORK\n`))
	})

	/** The same fact in the other syntax — an FB call whose pins are declared but unwired, which is how a
	 *  half-finished block sits in a live project. */
	it("an FB call with unwired named pins survives, or is refused", async () => {
		const name = id("rp_pins")
		await survivesOrIsRefused(fid("rp_pins", "prg"), program(name, `NETWORK 0 FBD\n  t1(IN := , PT := );\nEND_NETWORK\n`))
	})

	/**
	 * A FAN-OUT WIRE WITH ONE CONSUMER IS STILL A WIRE — a `BoxTreeDemux`, a branch point drawn on the rung. A
	 * use-count heuristic in the reader dissolved it into its single consumer, so the item vanished on the next
	 * push with nothing in the diff to say so.
	 *
	 * This is also where the two vendors are genuinely different, and where TwinCAT was caught doing the very
	 * thing this file is about: PLCopen spells a wire by consumers SHARING a `refLocalId`, so with one consumer
	 * there is nothing to distinguish it from a direct connection, and the import came back collapsed with the
	 * push ACCEPTED. It now refuses instead.
	 */
	it("a wire with a single consumer survives, or is refused", async () => {
		const name = id("rp_wire")
		await survivesOrIsRefused(
			fid("rp_wire", "prg"),
			program(name, `NETWORK 0 LD\n  LET g0 := (a AND b);\n  out := g0;\nEND_NETWORK\n`),
		)
	})

	// ── shapes BOTH vendors build, asserted exactly ────────────────────────────────────────────────

	/**
	 * A POSITIONAL CALL AS A BARE STATEMENT — a box whose output is connected to nothing. 34 networks. The
	 * reader refused it as "a call whose result goes nowhere, which is an authoring mistake rather than a shape
	 * the IDE gave us"; the IDE gave us 34 of them.
	 */
	it("a call whose output goes nowhere round-trips", async () => {
		const name = id("rp_stmt")
		const full = fid("rp_stmt", "prg")
		const src = program(name, `NETWORK 0 LD\n  MOVE(a, b);\nEND_NETWORK\n`)

		expect(await roundTrip(full, src)).toBe(src)
	})

	/**
	 * A NOT BOX IS NOT A NEGATION FLAG. Reading `NOT(a)` as the modifier deleted a box item from the drawing and
	 * put a dot on a pin instead — logically equal, visually not, and a push would have committed it. Both
	 * spellings go through the IDE here, because only the IDE can say they stayed different.
	 */
	it("a NOT box and a negated operand stay different", async () => {
		const boxSrc = program(id("rp_notbox"), `NETWORK 0 FBD\n  out := NOT(a);\nEND_NETWORK\n`)
		expect(await roundTrip(fid("rp_notbox", "prg"), boxSrc)).toBe(boxSrc)

		const flagSrc = program(id("rp_notflag"), `NETWORK 0 FBD\n  out := NOT a;\nEND_NETWORK\n`)
		expect(await roundTrip(fid("rp_notflag", "prg"), flagSrc)).toBe(flagSrc)
	})

	/**
	 * A TITLE WITH A QUOTE IN IT, and a comment the engineer indented. Both are text a person typed, both came
	 * back changed: the title truncated at its own quote, the comment flattened to the left margin.
	 */
	it("a quoted title and an indented comment come back as written", async () => {
		const full = fid("rp_text", "prg")
		const src = program(
			id("rp_text"),
			`NETWORK 0 LD "Muting of alarm ""No bunch"""\n  //     aligned on purpose\n  out := (a AND b);\nEND_NETWORK\n`,
		)

		expect(await roundTrip(full, src)).toBe(src)
	})

	/**
	 * AND THE WHOLE SET IS A FIXED POINT. Pushing back exactly what came out must change nothing — the property
	 * the change gates exist for, and the one measured across all 40 graphical POUs of the real project (40/40,
	 * no drift, nothing refused) once the shapes above could be read at all.
	 *
	 * Built only from what BOTH vendors can create, so a failure here is a real regression rather than the
	 * PLCopen boundary the three tests above already describe. Two deliberate choices make it vendor-neutral:
	 * the wire has TWO consumers (one is inexpressible in PLCopen, above), and each connected component gets
	 * its OWN network — a TwinCAT import decides its own network boundaries, one per connected component
	 * (DIALECT D25), so putting the `MOVE` in with the rung made the IDE return two networks where one was
	 * pushed, and the second push then failed on a count change the archive writer will not make.
	 */
	it("pushing back what came out changes nothing", async () => {
		const full = fid("rp_fix", "prg")
		const src = program(
			id("rp_fix"),
			`NETWORK 0 LD "a rung"\n  LET g0 := (a AND b);\n  out := g0;\n  out2 := g0;\nEND_NETWORK\n` +
				`NETWORK 1 LD\n  MOVE(a, b);\nEND_NETWORK\n`,
		)

		const once = await roundTrip(full, src)
		const twice = await roundTrip(full, once)

		expect(twice).toBe(once)
	})
})
