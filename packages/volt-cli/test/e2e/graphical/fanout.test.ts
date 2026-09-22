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
import { id, fid, bridge, pushOps, requireHealthy, expectVendorDifference, BASE } from "../harness"

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
			`PROGRAM ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout1 : BOOL;\n\tout2 : BOOL;\nEND_VAR\n` +
			`(* @volt-implementation *)\nNETWORK 0 FBD\n  LET g7 := (a AND b);\n  out1 := g7;\n  out2 := g7;\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: wire, toFolder: "", sourceText: src, ifVersion: null }])
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const v1 = (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
		expect(v1).toBeDefined()

		// THE VALUE AND BOTH CONSUMERS ARE THERE ON BOTH VENDORS — and the SHAPE they come back in is not the
		// same, which nothing could see until network text learned to tell the two apart (2026-09-22).
		//
		// A `g<n>` LET is a real fan-out WIRE (a `BoxTreeDemux` the editor draws) and `m<n>` is ONE item driving
		// several coils. They used to share the `g` spelling, so this assertion passed on both vendors while one
		// of them was RESHAPING the body: TwinCAT's only create door is `PlcOpenImport`, whose lowering turns a
		// fan-out into a single assign with two targets — DIALECT D22 recorded exactly that ("fan-out survives
		// as ONE assign with two targets") and read it as a success, because nothing downstream could tell.
		//
		// CODESYS builds live NWL objects and keeps the wire. So this is the same asymmetry as C20 — the shape
		// is Volt's DOOR on TwinCAT, not the vendor's limit; the IDE holds a Demux perfectly well, and editing
		// one that already exists works. No logic is lost either way (one value, two coils), which is why it is
		// named here rather than refused: refusing would make every fan-out body uncreatable on TwinCAT, and
		// `Lenze_MID-S100` alone holds 573 of them.
		const wireName = expectVendorDifference("DIALECT D22 / C20 — the PLCopen importer lowers a fan-out wire", {
			codesys: () => "g",
			twincat: () => "m",
		})
		expect(v1.sourceText).toMatch(new RegExp(String.raw`LET ${wireName}\d+ := \(a AND b\);`))
		expect(v1.sourceText).toMatch(new RegExp(String.raw`out1 := ${wireName}\d+;`))
		expect(v1.sourceText).toMatch(new RegExp(String.raw`out2 := ${wireName}\d+;`))
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
