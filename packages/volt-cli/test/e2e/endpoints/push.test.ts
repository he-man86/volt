/** /push — the 4 ops' guards, atomic batch, conflict shapes, and receipt==next-/refs. */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, requireHealthy, createItem, ensureCompiles, savePlcPrg, restorePlcPrg, fixPlcPrg, FOLDER, BASE, plcFolder } from "../harness"
import { fb } from "../fixtures"

describe(`endpoints / push (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })
	afterAll(cleanup)

	it("rejects an update with a wrong ifVersion", async () => {
		const name = id("p_ver"), wire = fid("p_ver")
		await createItem(wire, fb(name))
		await ensureCompiles(name)
		const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [{ op: "set", name: wire, toFolder: await plcFolder(FOLDER), sourceText: fb(name, { body: "x := 5;" }), ifVersion: "wrongversion" }] })
		expect(r.accepted).toBe(false)
		expect(r.conflicts.some((c: any) => c.name === wire && c.reason === "item changed since you fetched its version")).toBe(true)
	})

	it("rejects a create (ifVersion=null) when the item already exists", async () => {
		const name = id("p_exists"), wire = fid("p_exists")
		await createItem(wire, fb(name))
		await ensureCompiles(name)
		const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [{ op: "set", name: wire, toFolder: await plcFolder(FOLDER), sourceText: fb(name), ifVersion: null }] })
		expect(r.accepted).toBe(false)
		expect(r.conflicts.some((c: any) => c.name === wire && c.reason === "expected to create new item but it already exists")).toBe(true)
	})

	it("rejects the batch on a wrong expectedProjectVersion (<project> conflict)", async () => {
		const r = await bridge.push({ expectedProjectVersion: "deadbeef", ops: [] })
		expect(r.accepted).toBe(false)
		expect(r.conflicts.some((c: any) => c.name === "<project>" && c.reason === "expected project version does not match current project version")).toBe(true)
	})

	it("rejects a delete with a wrong ifVersion", async () => {
		const name = id("p_del"), wire = fid("p_del")
		await createItem(wire, fb(name))
		await ensureCompiles(name)
		const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [{ op: "deleteItem", name: wire, ifVersion: "wrongversion" }] })
		expect(r.accepted).toBe(false)
		expect(r.conflicts.some((c: any) => c.name === wire && c.reason === "item changed since you fetched its version")).toBe(true)
	})

	it("accepts an idempotent delete of an item that's already gone (any ifVersion)", async () => {
		// A delete whose target doesn't exist is a no-op success — the goal state (absent) already holds. This is
		// also the UNREADABLE-sentinel cleanup path (purge an accepted-but-unenumerable item without a real
		// version). Before the fix this was rejected "expected item to exist but it doesn't".
		const gone = fid("p_gone")   // never created
		const r = await bridge.push({
			expectedProjectVersion: (await bridge.refs()).projectVersion,
			ops: [{ op: "deleteItem", name: gone, ifVersion: "UNREADABLE000000" }],
		})
		expect(r.accepted).toBe(true)
	})

	// A MOVE and an EDIT in ONE op, on an item that already exists. `MoveItem` only runs for an existing item
	// changing folder, so every other move+edit here — all creates — takes a different path entirely.
	//
	// It failed on TwinCAT every time, and not intermittently: the content write is a document IMPORT, which
	// invalidates every handle into the item it replaced (DIALECT D4d), and the very next line moved through that
	// same handle. "Item 'X' is deleted or invalidated by an ealier operation!" on every attempt, so no retry
	// could help. The write-then-move ORDER is deliberate and correct (the write is the step that can refuse, so
	// writing first makes a refusal atomic); the handle just cannot be reused across it.
	it("moves an EXISTING item and edits it in one op", async () => {
		const name = id("mv_edit")
		const wire = fid("mv_edit")
		await createItem(wire, fb(name), "")            // starts at the project root

		const refs = await bridge.refs()
		const r = await bridge.push({
			expectedProjectVersion: refs.projectVersion,
			ops: [{
				op: "set",
				name: wire,
				toFolder: await plcFolder(FOLDER),                        // …and moves into POUs
				sourceText: fb(name, { body: "x := 42;" }),
				ifVersion: refs.items[wire],
			}],
		})
		expect(r.accepted).toBe(true)

		const after = (await bridge.fetch({ knownItems: {}, onlyItems: [wire] })).changed.find((i: any) => i.name === wire)
		expect(after).toBeDefined()
		expect(after.sourceText).toContain("x := 42;")                     // the edit landed…
		expect((await bridge.refs()).folders[wire]).toBe(await plcFolder(FOLDER))   // …and so did the move,
		// to the REAL folder. This was `.endsWith(FOLDER)` because the push above sent a bare name and
		// landed a stray `POUs` at the project root; an exact compare would have caught that.
	})

	it("applies create + update + delete atomically", async () => {
		const add = id("p_add"), upd = id("p_upd"), del = id("p_del2")
		const addKey = fid("p_add"), updKey = fid("p_upd"), delKey = fid("p_del2")
		await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [
			{ op: "set", name: updKey, toFolder: await plcFolder(FOLDER), sourceText: fb(upd), ifVersion: null },
			{ op: "set", name: delKey, toFolder: await plcFolder(FOLDER), sourceText: fb(del), ifVersion: null },
		] })
		await ensureCompiles(upd)
		const refs = await bridge.refs()
		const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [
			{ op: "set", name: addKey, toFolder: await plcFolder(FOLDER), sourceText: fb(add, { body: "x := 1;" }), ifVersion: null },
			{ op: "set", name: updKey, toFolder: await plcFolder(FOLDER), sourceText: fb(upd, { body: "x := 99;" }), ifVersion: refs.items[updKey] },
			{ op: "deleteItem", name: delKey, ifVersion: refs.items[delKey] },
		] })
		expect(r.accepted).toBe(true)
		// receipt (newItems) must equal the next /refs exactly
		const after = await bridge.refs()
		expect(r.newProjectVersion).toBe(after.projectVersion)
		expect(r.newItems[addKey]).toBe(after.items[addKey])
		expect(after.items[addKey]).toBeDefined()
		expect(after.items[updKey]).toBeDefined()
		expect(after.items[delKey]).toBeUndefined()
	})

	it("rejects the WHOLE batch if any op conflicts — nothing applied", async () => {
		const ok = id("p_ok"), bad = id("p_bad")
		const okKey = fid("p_ok"), badKey = fid("p_bad")
		await createItem(badKey, fb(bad))
		await ensureCompiles(bad)
		const refs = await bridge.refs()
		const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [
			{ op: "set", name: okKey, toFolder: await plcFolder(FOLDER), sourceText: fb(ok), ifVersion: null },      // OK
			{ op: "deleteItem", name: badKey, ifVersion: "wrongversion" },                              // CONFLICT
		] })
		expect(r.accepted).toBe(false)
		const after = await bridge.refs()
		expect(after.items[okKey]).toBeUndefined()   // atomic: the OK op was NOT applied
		expect(after.items[badKey]).toBeDefined()
	})
})
