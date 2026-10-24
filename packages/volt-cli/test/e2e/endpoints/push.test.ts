import { landed } from "../harness"
/** /push — the 4 ops' guards, atomic batch, conflict shapes, and receipt==next-/refs. */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, opErrorCode, id, fid, cleanup, requireHealthy, createItem, ensureCompiles, savePlcPrg, restorePlcPrg, fixPlcPrg, FOLDER, BASE, plcFolder, at, applicationRoot } from "../harness"
import { fb } from "../fixtures"

describe(`endpoints / push (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })
	afterAll(cleanup)

	it("rejects an update with a wrong ifVersion", async () => {
		const name = id("p_ver"), wire = await at(fid("p_ver"))
		await createItem(wire, fb(name))
		await ensureCompiles(name)
		const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [{ op: "set", name: wire, sourceText: fb(name, { body: "x := 5;" }), ifVersion: "wrongversion" }] })
		expect(landed(r)).toBe(false)
		// THE CODE, NOT THE SENTENCE. This asserted the exact English, back when the message was the only thing
		// a caller could match on; the gate's four outcomes now carry four codes, and the versions ride along.
		const conflict = r.conflicts.find((c: any) => c.name === wire)
		expect(conflict, `no conflict for ${wire}: ${JSON.stringify(r.conflicts)}`).toBeDefined()
		expect(conflict.code).toBe("STALE_ITEM_VERSION")
		expect(typeof conflict.currentVersion).toBe("string")
	})

	it("rejects a create (ifVersion=null) when the item already exists", async () => {
		const name = id("p_exists"), wire = await at(fid("p_exists"))
		await createItem(wire, fb(name))
		await ensureCompiles(name)
		const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [{ op: "set", name: wire, sourceText: fb(name), ifVersion: null }] })
		expect(landed(r)).toBe(false)
		expect(r.conflicts.some((c: any) => c.name === wire && c.code === "ITEM_EXISTS")).toBe(true)
	})

	// The lease is the request's, not an op's: a stale one is the error frame STALE_PROJECT_VERSION (wire-final-shape §5).
	it("refuses the batch on a wrong expectedProjectVersion with the STALE_PROJECT_VERSION frame", async () => {
		expect(await opErrorCode(() => bridge.push({ expectedProjectVersion: "deadbeef", ops: [] }))).toBe("STALE_PROJECT_VERSION")
	})

	// An item's text is UTF-8 text; a leading U+FEFF is the client file's encoding, not content (wire-final-shape 4.3b:
	// both vendors stored it as the declaration's first character). BAD_REQUEST, and nothing lands.
	it("refuses a sourceText that starts with a byte-order mark, BAD_REQUEST, and writes nothing", async () => {
		const name = id("p_bom"), wire = await at(fid("p_bom"))
		const before = (await bridge.refs()).items
		const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [{ op: "set", name: wire, sourceText: "﻿" + fb(name) }] })
		expect(r.conflicts.map((c: any) => [c.name, c.code])).toEqual([[wire, "BAD_REQUEST"]])
		expect(landed(r)).toBe(false)
		expect((await bridge.refs()).items).toEqual(before)
	})

	it("rejects a delete with a wrong ifVersion", async () => {
		const name = id("p_del"), wire = await at(fid("p_del"))
		await createItem(wire, fb(name))
		await ensureCompiles(name)
		const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [{ op: "deleteItem", name: wire, ifVersion: "wrongversion" }] })
		expect(landed(r)).toBe(false)
		// Same shape as the stale-set case above, and the same code: a delete guarded by a version the IDE has
		// moved past is the same situation as a write guarded by one.
		const stale = r.conflicts.find((c: any) => c.name === wire)
		expect(stale, `no conflict for ${wire}: ${JSON.stringify(r.conflicts)}`).toBeDefined()
		expect(stale.code).toBe("STALE_ITEM_VERSION")
		expect(typeof stale.currentVersion).toBe("string")
	})

	it("accepts a delete without ifVersion of an item that's already gone", async () => {
		// No quoted version: the goal state (absent) already holds — accepted, nothing written.
		const gone = await at(fid("p_gone"))   // never created
		const r = await bridge.push({
			expectedProjectVersion: (await bridge.refs()).projectVersion,
			ops: [{ op: "deleteItem", name: gone }],
		})
		expect(landed(r)).toBe(true)
	})

	it("rejects a delete quoting an ifVersion for an item that's gone (ITEM_MISSING)", async () => {
		// A quoted version must hold: the client's view says the item exists, the IDE says it doesn't.
		const gone = await at(fid("p_gone"))   // never created
		const r = await bridge.push({
			expectedProjectVersion: (await bridge.refs()).projectVersion,
			ops: [{ op: "deleteItem", name: gone, ifVersion: "0000000000000000" }],
		})
		expect(landed(r)).toBe(false)
		expect(r.conflicts.find((c: any) => c.name === gone)?.code).toBe("ITEM_MISSING")
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
		const wire = await at(fid("mv_edit"), await applicationRoot())
		const moved = await at(wire)
		await createItem(wire, fb(name), await applicationRoot())            // starts at the application root (a move stays in its application)

		const refs = await bridge.refs()
		const r = await bridge.push({
			expectedProjectVersion: refs.projectVersion,
			ops: [{
				op: "set",
				name: wire,
				to: moved,                        // …and moves into POUs
				sourceText: fb(name, { body: "x := 42;" }),
				ifVersion: refs.items[wire],
			}],
		})
		expect(landed(r), JSON.stringify(r.conflicts)).toBe(true)

		const after = (await bridge.fetch({ knownItems: {}, onlyItems: [moved] })).changed.find((i: any) => i.name === moved)
		expect(after).toBeDefined()
		expect(after.sourceText).toContain("x := 42;")                     // the edit landed…
		const items = (await bridge.refs()).items
		expect([items[moved] !== undefined, items[wire] !== undefined]).toEqual([true, false])   // …and so did the move,
		// to the REAL folder. This was `.endsWith(FOLDER)` because the push above sent a bare name and
		// landed a stray `POUs` at the project root; an exact compare would have caught that.
	})

	it("applies create + update + delete atomically", async () => {
		const add = id("p_add"), upd = id("p_upd"), del = id("p_del2")
		const addKey = await at(fid("p_add")), updKey = await at(fid("p_upd")), delKey = await at(fid("p_del2"))
		await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [
			{ op: "set", name: updKey, sourceText: fb(upd), ifVersion: null },
			{ op: "set", name: delKey, sourceText: fb(del), ifVersion: null },
		] })
		await ensureCompiles(upd)
		const refs = await bridge.refs()
		const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [
			{ op: "set", name: addKey, sourceText: fb(add, { body: "x := 1;" }), ifVersion: null },
			{ op: "set", name: updKey, sourceText: fb(upd, { body: "x := 99;" }), ifVersion: refs.items[updKey] },
			{ op: "deleteItem", name: delKey, ifVersion: refs.items[delKey] },
		] })
		expect(landed(r)).toBe(true)
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
		const okKey = await at(fid("p_ok")), badKey = await at(fid("p_bad"))
		await createItem(badKey, fb(bad))
		await ensureCompiles(bad)
		const refs = await bridge.refs()
		const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [
			{ op: "set", name: okKey, sourceText: fb(ok), ifVersion: null },      // OK
			{ op: "deleteItem", name: badKey, ifVersion: "wrongversion" },                              // CONFLICT
		] })
		expect(landed(r)).toBe(false)
		const after = await bridge.refs()
		expect(after.items[okKey]).toBeUndefined()   // atomic: the OK op was NOT applied
		expect(after.items[badKey]).toBeDefined()
	})
})
