/** /fetch — knownItems (unchanged excluded), onlyItems filter, changed/removed/items semantics. */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, requireHealthy, createItem, updateItem, ensureCompiles, fetchSource, savePlcPrg, restorePlcPrg, fixPlcPrg, FOLDER, BASE, at, pathOf } from "../harness"
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
		const p = await pathOf(fid("f_full"))
		const f = await bridge.fetch({ knownItems: {} })
		const it = f.changed.find((i: any) => i.name === p)
		expect(it).toBeDefined()
		expect(typeof it.sourceText).toBe("string")
		expect(it.version).toBe((await bridge.refs()).items[p])
		expect(f.items[p]).toBe(it.version)
	})

	it("knownItems excludes an UNCHANGED item from changed[] (but keeps it in items)", async () => {
		const name = id("f_known")
		await createItem(fid("f_known"), fb(name))
		await ensureCompiles(name)
		const p = await pathOf(fid("f_known"))
		const v = (await bridge.refs()).items[p]
		const f = await bridge.fetch({ knownItems: { [p]: v } })
		expect(f.changed.find((i: any) => i.name === p)).toBeUndefined()
		expect(f.items[p]).toBe(v)
	})

	it("a content edit makes the item reappear in changed[] for a stale knownItems", async () => {
		const name = id("f_edit")
		await createItem(fid("f_edit"), fb(name, { body: "x := 1;" }))
		await ensureCompiles(name)
		const p = await pathOf(fid("f_edit"))
		const stale = (await bridge.refs()).items[p]
		await updateItem(fid("f_edit"), fb(name, { body: "x := 777;" }))
		const f = await bridge.fetch({ knownItems: { [p]: stale } })
		const it = f.changed.find((i: any) => i.name === p)
		expect(it).toBeDefined()
		expect(it.sourceText).toMatch(/x := 777/)
	})

	it("emptying a POU body CLEARS it in the IDE — no stale body left behind", async () => {
		// Regression: TwinCAT's WriteText skipped an empty implementation (`!IsNullOrEmpty`), so a POU whose
		// body was emptied kept its OLD body in the IDE (silent data loss; CODESYS cleared it correctly).
		// Now both vendors write on `implementation != null`, so "" clears. Verified on BOTH bridges.
		const name = id("f_emptybody")
		await createItem(fid("f_emptybody"), fb(name, { body: "x := 42;" }))
		await ensureCompiles(name)
		expect(await fetchSource(fid("f_emptybody"))).toMatch(/x := 42/)
		await updateItem(fid("f_emptybody"), fb(name, { body: "" }))
		expect(await fetchSource(fid("f_emptybody"))).not.toMatch(/x := 42/)
	})

	it("onlyItems restricts the walk to the named subset", async () => {
		const a = id("f_a"), b = id("f_b")
		await createItem(fid("f_a"), fb(a)); await ensureCompiles(a)
		await createItem(fid("f_b"), fb(b)); await ensureCompiles(b)
		const pa = await pathOf(fid("f_a")), pb = await pathOf(fid("f_b"))
		const f = await bridge.fetch({ knownItems: {}, onlyItems: [pa] })
		expect(f.changed.find((i: any) => i.name === pa)).toBeDefined()
		expect(f.changed.find((i: any) => i.name === pb)).toBeUndefined()
	})

	it("removed[] reports a name the client knew that no longer exists", async () => {
		const ghost = await at(fid("f_ghost"))
		const f = await bridge.fetch({ knownItems: { [ghost]: "deadbeef" } })
		expect(f.removed).toContain(ghost)
	})

	it("projectVersion matches /refs", async () => {
		const f = await bridge.fetch({ knownItems: {} })
		const r = await bridge.refs()
		expect(f.projectVersion).toBe(r.projectVersion)
	})
})
