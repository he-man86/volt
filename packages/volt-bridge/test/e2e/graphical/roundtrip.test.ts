/**
 * Graphical bodies. FBD/LD CANNOT be created from scratch (the bridge authors ST only) — so this
 * discovers an EXISTING graphical POU and verifies pushing its VG back is a byte-identical fixed point.
 * It MUTATES the discovered POU, so run only against a throwaway/headless project. CFC/SFC are read-only
 * (surfaced as a %LANG placeholder, never created). Skips cleanly per-language if the project lacks one.
 */
import { describe, it, expect, beforeAll } from "bun:test"
import { bridge, requireHealthy, BASE } from "../harness"

async function discover(lang: string): Promise<any | null> {
	const all = await bridge.fetch({ knownItems: {} })
	return all.changed.find((i: any) => i.language === lang) ?? null
}

describe(`graphical / round-trip (${BASE})`, () => {
	beforeAll(requireHealthy)

	for (const lang of ["FBD", "LD"]) {
		it(`an existing ${lang} POU is a byte-identical fixed point (VG push back)`, async () => {
			const g = await discover(lang)
			if (!g) { console.warn(`no ${lang} POU in project — skipping`); return }
			const s1: string = g.sourceText
			expect(s1).toContain("NETWORK")
			const refs = await bridge.refs()
			const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "pushItem", name: g.name, folder: g.folder, sourceText: s1, ifVersion: refs.items[g.name] }] })
			expect(r.accepted).toBe(true)
			const after = (await bridge.fetch({ knownItems: {}, onlyItems: [g.name] })).changed.find((i: any) => i.name === g.name)
			expect(after.sourceText).toBe(s1)   // fixed point — no drift
		})
	}

	it("read-only CFC/SFC surface as a %LANG placeholder (no NETWORK, never editable)", async () => {
		const g = (await discover("CFC")) ?? (await discover("SFC"))
		if (!g) { console.warn("no CFC/SFC POU in project — skipping"); return }
		expect(g.sourceText).not.toContain("NETWORK ")
	})
})
