/** Method C: the referenced-library precompile runs ONLY when a .library version changed. The .library files are
 *  hashed like any other file and carried in knownItems. A fetch whose knownItems already has them ships NO
 *  signature items (proof it didn't extract); a fetch without them ships the full set. */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, requireHealthy, BASE } from "../harness"

const libSigCount = (f: any) => (f.changed as any[]).filter((i) => i.folder.includes("Library Manager/") && i.folder.split("/").length > 2).length

describe(`endpoints / library-signature gate (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(async () => { await requireHealthy() })

	it(".library resolutions carry a version (the change signal)", async () => {
		const f = await bridge.fetch({ knownItems: {} })
		const manifests = (f.changed as any[]).filter((i) => i.name.toLowerCase().endsWith(".library"))
		expect(manifests.length).toBeGreaterThan(0)
		const resolutions = manifests.map((m) => /^RESOLUTION (.+)$/m.exec(m.sourceText)?.[1] ?? "")
		expect(resolutions.every((r) => r.length > 0)).toBe(true)
		expect(resolutions.some((r) => /\d+\.\d+\.\d+/.test(r))).toBe(true)
	})

	it("unchanged .library versions in knownItems skip the precompile (no signature items); missing ones extract", async () => {
		// A fetch WITHOUT the .library versions extracts → ships the full signature set.
		const cold = await bridge.fetch({ knownItems: {} })
		expect(libSigCount(cold)).toBeGreaterThan(0)
		const known = cold.items as Record<string, string> // includes every .library version
		expect(Object.keys(known).some((k) => k.toLowerCase().endsWith(".library"))).toBe(true)

		// A fetch WITH those versions known → no library changed → NO precompile → NO signature items shipped.
		const warm = await bridge.fetch({ knownItems: known })
		expect(libSigCount(warm)).toBe(0)
	})
})
