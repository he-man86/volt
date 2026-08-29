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
 * The IDE mints its own `VarId`, so the wire may come back as a different `g<n>`; what must hold is that the
 * wire SURVIVES and that pull → push is a FIXED POINT.
 */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { id, fid, bridge, pushOps, requireHealthy, BASE } from "../harness"

describe(`graphical / fan-out (${BASE})`, () => {
	setDefaultTimeout(120_000)
	beforeAll(async () => {
		await requireHealthy()
	})

	it("a wire feeding two consumers survives create → pull → push → pull", async () => {
		const name = id("fanout")
		const wire = fid("fanout", "prg")

		// Clean with the item's REAL version, falling back to the UNREADABLE sentinel. A delete keyed only on
		// the sentinel is rejected for an item that IS readable ("item changed since you fetched its version"),
		// so a leftover from a previous run then blocks the create with "already exists" — a self-inflicted
		// red that says nothing about the code under test.
		const clean = async () => {
			const items = (await bridge.refs()).items ?? {}
			await pushOps([{ op: "deleteItem", name: wire, ifVersion: items[wire] ?? "UNREADABLE000000" }])
		}
		await clean()

		const src =
			`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout1 : BOOL;\n\tout2 : BOOL;\nEND_VAR\n\n` +
			`NETWORK 0 FBD\n  LET g7 := (a AND b);\n  out1 := g7;\n  out2 := g7;\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: wire, toFolder: "", sourceText: src, ifVersion: null }])
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const v1 = (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
		expect(v1).toBeDefined()

		// The wire is THERE: a named LET, and both consumers naming it.
		expect(v1.sourceText).toMatch(/LET g\d+ := \(a AND b\);/)
		expect(v1.sourceText).toMatch(/out1 := g\d+;/)
		expect(v1.sourceText).toMatch(/out2 := g\d+;/)
		// …and the erasure signatures are absent: an empty operand, or a bare statement.
		expect(v1.sourceText).not.toContain("( AND")
		expect(v1.sourceText).not.toMatch(/^\s*;\s*$/m)

		// FIXED POINT — push back exactly what was pulled, and the next pull is byte-identical.
		const refs = await bridge.refs()
		const again = await pushOps([
			{ op: "set", name: wire, sourceText: v1.sourceText, ifVersion: refs.items[wire] },
		])
		expect(again.accepted, `re-push refused: ${JSON.stringify(again.conflicts)}`).toBe(true)

		const v2 = (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
		expect(v2.sourceText).toBe(v1.sourceText)

		await clean()
	})
})
