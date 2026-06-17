/** POU children lifecycle: add / change / DELETE methods, actions, properties + drop a GET/SET accessor.
 *  The delete cases are the regression for the orphan-removal fix (a removed child must not reappear). */
import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { id, cleanup, requireHealthy, createItem, updateItem, fetchSource, BASE } from "../harness"
import { fb, METHOD, ACTION, PROPERTY } from "../fixtures"

describe(`lifecycle / children (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy(); await cleanup() })
	afterAll(cleanup)

	it("changes a method body in place", async () => {
		const name = id("ch_mbody")
		await createItem(name, fb(name, { children: METHOD("Compute", "Compute := 1;") }))
		await updateItem(name, fb(name, { children: METHOD("Compute", "Compute := 42;") }))
		expect(await fetchSource(name)).toMatch(/Compute := 42/)
	})

	it("adds a method to an existing POU", async () => {
		const name = id("ch_add")
		await createItem(name, fb(name, { children: METHOD("First") }))
		await updateItem(name, fb(name, { children: METHOD("First") + METHOD("Second") }))
		const s = await fetchSource(name)
		expect(s).toContain("METHOD First"); expect(s).toContain("METHOD Second")
	})

	for (const [kindName, build, present, gone] of [
		["METHOD", (keep: string) => METHOD(keep), "METHOD Keep", "METHOD Remove"],
		["ACTION", (keep: string) => ACTION(keep), "ACTION Keep", "ACTION Remove"],
		["PROPERTY", (keep: string) => PROPERTY(keep), "PROPERTY Keep", "PROPERTY Remove"],
	] as [string, (k: string) => string, string, string][]) {
		it(`deletes a ${kindName} (no orphan reappears on pull)`, async () => {
			const name = id(`ch_del_${kindName}`)
			await createItem(name, fb(name, { children: build("Keep") + build("Remove") }))
			expect(await fetchSource(name)).toContain(gone)
			await updateItem(name, fb(name, { children: build("Keep") }))
			const s = await fetchSource(name)
			expect(s).toContain(present)
			expect(s).not.toContain(gone)
		})
	}

	it("drops a property's SET accessor (GET+SET → GET only)", async () => {
		const name = id("ch_acc")
		await createItem(name, fb(name, { children: PROPERTY("Speed", true, true) }))
		expect(await fetchSource(name)).toContain("END_SET")
		await updateItem(name, fb(name, { children: PROPERTY("Speed", true, false) }))
		const s = await fetchSource(name)
		expect(s).toContain("END_GET")
		expect(s).not.toContain("END_SET")
	})

	it("children in sub-folders (incl. a name with a space) round-trip", async () => {
		const name = id("ch_subfolder")
		const children = `\nACTION A1\n%FOLDER Group One\nx := 1;\nEND_ACTION\n` + `\nACTION B1\n%FOLDER Group Two\nx := 2;\nEND_ACTION\n`
		await createItem(name, fb(name, { children }))
		const s = await fetchSource(name)
		expect(s).toMatch(/ACTION A1\s+%FOLDER Group One/)
		expect(s).toMatch(/ACTION B1\s+%FOLDER Group Two/)
	})
})
