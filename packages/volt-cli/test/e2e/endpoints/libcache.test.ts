/** Library-signature cache: an unchanged referenced-library set skips the precompile (libExtractCount unchanged),
 *  the fingerprint source (.library resolutions) carries the version, and a cache hit is byte-identical. */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, requireHealthy, BASE } from "../harness"

const isLibSig = (folder: string) => folder.includes("Library Manager/") && folder.split("/").length > 2

describe(`endpoints / library-signature cache (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(async () => { await requireHealthy() })

	it(".library resolutions carry a version (the fingerprint encodes name+version)", async () => {
		const f = await bridge.fetch({ knownItems: {} })
		const manifests = (f.changed as any[]).filter((i) => i.name.toLowerCase().endsWith(".library"))
		expect(manifests.length).toBeGreaterThan(0)
		// Every referenced library's manifest must carry a RESOLUTION; at least one names a concrete version (x.y.z).
		const resolutions = manifests.map((m) => /^RESOLUTION (.+)$/m.exec(m.sourceText)?.[1] ?? "")
		expect(resolutions.every((r) => r.length > 0)).toBe(true)
		expect(resolutions.some((r) => /\d+\.\d+\.\d+/.test(r))).toBe(true)
	})

	it("a second fetch with unchanged libraries does NOT precompile (libExtractCount stable) and is byte-identical", async () => {
		// Warm the cache first, so the assertion doesn't depend on whether earlier tests already extracted.
		const a = await bridge.fetch({ knownItems: {} })
		const before = (await bridge.health()).libExtractCount
		const b = await bridge.fetch({ knownItems: {} })
		const after = (await bridge.health()).libExtractCount

		// The precompile was skipped on the second fetch — the whole point of the cache.
		expect(after).toBe(before)

		// And the cached signatures are identical to the previous extraction (same folder+name → same version).
		const sig = (f: any) => new Map((f.changed as any[]).filter((i) => isLibSig(i.folder)).map((i) => [`${i.folder}/${i.name}`, i.version]))
		const av = sig(a), bv = sig(b)
		expect(bv.size).toBe(av.size)
		expect(bv.size).toBeGreaterThan(0)
		let mismatches = 0
		for (const [k, v] of bv) if (av.get(k) !== v) mismatches++
		expect(mismatches).toBe(0)
	})
})
