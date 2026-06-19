/**
 * Vendor-specific behaviors that were hard-won and must not silently regress.
 *
 * "The string thing" (TwinCAT): TC's CreateChild rejects ANY String vInfo for a FUNCTION POU — the
 * create must OMIT the vInfo (Type.Missing). FB/program take "ST". A regression here re-breaks function
 * create on TwinCAT. This asserts a function actually creates + round-trips on whatever bridge runs.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { id, fid, cleanup, requireHealthy, createItem, fetchItem, BASE } from "./harness"
import { func } from "./fixtures"

describe(`vendor notes (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy(); await cleanup() })
	afterAll(cleanup)

	it("a function creates + round-trips", async () => {
		const name = id("vn_func"), wire = fid("vn_func")
		await createItem(wire, func(name))
		const item = await fetchItem(wire)
		expect(item.sourceText).toMatch(/FUNCTION \w+ : BOOL/)
	})
})
