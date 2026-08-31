/**
 * NETWORK LABELS AND JUMPS — the pair that makes `JMP` mean anything.
 *
 * A jump in FBD/LD leaves its network: each network may carry ONE label, and `JMP name` transfers control to the
 * network carrying it. The model holds the label on the network itself (`Network.Label`, which both drivers read
 * and write), and `NetworkTextWriter` renders it as `name:` at the top of that network's statements — so a real
 * forward jump names a label the JUMPING network does not contain.
 *
 * Nothing in the live suite covered either half, on either vendor: the label could have been dropped on the way
 * out (invisible in git) or on the way back (deleted from the engineer's project) and every test would still
 * have passed. This asserts the round trip and the FIXED POINT, which is what proves the label survived rather
 * than merely appeared once.
 */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { id, fid, bridge, pushOps, requireHealthy, BASE } from "../harness"

describe(`graphical / labels and jumps (${BASE})`, () => {
	setDefaultTimeout(180_000)
	beforeAll(async () => {
		await requireHealthy()
	})

	const clean = async (item: string) => {
		const items = (await bridge.refs()).items ?? {}
		await pushOps([{ op: "deleteItem", name: item, ifVersion: items[item] ?? "UNREADABLE000000" }])
	}
	const pull = async (item: string) =>
		(await bridge.fetch({ knownItems: {}, onlyItems: [item] })).changed.find((i: any) => i.name === item)

	/**
	 * How many errors and warnings the project reports. Counted rather than attributed, because a CODESYS
	 * build diagnostic carries no item name — `Identifier 'Done' not defined` says nothing about which POU
	 * it came from, so filtering by the test prefix (what `ensureCompiles` does) would have found nothing.
	 * A baseline before and after is robust to whatever the fixture project already reports.
	 */
	const problems = async (): Promise<string[]> => {
		const r = await bridge.build()
		return (r.diagnostics ?? [])
			.filter((d: any) => d.severity === "error" || d.severity === "warning")
			.map((d: any) => `${d.severity}: ${d.message ?? ""}`)
	}

	it("a labelled network survives a round trip", async () => {
		const name = id("lbl"), item = fid("lbl", "prg")
		await clean(item)

		// Two networks, the second LABELLED. No jump yet - the label alone must survive, because it is the half
		// that lives on the network object rather than in the statements.
		const src =
			`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout1 : BOOL;\n\tout2 : BOOL;\nEND_VAR\n\n` +
			`NETWORK 0 FBD\n  out1 := (a AND b);\nEND_NETWORK\n` +
			`NETWORK 1 FBD\n  Done:\n  out2 := (a OR b);\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: item, toFolder: "", sourceText: src, ifVersion: null }])
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const v1 = await pull(item)
		expect(v1, "the item vanished after its create").toBeDefined()
		expect(v1.sourceText, "the network label was dropped").toContain("Done:")

		const refs = await bridge.refs()
		const again = await pushOps([{ op: "set", name: item, sourceText: v1.sourceText, ifVersion: refs.items[item] }])
		expect(again.accepted, `re-push refused: ${JSON.stringify(again.conflicts)}`).toBe(true)
		expect((await pull(item)).sourceText).toBe(v1.sourceText)

		await clean(item)
	})

	/**
	 * AND IT HAS TO COMPILE, which a round trip cannot tell you.
	 *
	 * The jump used to be written as a flag on the `BoxTreeAssign` ITEM. Volt read it back from the same
	 * place, so the text was byte-identical and this test passed — while the IDE, which keeps a jump on the
	 * TARGET OPERAND, drew the rung as an ordinary coil assigning to the label and refused to compile it:
	 * `Identifier 'Done' not defined`, `'Done' is no valid assignment target`, and `The label 'DONE' has not
	 * been referenced` — the label was there and nothing jumped to it.
	 *
	 * A self-consistent round trip is exactly the shape a test cannot see through: Volt agreed with itself
	 * and disagreed with the vendor. Only a BUILD is outside that loop, so the build is part of the test now.
	 */
	it("a JMP to another network's label survives a round trip AND compiles", async () => {
		const name = id("jmp"), item = fid("jmp", "prg")
		await clean(item)
		const before = await problems()

		const src =
			`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\nEND_VAR\n\n` +
			`NETWORK 0 FBD\n  IF a THEN JMP Done; END_IF\nEND_NETWORK\n` +
			`NETWORK 1 FBD\n  Done:\n  out := (a OR b);\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: item, toFolder: "", sourceText: src, ifVersion: null }])
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const v1 = await pull(item)
		expect(v1).toBeDefined()
		expect(v1.sourceText, "the jump was dropped").toMatch(/JMP\s+Done/i)
		expect(v1.sourceText, "the jump's target label was dropped").toContain("Done:")

		const refs = await bridge.refs()
		const again = await pushOps([{ op: "set", name: item, sourceText: v1.sourceText, ifVersion: refs.items[item] }])
		expect(again.accepted, `re-push refused: ${JSON.stringify(again.conflicts)}`).toBe(true)
		expect((await pull(item)).sourceText).toBe(v1.sourceText)

		// The jump must not have introduced a single new error or warning.
		expect(await problems(), "the jump does not compile").toEqual(before)

		await clean(item)
	})

	/**
	 * A RETURN — the third control-flow form, and the one nothing covered live on either vendor.
	 *
	 * A real project turned out to contain none of these at all (Lenze_MID-S100: 373 graphical networks, zero
	 * labels, zero jumps, zero returns), so the corpus could not find what was broken here. Pushing one could,
	 * and did — twice.
	 *
	 * CODESYS refused to SAVE a `RETURN;` with "Object reference not set to an instance of an object", and
	 * TwinCAT refused a conditional one with "an item changes from 1 to 0 output(s)". Two unrelated-looking
	 * errors, both from Volt: the unconditional form built an item holding nothing at all (no value, no output),
	 * and the conditional one was compared against the archive as though a return had outputs.
	 */
	it("a conditional RETURN survives a round trip AND compiles", async () => {
		const name = id("ret"), item = fid("ret", "prg")
		await clean(item)
		const before = await problems()

		const src =
			`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\nEND_VAR\n\n` +
			`NETWORK 0 FBD\n  IF a THEN RETURN; END_IF\nEND_NETWORK\n` +
			`NETWORK 1 FBD\n  out := (a AND b);\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: item, toFolder: "", sourceText: src, ifVersion: null }])
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const v1 = await pull(item)
		expect(v1, "the item vanished after its create").toBeDefined()
		expect(v1.sourceText, "the return was dropped").toMatch(/RETURN/i)

		// The FIXED POINT is the half that matters: TwinCAT imported the return happily and then refused to
		// push the body back, so a POU Volt had just created could never be pushed again.
		const refs = await bridge.refs()
		const again = await pushOps([{ op: "set", name: item, sourceText: v1.sourceText, ifVersion: refs.items[item] }])
		expect(again.accepted, `re-push refused: ${JSON.stringify(again.conflicts)}`).toBe(true)
		expect((await pull(item)).sourceText).toBe(v1.sourceText)

		// A return has no target operand, so its flag lives on the ITEM — the opposite of a jump. Measured,
		// not assumed: this build is what says so.
		expect(await problems(), "the return does not compile").toEqual(before)

		await clean(item)
	})

	/**
	 * AN UNCONDITIONAL `RETURN;` — round-trips, or is refused for a reason that names the vendor limit.
	 *
	 * CODESYS builds it: the item needs a VALUE, and "nothing drives this" is spelled as an unconnected
	 * terminator — the same shape `coil := ;` reads back as — rather than as a null, which is what it used to be
	 * and what the IDE would not save.
	 *
	 * TwinCAT cannot CREATE one. Measured by single-variable comparison: the identical PLCopen document with a
	 * `connectionPointIn` imports and round-trips, and without one the importer rejects the whole scratch object
	 * with `Value cannot be null. Parameter name: source` — it wants a jump or return wired. Volt says that
	 * instead of letting the vendor's null-reference reach the engineer.
	 */
	it("an unconditional RETURN round-trips, or is refused with a reason", async () => {
		const name = id("uret"), item = fid("uret", "prg")
		await clean(item)

		const src =
			`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\nEND_VAR\n\n` +
			`NETWORK 0 FBD\n  out := (a AND b);\nEND_NETWORK\n` +
			`NETWORK 1 FBD\n  RETURN;\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: item, toFolder: "", sourceText: src, ifVersion: null }])
		if (!created.accepted) {
			expect(JSON.stringify(created.conflicts)).toMatch(/unconditional return/i)
			return
		}

		const v1 = await pull(item)
		expect(v1).toBeDefined()
		expect(v1.sourceText, "the return was dropped").toMatch(/^\s*RETURN;/m)
		expect(v1.sourceText).toBe(src)

		await clean(item)
	})

	/** The same fact for an unconditional JMP, which shared both bugs and both fixes. */
	it("an unconditional JMP round-trips, or is refused with a reason", async () => {
		const name = id("ujmp"), item = fid("ujmp", "prg")
		await clean(item)

		const src =
			`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\nEND_VAR\n\n` +
			`NETWORK 0 FBD\n  JMP Done;\nEND_NETWORK\n` +
			`NETWORK 1 FBD\n  Done:\n  out := (a AND b);\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: item, toFolder: "", sourceText: src, ifVersion: null }])
		if (!created.accepted) {
			expect(JSON.stringify(created.conflicts)).toMatch(/unconditional jump/i)
			return
		}

		const v1 = await pull(item)
		expect(v1).toBeDefined()
		expect(v1.sourceText, "the jump was dropped").toMatch(/^\s*JMP\s+Done;/m)
		expect(v1.sourceText).toBe(src)

		await clean(item)
	})
})
