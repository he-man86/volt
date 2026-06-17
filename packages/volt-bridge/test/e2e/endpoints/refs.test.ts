/** /refs — determinism and the parallel items/kinds/folders maps. */
import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { bridge, id, cleanup, requireHealthy, createItem, FOLDER, BASE } from "../harness"
import { fb } from "../fixtures"

describe(`endpoints / refs (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy(); await cleanup() })
	afterAll(cleanup)

	it("returns projectVersion + structureVersion + items/kinds/folders", async () => {
		const r = await bridge.refs()
		expect(typeof r.projectVersion).toBe("string")
		expect(typeof r.structureVersion).toBe("string")
		expect(typeof r.items).toBe("object")
		expect(typeof r.kinds).toBe("object")
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
		const r = await bridge.refs()
		expect(r.items).toHaveProperty(name)
		expect(r.kinds[name]).toBe("function_block")
		expect(r.folders[name]).toBe("POUs/Sub")
	})
})
