import { landed } from "../harness"
/**
 * FAN-OUT — one wire feeding several consumers, on a live IDE.
 *
 * WHY THIS EXISTS. An adversarial audit (2026-08-29) found that `NetworkTextWriter` had no `Demux` arm and fell
 * to `default: return ""`. A branch off a gate output PULLED as `out := ( AND b);` plus a stray `;` — the wire
 * silently gone, `volt status` clean, and the resulting file no longer parseable, so it could never be pushed
 * back either. `BoxTreeDemux` is the 4th most common item in the one real ladder project ever surveyed: 573 of
 * them across 36 POUs. Nothing caught it because every offline network-text test round-trips text → model →
 * text, and the TEXT reader never built a Demux — so no test ever handed the writer one.
 *
 * The other half was just as bad: the text reader encoded fan-out as a `SplitPoints` entry plus a plain `Assign`
 * to the wire's NAME, a second encoding no vendor understood, so a push landed a real assignment to an
 * UNDECLARED symbol and the POU stopped compiling. The model now carries ONE encoding — the vendor's own.
 *
 * Both vendors keep the wire under the VarId the text gave it (TwinCAT's PLCopen importer folded it into one assign until
 * the native writer replaced it). What must hold on both is that the value and both consumers SURVIVE and that
 * pull → push is a FIXED POINT.
 */
