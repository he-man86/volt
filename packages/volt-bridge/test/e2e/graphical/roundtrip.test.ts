/**
 * Graphical bodies — create, round-trip, and verify FBD/LD programs.
 * CFC/SFC are read-only (declaration-only, never created).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test"
import { bridge, id, fid, cleanup, requireHealthy, savePlcPrg, restorePlcPrg, fixPlcPrg, BASE } from "../harness"

function fbdProgram(name: string) {
	return `PROGRAM ${name}
VAR
\tx : BOOL;
\ty : BOOL;
END_VAR

NETWORK 0 FBD
  VAR_TEMP
    i1 : BOOL;
    g1 : BOOL;
  END_VAR
  i1 := x;
  g1 := NOT i1;
  y := g1;
END_NETWORK
END_PROGRAM
`
}

function ldProgram(name: string) {
	return `PROGRAM ${name}
VAR
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
END_VAR

NETWORK 0 LD
  VAR_TEMP
    i1 : BOOL;
    i2 : BOOL;
    g1 : BOOL;
  END_VAR
  i1 := a;
  i2 := b;
  g1 := (i1 AND i2);
  out := g1;
END_NETWORK
END_PROGRAM
`
}

// LD featureset variations (mirror the C# LadderRoundTripTests at the live-bridge layer): a normally-closed
// (negated) contact, a longer series, multiple coils in one network, and a SET coil.
function ldNegated(name: string) {
	return `PROGRAM ${name}
VAR
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
END_VAR

NETWORK 0 LD
  VAR_TEMP
    i1 : BOOL;
    i2 : BOOL;
    g1 : BOOL;
  END_VAR
  i1 := NOT a;
  i2 := b;
  g1 := (i1 AND i2);
  out := g1;
END_NETWORK
END_PROGRAM
`
}
function ldSeries3(name: string) {
	return `PROGRAM ${name}
VAR
\ta : BOOL;
\tb : BOOL;
\tc : BOOL;
\tout : BOOL;
END_VAR

NETWORK 0 LD
  VAR_TEMP
    i1 : BOOL;
    i2 : BOOL;
    i3 : BOOL;
    g1 : BOOL;
  END_VAR
  i1 := a;
  i2 := b;
  i3 := c;
  g1 := (i1 AND i2 AND i3);
  out := g1;
END_NETWORK
END_PROGRAM
`
}
function ldMultiCoil(name: string) {
	return `PROGRAM ${name}
VAR
\ta : BOOL;
\tb : BOOL;
\tq : BOOL;
\tr : BOOL;
END_VAR

NETWORK 0 LD
  VAR_TEMP
    i1 : BOOL;
    i2 : BOOL;
  END_VAR
  i1 := a;
  i2 := b;
  q := i1;
  r := i2;
END_NETWORK
END_PROGRAM
`
}
function ldSetCoil(name: string) {
	return `PROGRAM ${name}
VAR
\ta : BOOL;
\tout : BOOL;
END_VAR

NETWORK 0 LD
  VAR_TEMP
    i1 : BOOL;
  END_VAR
  i1 := a;
  out := i1 SET;
END_NETWORK
END_PROGRAM
`
}

describe(`graphical / round-trip (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })

	for (const [lang, buildSrc] of [["FBD", fbdProgram], ["LD", ldProgram]] as [string, (n: string) => string][]) {
		it(`creates a ${lang} program from scratch and round-trips byte-identical`, async () => {
			const name = id(`vg_${lang.toLowerCase()}`)
			const fullName = fid(`vg_${lang.toLowerCase()}`, lang.toLowerCase())
			const src = buildSrc(name)
			expect(src).toContain("NETWORK")

			const refs = await bridge.refs()
			const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "pushItem", name: fullName, folder: "", sourceText: src, ifVersion: null }] })
			expect(r.accepted).toBe(true)

			const after = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name === fullName)
			expect(after).toBeDefined()
			expect(after.sourceText).toContain("NETWORK")

			// Round-trip: push the same source back, should be accepted and unchanged
			const refs2 = await bridge.refs()
			const r2 = await bridge.push({ expectedProjectVersion: refs2.projectVersion, ops: [{ op: "pushItem", name: fullName, folder: "", sourceText: after.sourceText, ifVersion: refs2.items[fullName] }] })
			expect(r2.accepted).toBe(true)
			const after2 = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name === fullName)
			expect(after2.sourceText).toBe(after.sourceText)
		})
	}

	for (const [label, buildSrc] of [["negated", ldNegated], ["series3", ldSeries3], ["multicoil", ldMultiCoil], ["setcoil", ldSetCoil]] as [string, (n: string) => string][]) {
		it(`LD featureset (${label}) round-trips to a stable .ld body`, async () => {
			const name = id(`vg_ld_${label}`)
			const fullName = fid(`vg_ld_${label}`, "ld")
			const refs = await bridge.refs()
			const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "pushItem", name: fullName, folder: "", sourceText: buildSrc(name), ifVersion: null }] })
			expect(r.accepted).toBe(true)

			const v1 = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name.startsWith(name + "."))
			expect(v1).toBeDefined()
			expect(v1.name.endsWith(".ld")).toBe(true)   // stayed ladder
			expect(v1.sourceText).toContain("NETWORK")

			// Fixed point: pushing the fetched VG back leaves the body byte-identical.
			const refs2 = await bridge.refs()
			const r2 = await bridge.push({ expectedProjectVersion: refs2.projectVersion, ops: [{ op: "pushItem", name: fullName, folder: "", sourceText: v1.sourceText, ifVersion: refs2.items[v1.name] }] })
			expect(r2.accepted).toBe(true)
			const v2 = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name === v1.name)
			expect(v2.sourceText).toBe(v1.sourceText)
		})
	}

	it("a graphical POU in the project re-pushes byte-identical (no phantom drift)", async () => {
		// Self-provisioned (NOT discover()) so it runs identically on every bridge: a fetched graphical
		// body pushed back unchanged must round-trip byte-identical — the no-phantom-drift guarantee on a
		// POU that already lives in the project. (CFC/SFC read-only behaviour is covered vendor-agnostically
		// by GraphicalCodeTests.Cfc_/Sfc_body_is_a_read_only_marker — no live fixture needed.)
		const name = id("vg_existing")
		const fullName = fid("vg_existing", "fbd")
		const refs0 = await bridge.refs()
		expect((await bridge.push({ expectedProjectVersion: refs0.projectVersion, ops: [{ op: "pushItem", name: fullName, folder: "", sourceText: fbdProgram(name), ifVersion: null }] })).accepted).toBe(true)

		const g = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name.startsWith(name + "."))
		expect(g).toBeDefined()
		const s1: string = g.sourceText
		expect(s1).toContain("NETWORK")

		const refs = await bridge.refs()
		const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "pushItem", name: fullName, folder: "", sourceText: s1, ifVersion: refs.items[g.name] }] })
		expect(r.accepted).toBe(true)
		const after = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name === g.name)
		expect(after.sourceText).toBe(s1)
	})

	// ── format guard: a malformed/mismatched push is REFUSED and the IDE item is left untouched (the
	//    bridge is the last line of defence — never lose code). Self-provisioned, runs on both bridges. ──
	it("refuses to overwrite a graphical body with textual ST and leaves it untouched", async () => {
		const name = id("vg_guard_st")
		const fullName = fid("vg_guard_st", "fbd")
		const r0 = await bridge.refs()
		expect((await bridge.push({ expectedProjectVersion: r0.projectVersion, ops: [{ op: "pushItem", name: fullName, folder: "", sourceText: fbdProgram(name), ifVersion: null }] })).accepted).toBe(true)
		const before = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name.startsWith(name + "."))
		expect(before.name.endsWith(".fbd")).toBe(true)

		const r1 = await bridge.refs()
		const stSrc = `PROGRAM ${name}\nVAR\n\tx : BOOL;\nEND_VAR\n\nx := TRUE;\nEND_PROGRAM\n`
		const r = await bridge.push({ expectedProjectVersion: r1.projectVersion, ops: [{ op: "pushItem", name: fullName, folder: "", sourceText: stSrc, ifVersion: r1.items[before.name] }] })
		expect(r.accepted).toBe(false)
		expect(JSON.stringify(r.conflicts)).toContain("graphical")   // clear, actionable reason

		const after = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name.startsWith(name + "."))
		expect(after.name).toBe(before.name)              // still .fbd — never flattened to ST
		expect(after.sourceText).toBe(before.sourceText)  // byte-identical: the bad push never reached the IDE
	})

	it("refuses a malformed graphical body (missing END_NETWORK) and leaves the item untouched", async () => {
		const name = id("vg_guard_malformed")
		const fullName = fid("vg_guard_malformed", "fbd")
		const r0 = await bridge.refs()
		expect((await bridge.push({ expectedProjectVersion: r0.projectVersion, ops: [{ op: "pushItem", name: fullName, folder: "", sourceText: fbdProgram(name), ifVersion: null }] })).accepted).toBe(true)
		const before = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name.startsWith(name + "."))

		const r1 = await bridge.refs()
		const malformed = fbdProgram(name).replace("END_NETWORK\n", "")   // a valid FBD body with END_NETWORK removed
		const r = await bridge.push({ expectedProjectVersion: r1.projectVersion, ops: [{ op: "pushItem", name: fullName, folder: "", sourceText: malformed, ifVersion: r1.items[before.name] }] })
		expect(r.accepted).toBe(false)
		expect(JSON.stringify(r.conflicts)).toContain("END_NETWORK")

		const after = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name.startsWith(name + "."))
		expect(after.sourceText).toBe(before.sourceText)  // unchanged
	})
})
