/** /push — the 4 ops' guards, atomic batch, conflict shapes, and receipt==next-/refs. */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, id, cleanup, requireHealthy, createItem, ensureCompiles, savePlcPrg, restorePlcPrg, fixPlcPrg, FOLDER, BASE } from "../harness"
import { fb } from "../fixtures"

describe(`endpoints / push (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })
	afterAll(cleanup)

	it("rejects an update with a wrong ifVersion", async () => {
		const name = id("p_ver")
		await createItem(name, fb(name))
		await ensureCompiles(name)
		const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [{ op: "pushItem", name, folder: FOLDER, sourceText: fb(name, { body: "x := 5;" }), ifVersion: "wrongversion" }] })
		expect(r.accepted).toBe(false)
		expect(r.conflicts.some((c: any) => c.name === name)).toBe(true)
	})

	it("rejects a create (ifVersion=null) when the item already exists", async () => {
		const name = id("p_exists")
		await createItem(name, fb(name))
		await ensureCompiles(name)
		const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [{ op: "pushItem", name, folder: FOLDER, sourceText: fb(name), ifVersion: null }] })
		expect(r.accepted).toBe(false)
	})

	it("rejects the batch on a wrong expectedProjectVersion (<project> conflict)", async () => {
		const r = await bridge.push({ expectedProjectVersion: "deadbeef", ops: [] })
		expect(r.accepted).toBe(false)
		expect(r.conflicts.some((c: any) => c.name === "<project>")).toBe(true)
	})

	it("rejects a delete with a wrong ifVersion", async () => {
		const name = id("p_del")
		await createItem(name, fb(name))
		await ensureCompiles(name)
		const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [{ op: "deleteItem", name, ifVersion: "wrongversion" }] })
		expect(r.accepted).toBe(false)
	})

	it("applies create + update + delete atomically", async () => {
		const add = id("p_add"), upd = id("p_upd"), del = id("p_del2")
		await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [
			{ op: "pushItem", name: upd, folder: FOLDER, sourceText: fb(upd), ifVersion: null },
			{ op: "pushItem", name: del, folder: FOLDER, sourceText: fb(del), ifVersion: null },
		] })
		await ensureCompiles(upd)
		const refs = await bridge.refs()
		const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [
			{ op: "pushItem", name: add, folder: FOLDER, sourceText: fb(add, { body: "x := 1;" }), ifVersion: null },
			{ op: "pushItem", name: upd, folder: FOLDER, sourceText: fb(upd, { body: "x := 99;" }), ifVersion: refs.items[upd + ".st"] },
			{ op: "deleteItem", name: del, ifVersion: refs.items[del + ".st"] },
		] })
		expect(r.accepted).toBe(true)
		// receipt (newItems) must equal the next /refs exactly
		const after = await bridge.refs()
		const addKey = add + ".st"
		const updKey = upd + ".st"
		const delKey = del + ".st"
		expect(r.newProjectVersion).toBe(after.projectVersion)
		expect(r.newItems[addKey]).toBe(after.items[addKey])
		expect(after.items[addKey]).toBeDefined()
		expect(after.items[updKey]).toBeDefined()
		expect(after.items[delKey]).toBeUndefined()
	})

	it("rejects the WHOLE batch if any op conflicts — nothing applied", async () => {
		const ok = id("p_ok"), bad = id("p_bad")
		await createItem(bad, fb(bad))
		await ensureCompiles(bad)
		const refs = await bridge.refs()
		const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [
			{ op: "pushItem", name: ok, folder: FOLDER, sourceText: fb(ok), ifVersion: null },      // OK
			{ op: "deleteItem", name: bad, ifVersion: "wrongversion" },                              // CONFLICT
		] })
		expect(r.accepted).toBe(false)
		const after = await bridge.refs()
		const okKey = ok + ".st"
		const badKey = bad + ".st"
		expect(after.items[okKey]).toBeUndefined()   // atomic: the OK op was NOT applied
		expect(after.items[badKey]).toBeDefined()
	})
})
