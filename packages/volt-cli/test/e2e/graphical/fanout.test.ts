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
 * CODESYS keeps the wire under the VarId the text gave it; TwinCAT's importer folds it into one assign. What must hold
 * on both is that the value and both consumers SURVIVE and that pull → push is a FIXED POINT.
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
		const wire = fid("fanout", "pou")

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
			`IMPLEMENTATION FBD\nNETWORK\n  VAR_TEMP g7 : BOOL; END_VAR\n  g7 := (a AND b);\n  out1 := g7;\n  out2 := g7;\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: wire, toFolder: "", sourceText: src, ifVersion: null }])
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const v1 = (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
		expect(v1).toBeDefined()

		// THE VALUE AND BOTH CONSUMERS ARE THERE ON BOTH VENDORS — and the SHAPE they come back in is not the
		// same, which nothing could see until network text learned to tell the two apart (2026-09-22).
		//
		// A wire declared in the network's `VAR_TEMP` block is a real fan-out (a `BoxTreeDemux` the editor draws);
		// a chained assignment (`out1 :=` / `out2 := v;`) is ONE item driving several coils. v1 spelled both as
		// `LET g`, so this assertion passed on both vendors while one of them was RESHAPING the body: TwinCAT's only
		// create door is `PlcOpenImport`, whose lowering turns a fan-out into a single assign with two targets —
		// DIALECT D22 recorded exactly that ("fan-out survives as ONE assign with two targets") and read it as a
		// success, because nothing downstream could tell.
		//
		// CODESYS builds live NWL objects and keeps the wire, under the VarId the text gave it (the writer writes it
		// verbatim). So this is the same asymmetry as C20 — the shape is Volt's DOOR on TwinCAT, not the vendor's
		// limit; the IDE holds a Demux perfectly well, and editing one that already exists works. No logic is lost
		// either way (one value, two coils), which is why it is named here rather than refused: refusing would make
		// every fan-out body uncreatable on TwinCAT, and `Lenze_MID-S100` alone holds 573 of them.
		const shape = expectVendorDifference("DIALECT D22 / C20 — the PLCopen importer lowers a fan-out wire", {
			codesys: () => "  VAR_TEMP g7 : BOOL; END_VAR\n  g7 := (a AND b);\n  out1 := g7;\n  out2 := g7;\n",
			twincat: () => "  out1 :=\n  out2 := (a AND b);\n",
		})
		expect(v1.sourceText).toContain(shape)
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
	/**
	 * A DATA WIRE (review of section 4). The text states its type only in `VAR_TEMP g1 : INT`, and CODESYS keeps a
	 * box's output type in `OutputParams.Types`, which it never fills itself (DIALECT N21). The writer appended no type,
	 * so the pushed ADD re-read typeless: the next pull was the marker ("a wire of unknown type") and the next push of
	 * the same text was refused. Every other wire here is BOOL, which the rule types without a stored type — so nothing
	 * pushed a data wire until this. It must come back as written, push again unchanged, and BUILD (the box now carries
	 * a typed output slot the vendor's own boxes carry). TwinCAT's import folds a fan-out into one assign (D22).
	 */
	it("a data wire comes back declared as pushed, pushes again, and builds", async () => {
		const name = id("fanint")
		const wire = fid("fanint", "pou")
		const clean = async () => {
			const items = (await bridge.refs()).items ?? {}
			await pushOps([{ op: "deleteItem", name: wire, ifVersion: items[wire] ?? "UNREADABLE000000" }])
		}
		await clean()
		// Counted, not attributed: a build diagnostic names no POU, and a PROGRAM cannot be instantiated to force it
		// (`ensureCompiles`) — the baseline is whatever the fixture reports without it (labels.test.ts, same reason).
		const errors = async () => ((await bridge.build()).diagnostics ?? []).filter((d: any) => d.severity === "error")
		const before = (await errors()).length

		const src =
			`PROGRAM ${name}\nVAR\n\ta : INT;\n\tb : INT;\n\tn : INT;\n\tsv : INT;\nEND_VAR\n` +
			`IMPLEMENTATION FBD\nNETWORK\n  VAR_TEMP g1 : INT; END_VAR\n  g1 := (a + b);\n  n := g1;\n  sv := g1;\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: wire, toFolder: "", sourceText: src, ifVersion: null }])
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const v1 = (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
		const shape = expectVendorDifference("DIALECT D22 / C20 — the PLCopen importer lowers a fan-out wire", {
			codesys: () => "  VAR_TEMP g1 : INT; END_VAR\n  g1 := (a + b);\n  n := g1;\n  sv := g1;\n",
			twincat: () => "  n :=\n  sv := (a + b);\n",
		})
		expect(v1.sourceText).toContain(shape)

		const refs = await bridge.refs()
		const again = await pushOps([{ op: "set", name: wire, sourceText: v1.sourceText, ifVersion: refs.items[wire] }])
		expect(again.accepted, `re-push refused: ${JSON.stringify(again.conflicts)}`).toBe(true)
		const v2 = (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
		expect(v2.sourceText).toBe(v1.sourceText)

		const after = await errors()
		expect(after.length, `the pushed data wire does not build: ${JSON.stringify(after).slice(0, 400)}`).toBe(before)
		await clean()
	})

	/**
	 * A WIRE FED BY A LEAF (task 4.4; the 2.3 golden `LiteralFanout.a-Demux-of-a-leaf`). The text is legal and CODESYS
	 * builds it natively, so it must come back exactly. TwinCAT reaches a body it does not have only through PLCopen
	 * import, which crashed on this shape (the v1 `LiteralFanoutBugTests`); the driver refuses it by name
	 * (`NETWORK_UNSUPPORTED`, naming the network and the wire) BEFORE the import — never an importer crash, never a
	 * reshape (spec, "TwinCAT structural edits are refused where the import is unmeasured"; 1.16 says how much rides on it).
	 */
	it("a wire fed by a leaf round-trips on CODESYS and is refused by name before TwinCAT's import", async () => {
		const name = id("fanleaf")
		const wire = fid("fanleaf", "pou")
		const items = (await bridge.refs()).items ?? {}
		await pushOps([{ op: "deleteItem", name: wire, ifVersion: items[wire] ?? "UNREADABLE000000" }])

		const src =
			`PROGRAM ${name}\nVAR\n\tout1 : BOOL;\n\tout2 : BOOL;\nEND_VAR\n` +
			`IMPLEMENTATION LD\nNETWORK\n  VAR_TEMP g1 : BOOL; END_VAR\n  g1 := TRUE;\n  out1 := g1;\n  out2 := g1;\nEND_NETWORK\n\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: wire, toFolder: "", sourceText: src, ifVersion: null }])
		const outcome = expectVendorDifference("spec: a leaf wire is refused before TwinCAT's unmeasured import", {
			codesys: () => "created",
			twincat: () => "refused",
		})
		if (outcome === "refused") {
			expect(created.accepted, "TwinCAT accepted a leaf wire its import is not measured for").toBe(false)
			const why = JSON.stringify(created.conflicts)
			expect(why).toContain("NETWORK_UNSUPPORTED")
			expect(why).toContain("network 1")
			expect(why).toContain("g1")
			return
		}
		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)
		const back = (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
		expect(back.sourceText).toBe(src)
		const refs = await bridge.refs()
		await pushOps([{ op: "deleteItem", name: wire, ifVersion: refs.items[wire] }])
	})
})
