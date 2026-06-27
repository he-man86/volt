/** /health, /build, /instances, /openapi.yaml, /swagger, 404 — the contract endpoints. */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, get, requireHealthy, BASE } from "../harness"

describe(`endpoints / health+build+contract (${BASE})`, () => {
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

	describe("/instances", () => {
		it("returns an instances array (works even when degraded)", async () => {
			const r = await bridge.instances()
			expect(Array.isArray(r.instances)).toBe(true)
		})
	})

	describe("contract", () => {
		it("/openapi.yaml lists every push-op + request schema", async () => {
			const yaml = await bridge.openapi()
			for (const s of ["PushOp", "SetItemOp", "DeleteItemOp", "RefsResponse", "RefItem", "FetchRequest", "BuildRequest"])
				expect(yaml).toContain(`${s}:`)
		})
		it("/refs returns items as a list", async () => {
			const refs = await (await fetch(`${BASE}/refs`)).json()
			expect(Array.isArray(refs.items)).toBe(true)
		})
		it("/swagger serves the UI", async () => {
			const html = await (await fetch(`${BASE}/swagger`)).text()
			expect(html.toLowerCase()).toContain("swagger")
		})
		it("an unknown route is a 404 NOT_FOUND", async () => {
			const r = await get("/no/such/route")
			expect(r.error?.code).toBe("NOT_FOUND")
		})
	})
})
