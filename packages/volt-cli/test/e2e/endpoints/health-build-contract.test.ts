/** health + build — the contract ops over the pipe. */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, requireHealthy, BASE } from "../harness"

describe(`endpoints / health+build (${BASE})`, () => {
	setDefaultTimeout(60_000)
	beforeAll(requireHealthy)

	describe("/health", () => {
		it("reports healthy + the stable identifiers", async () => {
			const h = await bridge.health()
			expect(h.status).toBe("healthy")
			expect(h.connected).toBe(true)
			expect(typeof h.platform).toBe("string")
			expect(typeof h.version).toBe("string")
		})
		it("degraded is false and degradedReason null when healthy", async () => {
			const h = await bridge.health()
			expect(h.degraded).toBe(false)
			expect(h.degradedReason).toBeNull()
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
