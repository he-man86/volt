/** health + build — the contract ops over the pipe. */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, requireHealthy, healthStatus, BASE } from "../harness"

describe(`endpoints / health+build (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(requireHealthy)

	describe("/health", () => {
		it("is a flat projects array; the served row carries the stable identifiers", async () => {
			const h = await bridge.health()
			expect(Array.isArray(h.projects)).toBe(true) // discovery folded into health — no root fields
			expect(healthStatus(h)).toBe("healthy")       // derived from the one serving row
			const served = h.projects.find((p: any) => p.serving)
			expect(typeof served.vendor).toBe("string")   // vendor is per-row now, not a root `platform`
			expect(typeof served.project).toBe("string")
		})
	})

	describe("/build", () => {
		it("returns success + duration + diagnostics[]", async () => {
			const r = await bridge.build({ buildType: "incremental" })
			expect(typeof r.success).toBe("boolean")
			expect(typeof r.duration).toBe("number")
			expect(Array.isArray(r.diagnostics)).toBe(true)
		})
	})
})
