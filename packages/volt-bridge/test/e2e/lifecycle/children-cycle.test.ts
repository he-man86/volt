/** POU children lifecycle: add / change / DELETE methods, actions, properties + drop a GET/SET accessor.
 *  The delete cases are the regression for the orphan-removal fix (a removed child must not reappear). */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { id, fid, cleanup, requireHealthy, createItem, updateItem, fetchSource, ensureCompiles, savePlcPrg, restorePlcPrg, fixPlcPrg, BASE } from "../harness"
import { fb, METHOD, ACTION, PROPERTY } from "../fixtures"

describe(`lifecycle / children (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })
	afterAll(cleanup)

	it("changes a method body in place", async () => {
		const name = id("ch_mbody"), wire = fid("ch_mbody")
		await createItem(wire, fb(name, { children: METHOD("Compute", "Compute := 1;") }))
		await ensureCompiles(name)
		await updateItem(wire, fb(name, { children: METHOD("Compute", "Compute := 42;") }))
		expect(await fetchSource(wire)).toMatch(/Compute := 42/)
	})

	it("adds a method to an existing POU", async () => {
		const name = id("ch_add"), wire = fid("ch_add")
		await createItem(wire, fb(name, { children: METHOD("First") }))
		await ensureCompiles(name)
		await updateItem(wire, fb(name, { children: METHOD("First") + METHOD("Second") }))
		const s = await fetchSource(wire)
		expect(s).toContain("METHOD First"); expect(s).toContain("METHOD Second")
	})

	for (const [kindName, build, present, gone] of [
		["METHOD", (keep: string) => METHOD(keep), "METHOD Keep", "METHOD Remove"],
		["ACTION", (keep: string) => ACTION(keep), "ACTION Keep", "ACTION Remove"],
		["PROPERTY", (keep: string) => PROPERTY(keep), "PROPERTY Keep", "PROPERTY Remove"],
	] as [string, (k: string) => string, string, string][]) {
		it(`deletes a ${kindName} (no orphan reappears on pull)`, async () => {
			const name = id(`ch_del_${kindName}`), wire = fid(`ch_del_${kindName}`)
			await createItem(wire, fb(name, { children: build("Keep") + build("Remove") }))
			await ensureCompiles(name)
			expect(await fetchSource(wire)).toContain(gone)
			await updateItem(wire, fb(name, { children: build("Keep") }))
			const s = await fetchSource(wire)
			expect(s).toContain(present)
			expect(s).not.toContain(gone)
		})
	}

	it("drops a property's SET accessor (GET+SET → GET only)", async () => {
		const name = id("ch_acc"), wire = fid("ch_acc")
		await createItem(wire, fb(name, { children: PROPERTY("Speed", true, true) }))
		await ensureCompiles(name)
		expect(await fetchSource(wire)).toContain("END_SET")
		await updateItem(wire, fb(name, { children: PROPERTY("Speed", true, false) }))
		const s = await fetchSource(wire)
		expect(s).toContain("END_GET")
		expect(s).not.toContain("END_SET")
	})

	it("children in sub-folders (incl. a name with a space) round-trip", async () => {
		const name = id("ch_subfolder"), wire = fid("ch_subfolder")
		const children = `\nACTION A1\n%FOLDER Group One\nx := 1;\nEND_ACTION\n` + `\nACTION B1\n%FOLDER Group Two\nx := 2;\nEND_ACTION\n`
		await createItem(wire, fb(name, { children }))
		await ensureCompiles(name)
		const s = await fetchSource(wire)
		expect(s).toMatch(/ACTION A1\s+%FOLDER Group One/)
		expect(s).toMatch(/ACTION B1\s+%FOLDER Group Two/)
	})
})
