/** /fetch — knownItems (unchanged excluded), onlyItems filter, changed/removed/items semantics. */
import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { bridge, id, cleanup, requireHealthy, createItem, updateItem, FOLDER, BASE } from "../harness"
import { fb } from "../fixtures"

describe(`endpoints / fetch (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy(); await cleanup() })
	afterAll(cleanup)

	it("full fetch returns the item with sourceText + version; items map == /refs", async () => {
		const name = id("f_full")
		await createItem(name, fb(name))
		const f = await bridge.fetch({ knownItems: {} })
		const it = f.changed.find((i: any) => i.name === name)
		expect(it).toBeDefined()
		expect(typeof it.sourceText).toBe("string")
		expect(it.version).toBe((await bridge.refs()).items[name])
		expect(f.items[name]).toBe(it.version)
	})

	it("knownItems excludes an UNCHANGED item from changed[] (but keeps it in items)", async () => {
		const name = id("f_known")
		await createItem(name, fb(name))
		const v = (await bridge.refs()).items[name]
		const f = await bridge.fetch({ knownItems: { [name]: v } })
		expect(f.changed.find((i: any) => i.name === name)).toBeUndefined()  // unchanged ⇒ not shipped
		expect(f.items[name]).toBe(v)                                        // still in the full map
	})

	it("a content edit makes the item reappear in changed[] for a stale knownItems", async () => {
		const name = id("f_edit")
		await createItem(name, fb(name, { body: "x := 1;" }))
		const stale = (await bridge.refs()).items[name]
		await updateItem(name, fb(name, { body: "x := 777;" }))
		const f = await bridge.fetch({ knownItems: { [name]: stale } })
		const it = f.changed.find((i: any) => i.name === name)
		expect(it).toBeDefined()
		expect(it.sourceText).toMatch(/x := 777/)
	})

	it("onlyItems restricts the walk to the named subset", async () => {
		const a = id("f_a"), b = id("f_b")
		await createItem(a, fb(a)); await createItem(b, fb(b))
		const f = await bridge.fetch({ knownItems: {}, onlyItems: [a] })
		expect(f.changed.find((i: any) => i.name === a)).toBeDefined()
		expect(f.changed.find((i: any) => i.name === b)).toBeUndefined()
	})

	it("removed[] reports a name the client knew that no longer exists", async () => {
		const f = await bridge.fetch({ knownItems: { [id("f_ghost")]: "deadbeef" } })
		expect(f.removed).toContain(id("f_ghost"))
	})

	it("projectVersion + structureVersion match /refs", async () => {
		const f = await bridge.fetch({ knownItems: {} })
		const r = await bridge.refs()
		expect(f.projectVersion).toBe(r.projectVersion)
		expect(f.structureVersion).toBe(r.structureVersion)
	})
})
