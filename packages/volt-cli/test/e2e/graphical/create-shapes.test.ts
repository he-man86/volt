/**
 * GRAPHICAL CREATE — the two shapes no offline fixture could settle.
 *
 * WHY THIS EXISTS. `TcPlcOpenWriter` was gated offline against the vendor's own PLCopen export, and that export
 * covers exactly ONE network holding ONE operator box. Two decisions in the writer are therefore unverified by
 * it, and both were guesses when written:
 *
 *   1. MULTI-NETWORK. Each network gets its own `localId` space AND its own FBD attribute marker. The vendor
 *      fixture has a single network, so "one marker per network" versus "one marker per body" is not visible in
 *      it — and the offline test asserting two markers for two networks only encodes the guess. What settles it
 *      is whether TwinCAT's importer builds two real networks.
 *   2. `instanceName`. A function-block call is emitted as `<block typeName="TON" instanceName="t1">`. It is the
 *      TC6 spelling, but NO fixture in the repo is a PLCopen export of an FB call, so nothing proved this
 *      importer honours it. If it does not, the instance is lost and the call silently becomes a type call.
 *
 * Both are questions about the IMPORTER, and only a live IDE has one. Neither test asserts a chosen shape of the
 * XML — they assert what came back through the vendor's own resolution, which is the only thing that matters.
 */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { id, fid, bridge, pushOps, requireHealthy, BASE } from "../harness"

describe(`graphical / create shapes (${BASE})`, () => {
	setDefaultTimeout(120_000)
	beforeAll(async () => {
		await requireHealthy()
	})

	/** Delete with the item's REAL version, falling back to the UNREADABLE sentinel — a leftover from a failed
	 * run otherwise blocks the next create with "already exists", a red that says nothing about the code. */
	const clean = async (name: string) => {
		const items = (await bridge.refs()).items ?? {}
		await pushOps([{ op: "deleteItem", name, ifVersion: items[name] ?? "UNREADABLE000000" }])
	}

	const pull = async (name: string) =>
		(await bridge.fetch({ knownItems: {}, onlyItems: [name] })).changed.find((i: any) => i.name === name)

	it("a TWO-network body creates as two real networks", async () => {
		const name = id("twonet")
		const item = fid("twonet", "prg")
		await clean(item)

		const src =
			`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tc : BOOL;\n\tout1 : BOOL;\n\tout2 : BOOL;\nEND_VAR\n\n` +
			// NO blank line between networks — that is not canonical form, and the gate refuses it while
			// printing the exact body to use. Canonical form is what a PULL emits, so anything else would show
			// up as drift on the very next one.
			`NETWORK 0 FBD\n  out1 := (a AND b);\nEND_NETWORK\n` +
			`NETWORK 1 FBD\n  out2 := (b OR c);\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: item, toFolder: "", sourceText: src, ifVersion: null }])
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const v1 = await pull(item)
		expect(v1).toBeDefined()

		// BOTH networks survived, each with its own content - not one merged network, not a dropped second.
		expect(v1.sourceText).toContain("NETWORK 0 FBD")
		expect(v1.sourceText).toContain("NETWORK 1 FBD")
		expect(v1.sourceText).toMatch(/out1 := \(a AND b\);/)
		expect(v1.sourceText).toMatch(/out2 := \(b OR c\);/)

		// …and the whole thing is a FIXED POINT, which is what proves the ids the IDE minted are consistent.
		const refs = await bridge.refs()
		const again = await pushOps([{ op: "set", name: item, sourceText: v1.sourceText, ifVersion: refs.items[item] }])
		expect(again.accepted, `re-push refused: ${JSON.stringify(again.conflicts)}`).toBe(true)
		expect((await pull(item)).sourceText).toBe(v1.sourceText)

		await clean(item)
	})

	it("a function-block CALL keeps its instance, not just its type", async () => {
		const name = id("fbcall")
		const item = fid("fbcall", "prg")
		await clean(item)

		const src =
			`PROGRAM ${name}\nVAR\n\tt1 : TON;\n\ta : BOOL;\n\tpt : TIME;\n\tdone : BOOL;\nEND_VAR\n\n` +
			`NETWORK 0 FBD\n  t1(IN := a, PT := pt);\n  done := t1.Q;\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: item, toFolder: "", sourceText: src, ifVersion: null }])
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const v1 = await pull(item)
		expect(v1).toBeDefined()

		// THE INSTANCE IS THE POINT. `t1(...)` must come back named t1 - if `instanceName` were ignored the call
		// would return as a bare TON and the timer would lose its state between scans.
		expect(v1.sourceText).toMatch(/t1\(/)
		expect(v1.sourceText).toMatch(/done := t1\.Q;/)

		const refs = await bridge.refs()
		const again = await pushOps([{ op: "set", name: item, sourceText: v1.sourceText, ifVersion: refs.items[item] }])
		expect(again.accepted, `re-push refused: ${JSON.stringify(again.conflicts)}`).toBe(true)
		expect((await pull(item)).sourceText).toBe(v1.sourceText)

		await clean(item)
	})
})
