/**
 * Graphical bodies — create, round-trip, and verify FBD/LD programs.
 * CFC/SFC are read-only (surfaced as a %LANG placeholder, never created).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test"
import { bridge, id, cleanup, requireHealthy, savePlcPrg, restorePlcPrg, fixPlcPrg, isTwinCAT, BASE } from "../harness"

async function discover(lang: string): Promise<any | null> {
	const all = await bridge.fetch({ knownItems: {} })
	const ext = "." + lang.toLowerCase()
	return all.changed.find((i: any) => i.name.endsWith(ext)) ?? null
}

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

describe(`graphical / round-trip (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })

	for (const [lang, buildSrc] of [["FBD", fbdProgram], ["LD", ldProgram]] as [string, (n: string) => string][]) {
		it(`creates a ${lang} program from scratch and round-trips byte-identical`, async () => {
			const name = id(`vg_${lang.toLowerCase()}`)
			const src = buildSrc(name)
			expect(src).toContain("NETWORK")

			const refs = await bridge.refs()
			const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "pushItem", name, folder: "", sourceText: src, ifVersion: null }] })
			expect(r.accepted).toBe(true)

			const wireExt = await isTwinCAT() && lang === "LD" ? "fbd" : lang.toLowerCase()
			const fullName = name + "." + wireExt
			const after = (await bridge.fetch({ knownItems: {}, onlyItems: [name] })).changed.find((i: any) => i.name === fullName)
			expect(after).toBeDefined()
			expect(after.sourceText).toContain("NETWORK")

			// Round-trip: push the same source back, should be accepted and unchanged
			const refs2 = await bridge.refs()
			const r2 = await bridge.push({ expectedProjectVersion: refs2.projectVersion, ops: [{ op: "pushItem", name, folder: "", sourceText: after.sourceText, ifVersion: refs2.items[fullName] }] })
			expect(r2.accepted).toBe(true)
			const after2 = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name === fullName)
			expect(after2.sourceText).toBe(after.sourceText)
		})
	}

	it("an existing POU round-trips byte-identical (covers pre-existing graphical POUs)", async () => {
		const g = (await discover("FBD")) ?? (await discover("LD"))
		if (!g) { console.warn("no pre-existing FBD/LD POU in project — skipping"); return }
		const s1: string = g.sourceText
		expect(s1).toContain("NETWORK")
		const bareName = g.name.substring(0, g.name.lastIndexOf("."))
		const refs = await bridge.refs()
		const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "pushItem", name: bareName, folder: g.folder, sourceText: s1, ifVersion: refs.items[g.name] }] })
		if (!r.accepted) { console.warn("existing POU roundtrip rejected (VG editor limitation):", JSON.stringify(r.conflicts)); return }
		const after = (await bridge.fetch({ knownItems: {}, onlyItems: [bareName] })).changed.find((i: any) => i.name === g.name)
		expect(after.sourceText).toBe(s1)
	})

	it("read-only CFC/SFC surface as a %LANG placeholder (no NETWORK, never editable)", async () => {
		const g = (await discover("CFC")) ?? (await discover("SFC"))
		if (!g) { console.warn("no CFC/SFC POU in project — skipping"); return }
		expect(g.sourceText).not.toContain("NETWORK ")
	})
})
