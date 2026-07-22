/** Method C: the referenced-library precompile runs ONLY when a .library version changed. The .library files are
 *  hashed like any other file and carried in knownItems, so a fetch whose knownItems already has them skips the
 *  build (libExtractCount stays flat) and ships no signature items; a fetch without them extracts. */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, requireHealthy, BASE } from "../harness"

const isLibSig = (folder: string) => folder.includes("Library Manager/") && folder.split("/").length > 2

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

	it("unchanged .library versions in knownItems skip the precompile; missing ones extract", async () => {
		// Baseline fetch → its `items` map carries every .library version.
		const first = await bridge.fetch({ knownItems: {} })
		const known = first.items as Record<string, string>
		expect(Object.keys(known).some((k) => k.toLowerCase().endsWith(".library"))).toBe(true)

		// Fetch again WITH those versions known → no library changed → no precompile, no signature items.
		const before = (await bridge.health()).libExtractCount
		const second = await bridge.fetch({ knownItems: known })
		const after = (await bridge.health()).libExtractCount
		expect(after).toBe(before)
		expect((second.changed as any[]).filter((i) => isLibSig(i.folder)).length).toBe(0)

		// Control: a fetch WITHOUT the .library versions must extract (the gate works both ways).
		await bridge.fetch({ knownItems: {} })
		expect((await bridge.health()).libExtractCount).toBeGreaterThan(after)
	})
})
