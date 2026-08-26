/**
 * Vendor-specific behaviors that were hard-won and must not silently regress.
 *
 * "The string thing" (TwinCAT): TC's CreateChild rejects ANY String vInfo for a FUNCTION POU — the
 * create must OMIT the vInfo (Type.Missing). FB/program take "ST". A regression here re-breaks function
 * create on TwinCAT. This asserts a function actually creates + round-trips on whatever bridge runs.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { id, fid, cleanup, requireHealthy, createItem, fetchItem, BASE } from "./harness"
import { func } from "./fixtures"

describe(`vendor notes (${BASE})`, () => {
	// `requireHealthy` is DESIGNED to poll for up to 60s while an IDE finishes loading — that is its default and
	// it carries a diagnostic for the case ("selected it but it stayed idle — is the IDE still loading?"). This
	// file never called setDefaultTimeout, so bun gave that hook 5s: a budget shorter than the wait it exists to
	// perform. It passed whenever the bridge happened to be ready quickly (measured 1589ms warm, 2174ms cold) and
	// died at exactly 5001ms when it was not — as an anonymous hook failure, because bun kills the hook before
	// the harness can report WHY. Every sibling that drives a live IDE already sets this; the number is not a
	// budget for slow work, it is room for a wait that is already bounded at 60s.
	setDefaultTimeout(180_000)

	beforeAll(async () => { await requireHealthy(); await cleanup() })
	afterAll(cleanup)

	it("a function creates + round-trips", async () => {
		const name = id("vn_func"), wire = fid("vn_func", "fun")
		await createItem(wire, func(name))
		const item = await fetchItem(wire)
		expect(item.sourceText).toMatch(/FUNCTION \w+ : BOOL/)
	})
})
