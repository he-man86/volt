/** /refs — determinism and the parallel items/kinds/folders maps. */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, requireHealthy, createItem, ensureCompiles, savePlcPrg, restorePlcPrg, fixPlcPrg, plcFolder, BASE } from "../harness"
import { fb } from "../fixtures"

describe(`endpoints / refs (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })
	afterAll(cleanup)

	it("returns projectVersion + items/folders + the identity it walked", async () => {
		const r = await bridge.refs()
		expect(typeof r.projectVersion).toBe("string")
		// The identity echo: `fetch` has always had it and `refs` did not, which is backwards for the
		// op `volt status` runs.
		expect(typeof r.platform).toBe("string")
		expect(typeof r.projectName).toBe("string")

		// NOT `typeof r.items === "object"` — which is what this said, and `typeof null` is "object", so the
		// assertion passed for a bridge that returned no maps at all. A project the suite is running against has
		// items; both maps are real objects, and `unreadable` is part of the contract too (an item the walk could
		// not materialize is reported, never silently absent — absence is what a pull turns into a DELETION).
		expect(r.items, "refs.items must be a map, not null").toBeInstanceOf(Object)
		expect(r.folders, "refs.folders must be a map, not null").toBeInstanceOf(Object)
		expect(Object.keys(r.items).length, "the project under test has items").toBeGreaterThan(0)
		expect(Array.isArray(r.unreadable), "refs must report unreadable items").toBe(true)
	})

	it("is deterministic — two calls with no edits return identical versions", async () => {
		const a = await bridge.refs()
		const b = await bridge.refs()
		expect(a.projectVersion).toBe(b.projectVersion)
	})

	it("the parallel maps are consistent for a created item", async () => {
		const name = id("r_maps")
		await createItem(fid("r_maps"), fb(name), await plcFolder("POUs/Sub"))
		await ensureCompiles(name)
		const r = await bridge.refs()
		const fullName = name + ".fb"
		expect(r.items[fullName]).toBeDefined()
		expect(r.folders[fullName]).toBe(await plcFolder("POUs/Sub"))
	})
})
