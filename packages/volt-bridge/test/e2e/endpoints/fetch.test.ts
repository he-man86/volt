/** /fetch — knownItems (unchanged excluded), onlyItems filter, changed/removed/items semantics. */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, requireHealthy, createItem, updateItem, ensureCompiles, savePlcPrg, restorePlcPrg, fixPlcPrg, FOLDER, BASE } from "../harness"
import { fb } from "../fixtures"

describe(`endpoints / fetch (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })
	afterAll(cleanup)

	it("full fetch returns the item with sourceText + version; items map == /refs", async () => {
		const name = id("f_full")
		await createItem(fid("f_full"), fb(name))
		await ensureCompiles(name)
		const f = await bridge.fetch({ knownItems: {} })
		const it = f.changed.find((i: any) => i.name === name + ".st")
		expect(it).toBeDefined()
		expect(typeof it.sourceText).toBe("string")
		expect(it.version).toBe((await bridge.refs()).items[name + ".st"])
		expect(f.items[name + ".st"]).toBe(it.version)
	})

	it("knownItems excludes an UNCHANGED item from changed[] (but keeps it in items)", async () => {
		const name = id("f_known")
		await createItem(fid("f_known"), fb(name))
		await ensureCompiles(name)
		const v = (await bridge.refs()).items[name + ".st"]
		const f = await bridge.fetch({ knownItems: { [name + ".st"]: v } })
		expect(f.changed.find((i: any) => i.name.startsWith(name + "."))).toBeUndefined()
		expect(f.items[name + ".st"]).toBe(v)
	})

	it("a content edit makes the item reappear in changed[] for a stale knownItems", async () => {
		const name = id("f_edit")
		await createItem(fid("f_edit"), fb(name, { body: "x := 1;" }))
		await ensureCompiles(name)
		const stale = (await bridge.refs()).items[name + ".st"]
		await updateItem(fid("f_edit"), fb(name, { body: "x := 777;" }))
		const f = await bridge.fetch({ knownItems: { [name + ".st"]: stale } })
		const it = f.changed.find((i: any) => i.name === name + ".st")
		expect(it).toBeDefined()
		expect(it.sourceText).toMatch(/x := 777/)
	})

	it("onlyItems restricts the walk to the named subset", async () => {
		const a = id("f_a"), b = id("f_b")
		await createItem(fid("f_a"), fb(a)); await ensureCompiles(a)
		await createItem(fid("f_b"), fb(b)); await ensureCompiles(b)
		const f = await bridge.fetch({ knownItems: {}, onlyItems: [fid("f_a")] })
		expect(f.changed.find((i: any) => i.name === a + ".st")).toBeDefined()
		expect(f.changed.find((i: any) => i.name === b + ".st")).toBeUndefined()
	})

	it("removed[] reports a name the client knew that no longer exists", async () => {
		const f = await bridge.fetch({ knownItems: { [fid("f_ghost")]: "deadbeef" } })
		expect(f.removed).toContain(fid("f_ghost"))
	})

	it("projectVersion + structureVersion match /refs", async () => {
		const f = await bridge.fetch({ knownItems: {} })
		const r = await bridge.refs()
		expect(f.projectVersion).toBe(r.projectVersion)
		expect(f.structureVersion).toBe(r.structureVersion)
	})
})