import { describe, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { id, fid, bridge, pushOps, requireHealthy, BASE, inFolder, projectRoot } from "../harness"

import { itGapped, PLATFORM_GAPS } from "../lib/platform"
import { drivenBuild } from "../lib/compile"

/** On a CODESYS version that cannot take an LD/FBD write, every test here must end in that refusal (lib/platform.ts). */
const it = itGapped(PLATFORM_GAPS.graphicalWrite)

describe(`graphical / fan-out (${BASE})`, () => {
	setDefaultTimeout(120_000)
	beforeAll(async () => {
		await requireHealthy()
	})

	it("a wire feeding two consumers survives create → pull → push → pull", async () => {
		const name = id("fanout")
		const wire = inFolder(await projectRoot(), fid("fanout", "pou"))

		// Clean with the item's REAL version, falling back to the UNREADABLE sentinel. A delete keyed only on
		// the sentinel is rejected for an item that IS readable ("item changed since you fetched its version"),
		// so a leftover from a previous run then blocks the create with "already exists" — a self-inflicted
		// red that says nothing about the code under test.
		const clean = async () => {
			const items = (await bridge.refs()).items ?? {}
			await pushOps([{ op: "deleteItem", name: wire, ifVersion: items[wire] }])
		}
		await clean()

		const src =
			`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout1 : BOOL;\n\tout2 : BOOL;\nEND_VAR\n` +
			`IMPLEMENTATION FBD\nNETWORK\n  split7 := a AND b;\n  out1 := split7;\n  out2 := split7;\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: wire, sourceText: src, ifVersion: null }])
		expect(landed(created), `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const v1 = (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
		expect(v1).toBeDefined()

		// THE VALUE, BOTH CONSUMERS AND THE SPLIT ARE THERE ON BOTH VENDORS. A split (`split<VarId> := …`) is a real
		// fan-out (a `BoxTreeDemux` the editor draws); a chained assignment (`out1 := out2 := v;`) is ONE item driving
		// several coils. TwinCAT's PLCopen import folded the first into the second (DIALECT D22/C20, superseded): the native
		// writer builds the Demux the text states, under the VarId the text gave it, as CODESYS does (openspec
		// twincat-inproc-host).
		const shape = "  split7 := a AND b;\n  out1 := split7;\n  out2 := split7;\n"
		expect(v1.sourceText).toContain(shape)
		// …and the erasure signatures are absent: an empty operand, or a bare statement.
		expect(v1.sourceText).not.toContain("( AND")
		expect(v1.sourceText).not.toMatch(/^\s*;\s*$/m)

		// FIXED POINT — push back exactly what was pulled, and the next pull is byte-identical.
		const refs = await bridge.refs()
		const again = await pushOps([
			{ op: "set", name: wire, sourceText: v1.sourceText, ifVersion: refs.items[wire] },
		])
		expect(landed(again), `re-push refused: ${JSON.stringify(again.conflicts)}`).toBe(true)

		const v2 = (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
		expect(v2.sourceText).toBe(v1.sourceText)

		await clean()
	})
	/**
	 * A DATA SPLIT (review of section 4). The text states no type (B6: the feeder's), and CODESYS keeps a
	 * box's output type in `OutputParams.Types`, which it never fills itself (DIALECT N21). The writer appended no type,
	 * so the pushed ADD re-read typeless: the next pull was the marker ("a wire of unknown type") and the next push of
	 * the same text was refused. Every other wire here is BOOL, which the rule types without a stored type — so nothing
	 * pushed a data wire until this. It must come back as written, push again unchanged, and BUILD (the box now carries
	 * a typed output slot the vendor's own boxes carry).
	 */
	it("a data split comes back as pushed, pushes again, and builds", async () => {
		const name = id("fanint")
		const wire = inFolder(await projectRoot(), fid("fanint", "pou"))
		const clean = async () => {
			const items = (await bridge.refs()).items ?? {}
			await pushOps([{ op: "deleteItem", name: wire, ifVersion: items[wire] }])
		}
		await clean()
		// Counted, not attributed: a build diagnostic names no POU, and a PROGRAM cannot be instantiated to force it
		// (`ensureCompiles`) — the baseline is whatever the fixture reports without it (labels.test.ts, same reason).
		const errors = async () => ((await drivenBuild()).diagnostics ?? []).filter((d: any) => d.severity === "error")
		const before = (await errors()).length

		const src =
			`PROGRAM ${name}\nVAR\n\ta : INT;\n\tb : INT;\n\tn : INT;\n\tsv : INT;\nEND_VAR\n` +
			`IMPLEMENTATION FBD\nNETWORK\n  split1 := a ADD b;\n  n := split1;\n  sv := split1;\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: wire, sourceText: src, ifVersion: null }])
		expect(landed(created), `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const v1 = (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
		const shape = "  split1 := a ADD b;\n  n := split1;\n  sv := split1;\n"
		expect(v1.sourceText).toContain(shape)

		const refs = await bridge.refs()
		const again = await pushOps([{ op: "set", name: wire, sourceText: v1.sourceText, ifVersion: refs.items[wire] }])
		expect(landed(again), `re-push refused: ${JSON.stringify(again.conflicts)}`).toBe(true)
		const v2 = (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
		expect(v2.sourceText).toBe(v1.sourceText)

		const after = await errors()
		expect(after.length, `the pushed data wire does not build: ${JSON.stringify(after).slice(0, 400)}`).toBe(before)
		await clean()
	})

	/**
	 * A WIRE FED BY A LEAF (task 4.4; the 2.3 golden `LiteralFanout.a-Demux-of-a-leaf`). The text is legal and both vendors
	 * build it, so it must come back exactly. TwinCAT reached a body it did not have only through PLCopen import, which
	 * crashed on this shape (v1) and reshaped it (v2, DIALECT N22), so it was refused before the import; the native writer
	 * builds the Demux of the leaf (openspec twincat-inproc-host).
	 */
	it("a wire fed by a leaf round-trips", async () => {
		const name = id("fanleaf")
		const wire = inFolder(await projectRoot(), fid("fanleaf", "pou"))
		const items = (await bridge.refs()).items ?? {}
		await pushOps([{ op: "deleteItem", name: wire, ifVersion: items[wire] }])

		const src =
			`PROGRAM ${name}\nVAR\n\tout1 : BOOL;\n\tout2 : BOOL;\nEND_VAR\n` +
			`IMPLEMENTATION LD\nNETWORK\n  split1 := TRUE;\n  out1 := split1;\n  out2 := split1;\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: wire, sourceText: src, ifVersion: null }])
		expect(landed(created), `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)
		const back = (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
		expect(back.sourceText).toBe(src)
		const refs = await bridge.refs()
		await pushOps([{ op: "deleteItem", name: wire, ifVersion: refs.items[wire] }])
	})
})
