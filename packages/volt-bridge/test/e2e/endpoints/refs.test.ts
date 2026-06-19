/** /refs — determinism and the parallel items/kinds/folders maps. */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, id, cleanup, requireHealthy, createItem, ensureCompiles, savePlcPrg, restorePlcPrg, fixPlcPrg, FOLDER, BASE } from "../harness"
import { fb } from "../fixtures"

describe(`endpoints / refs (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })
	afterAll(cleanup)

	it("returns projectVersion + structureVersion + items/folders", async () => {
		const r = await bridge.refs()
		expect(typeof r.projectVersion).toBe("string")
		expect(typeof r.structureVersion).toBe("string")
		expect(typeof r.items).toBe("object")
		expect(typeof r.folders).toBe("object")
	})

	it("is deterministic — two calls with no edits return identical versions", async () => {
		const a = await bridge.refs()
		const b = await bridge.refs()
		expect(a.projectVersion).toBe(b.projectVersion)
		expect(a.structureVersion).toBe(b.structureVersion)
	})

	it("the parallel maps are consistent for a created item", async () => {
		const name = id("r_maps")
		await createItem(name, fb(name), "POUs/Sub")
		await ensureCompiles(name)
		const r = await bridge.refs()
		const fullName = name + ".st"
		expect(r.items[fullName]).toBeDefined()
		expect(r.folders[fullName]).toBe("POUs/Sub")
	})
})
