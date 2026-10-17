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
import { describe, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { id, fid, bridge, pushOps, requireHealthy, BASE, inFolder, projectRoot } from "../harness"

import { itGapped, PLATFORM_GAPS } from "../lib/platform"

/** On a CODESYS version that cannot take an LD/FBD write, every test here must end in that refusal (lib/platform.ts). */
const it = itGapped(PLATFORM_GAPS.graphicalWrite)

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
		const item = inFolder(await projectRoot(), fid("twonet", "pou"))
		await clean(item)

		const src =
			`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tc : BOOL;\n\tout1 : BOOL;\n\tout2 : BOOL;\nEND_VAR\n` +
			// NO blank line between networks — not the canonical form a PULL emits. It is written all the same
			// (bridge-refusal-review 2.12: the layout-only gate is gone) and the pull below returns the canonical text.
			`IMPLEMENTATION FBD\nNETWORK\n  out1 := a AND b;\nEND_NETWORK\n` +
			`NETWORK\n  out2 := b OR c;\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: item, sourceText: src, ifVersion: null }])
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const v1 = await pull(item)
		expect(v1).toBeDefined()

		// BOTH networks survived, each with its own content - not one merged network, not a dropped second.
		// Headers carry no order number, so the count is the check: two `NETWORK` lines, not one merged.
		expect(v1.sourceText.match(/^NETWORK$/gm)?.length, "the two networks did not come back as two").toBe(2)
		expect(v1.sourceText).toMatch(/out1 := a AND b;/)
		expect(v1.sourceText).toMatch(/out2 := b OR c;/)

		// …and the whole thing is a FIXED POINT, which is what proves the ids the IDE minted are consistent.
		const refs = await bridge.refs()
		const again = await pushOps([{ op: "set", name: item, sourceText: v1.sourceText, ifVersion: refs.items[item] }])
		expect(again.accepted, `re-push refused: ${JSON.stringify(again.conflicts)}`).toBe(true)
		expect((await pull(item)).sourceText).toBe(v1.sourceText)

		await clean(item)
	})

	/**
	 * A box's EMBEDDED OUTPUT PIN — `ET => elapsed` — written straight to a variable rather than read back off
	 * the instance. Nothing in this suite covered one on CREATE, which is how a whole class of loss stayed
	 * invisible: the TwinCAT importer emits an empty `OutputItems` for a box it wires nothing to, the repair
	 * that strips the importer's own empty operand had nothing to distinguish it from a real pin, and the
	 * refusal that followed was swallowed as "nothing to lose". A resolvable pin is the baseline case; if this
	 * fails, the `???` variants are a symptom rather than the disease.
	 */
	it("a box's embedded OUTPUT pin survives a create", async () => {
		const name = id("boxout")
		const item = inFolder(await projectRoot(), fid("boxout", "pou"))
		await clean(item)

		const src =
			`PROGRAM ${name}\nVAR\n\tt1 : TON;\n\ta : BOOL;\n\tpt : TIME;\n\tel : TIME;\nEND_VAR\n` +
			`IMPLEMENTATION FBD\nNETWORK\n  t1 : TON(IN := a, PT := pt, ET => el);\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: item, sourceText: src, ifVersion: null }])

		// TwinCAT took this through its PLCopen importer, which lowered the pin to a separate assignment (DIALECT C20),
		// so it was refused there. The native writer builds the pin on the box, as the IDE draws it (twincat-inproc-host).
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const v1 = await pull(item)
		expect(v1.sourceText, "the ET pin did not survive the create").toContain("ET => el")

		const refs = await bridge.refs()
		const again = await pushOps([{ op: "set", name: item, sourceText: v1.sourceText, ifVersion: refs.items[item] }])
		expect(again.accepted, `re-push refused: ${JSON.stringify(again.conflicts)}`).toBe(true)
		expect((await pull(item)).sourceText).toBe(v1.sourceText)

		await clean(item)
	})

	it("a function-block CALL keeps its instance, not just its type", async () => {
		const name = id("fbcall")
		const item = inFolder(await projectRoot(), fid("fbcall", "pou"))
		await clean(item)

		const src =
			`PROGRAM ${name}\nVAR\n\tt1 : TON;\n\ta : BOOL;\n\tpt : TIME;\n\tdone : BOOL;\nEND_VAR\n` +
			`IMPLEMENTATION FBD\nNETWORK\n  t1 : TON(IN := a, PT := pt);\n  done := t1.Q;\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: item, sourceText: src, ifVersion: null }])
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const v1 = await pull(item)
		expect(v1).toBeDefined()

		// THE INSTANCE IS THE POINT. `t1 : TON(...)` must come back named t1 - if `instanceName` were ignored the call
		// would return as a bare TON and the timer would lose its state between scans.
		expect(v1.sourceText).toMatch(/t1 : TON\(/)
		expect(v1.sourceText).toMatch(/done := t1\.Q;/)

		const refs = await bridge.refs()
		const again = await pushOps([{ op: "set", name: item, sourceText: v1.sourceText, ifVersion: refs.items[item] }])
		expect(again.accepted, `re-push refused: ${JSON.stringify(again.conflicts)}`).toBe(true)
		expect((await pull(item)).sourceText).toBe(v1.sourceText)

		await clean(item)
	})
})
