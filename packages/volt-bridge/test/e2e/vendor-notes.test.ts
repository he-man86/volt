/**
 * Vendor-specific behaviors that were hard-won and must not silently regress.
 *
 * "The string thing" (TwinCAT): TC's CreateChild rejects ANY String vInfo for a FUNCTION POU — the
 * create must OMIT the vInfo (Type.Missing). FB/program take "ST". A regression here re-breaks function
 * create on TwinCAT. This asserts a function actually creates + round-trips on whatever bridge runs.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { id, cleanup, requireHealthy, createItem, fetchItem, isTwinCAT, BASE } from "./harness"
import { func } from "./fixtures"

describe(`vendor notes (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy(); await cleanup() })
	afterAll(cleanup)

	it("a function creates + round-trips (TwinCAT: proves the omit-vInfo create still works)", async () => {
		const tc = await isTwinCAT()
		const name = id("vn_func")
		await createItem(name, func(name))
		const item = await fetchItem(name)
		expect(item.sourceText).toMatch(/FUNCTION \w+ : BOOL/)
		if (tc) console.info("TwinCAT function create OK — the omit-vInfo (Type.Missing) path holds")
	})
})
