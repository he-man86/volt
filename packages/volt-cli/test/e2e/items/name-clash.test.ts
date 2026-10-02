/**
 * A FOLDER AND A SIBLING OBJECT OF THE SAME NAME, CREATED IN ONE PUSH — live, on both vendors.
 *
 * DIALECT D34: **TwinCAT will not create a folder whose name an object at that level already has.** The two may
 * COEXIST; what is refused is making the FOLDER second, with the vendor's own words `A file or folder with the
 * name 'X' already exists on disk at this location`. So it is an ORDER constraint, and order is something a push
 * chooses — which turns a reported vendor limit back into a Volt one. `PushService` creates a folder's contents
 * before any item that shares the folder's name.
 *
 * What it cost: `lenze-mid` holds a folder `UDT_CamControlLS/` beside a DUT of that name — the only such pair in
 * six real customer projects — and four of its DUTs could not be migrated into TwinCAT at all.
 *
 * `CreateOrderTests` pins the ORDER offline, against the fake's recorded call sequence. That is the right place
 * for "which create ran first" and the wrong place for "and the vendor accepted it": the fake accepts everything,
 * so the test that proves the rule cannot prove the rule was needed. This is the half only a live IDE can answer.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { id, fid, cleanup, requireHealthy, pushOps, fetchItem, plcFolder, BASE } from "../harness"
import { structDut, fb } from "../fixtures"

describe(`lifecycle / folder-vs-object name clash (${BASE})`, () => {
	setDefaultTimeout(120_000)
	beforeAll(async () => {
		await requireHealthy()
		await cleanup()
	})
	afterAll(async () => {
		try {
			await cleanup()
		} catch {}
	})

	/**
	 * THE REGRESSION, sent in the order that breaks it: the object FIRST, which is the order a corpus walk
	 * produces. If `PushService` stops re-ordering, TwinCAT refuses the folder and this push is rejected.
	 */
	it("a DUT and a folder of that name are created in one push, object-first", async () => {
		const clash = id("clash")
		const root = await plcFolder()
		const inside = root ? `${root}/${clash}` : clash

		const r = await pushOps([
			// The sibling DUT, named exactly like the folder below it.
			{ op: "set", name: fid("clash", "dut"), toFolder: root, sourceText: structDut(clash), ifVersion: null },
			// ...and the folder's content, which is what forces the folder to exist.
			{ op: "set", name: fid("clash_inner"), toFolder: inside, sourceText: fb(id("clash_inner")), ifVersion: null },
		])

		expect(r.accepted, `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)

		// Both landed, and each where it was asked to — the coexistence D34 says is legal.
		expect((await fetchItem(fid("clash", "dut"))).folder ?? "").toBe(root)
		expect((await fetchItem(fid("clash_inner"))).folder ?? "").toBe(inside)
	})
})
