/** /push — the 4 ops' guards, atomic batch, conflict shapes, and receipt==next-/refs. */
import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { bridge, id, cleanup, requireHealthy, createItem, FOLDER, BASE } from "../harness"
import { fb } from "../fixtures"

describe(`endpoints / push (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy(); await cleanup() })
	afterAll(cleanup)

	it("rejects an update with a wrong ifVersion", async () => {
		const name = id("p_ver")
		await createItem(name, fb(name))
		const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [{ op: "pushItem", name, folder: FOLDER, sourceText: fb(name, { body: "x := 5;" }), ifVersion: "wrongversion" }] })
		expect(r.accepted).toBe(false)
		expect(r.conflicts.some((c: any) => c.name === name)).toBe(true)
	})

	it("rejects a create (ifVersion=null) when the item already exists", async () => {
		const name = id("p_exists")
		await createItem(name, fb(name))
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
		const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [{ op: "deleteItem", name, ifVersion: "wrongversion" }] })
		expect(r.accepted).toBe(false)
	})

	it("applies create + update + delete atomically", async () => {
		const add = id("p_add"), upd = id("p_upd"), del = id("p_del2")
		await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [
			{ op: "pushItem", name: upd, folder: FOLDER, sourceText: fb(upd), ifVersion: null },
			{ op: "pushItem", name: del, folder: FOLDER, sourceText: fb(del), ifVersion: null },
		] })
		const refs = await bridge.refs()
		const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [
			{ op: "pushItem", name: add, folder: FOLDER, sourceText: fb(add, { body: "x := 1;" }), ifVersion: null },
			{ op: "pushItem", name: upd, folder: FOLDER, sourceText: fb(upd, { body: "x := 99;" }), ifVersion: refs.items[upd] },
			{ op: "deleteItem", name: del, ifVersion: refs.items[del] },
		] })
		expect(r.accepted).toBe(true)
		// receipt (newItems) must equal the next /refs exactly
		const after = await bridge.refs()
		expect(r.newProjectVersion).toBe(after.projectVersion)
		expect(r.newItems[add]).toBe(after.items[add])
		expect(after.items).toHaveProperty(add)
		expect(after.items).toHaveProperty(upd)
		expect(after.items).not.toHaveProperty(del)
	})

	it("rejects the WHOLE batch if any op conflicts — nothing applied", async () => {
		const ok = id("p_ok"), bad = id("p_bad")
		await createItem(bad, fb(bad))
		const refs = await bridge.refs()
		const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [
			{ op: "pushItem", name: ok, folder: FOLDER, sourceText: fb(ok), ifVersion: null },      // OK
			{ op: "deleteItem", name: bad, ifVersion: "wrongversion" },                              // CONFLICT
		] })
		expect(r.accepted).toBe(false)
		const after = await bridge.refs()
		expect(after.items).not.toHaveProperty(ok)   // atomic: the OK op was NOT applied
		expect(after.items).toHaveProperty(bad)
	})
})
