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

	it("a JMP to another network's label survives a round trip", async () => {
		const name = id("jmp"), item = fid("jmp", "prg")
		await clean(item)

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

		await clean(item)
	})
})
