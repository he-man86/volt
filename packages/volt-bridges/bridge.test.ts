/**
 * Beckhoff bridge contract tests — runs against a live TwinCAT bridge
 * on `VOLT_TC_PORT` (default 8555). Tests every endpoint and the
 * polymorphic PushOp discriminated union in Swagger.
 */
import { describe, expect, it, beforeAll, afterAll } from "bun:test"

const PORT = Number.parseInt(process.env.VOLT_TC_PORT ?? "8555", 10)
const BASE = `http://127.0.0.1:${PORT}`

async function get(path: string): Promise<{ status: number; body: any }> {
	const r = await fetch(`${BASE}${path}`)
	return { status: r.status, body: await r.json() }
}

async function post(path: string, data?: unknown): Promise<{ status: number; body: any }> {
	const r = await fetch(`${BASE}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data ?? {}),
	})
	return { status: r.status, body: await r.json() }
}

let itemNames: string[]

async function requireAlive(): Promise<void> {
	const h = await get("/health")
	if (h.body.status !== "healthy") throw new Error(`Bridge not healthy: ${h.body.status}`)
}

async function currentVersion(): Promise<string> {
	return (await get("/refs")).body.projectVersion
}

async function deleteItem(name: string): Promise<void> {
	const refs = await get("/refs")
	if (!refs.body.items[name]) return
	const r = await post("/push", {
		expectedProjectVersion: refs.body.projectVersion,
		ops: [{ op: "deleteItem", name, ifVersion: refs.body.items[name] }],
	})
	if (!r.body.accepted) console.warn(`cleanup: failed to delete ${name}:`, JSON.stringify(r.body.conflicts))
}

describe("Beckhoff bridge", () => {
	beforeAll(requireAlive)

	describe("/health", () => {
		it("returns healthy with project info", async () => {
			const r = await get("/health")
			expect(r.status).toBe(200)
			expect(r.body.status).toBe("healthy")
			expect(r.body.connected).toBe(true)
			expect(r.body.ideAlive).toBe(true)
			expect(typeof r.body.ideName).toBe("string")
			expect(typeof r.body.version).toBe("string")
		})

		it("degraded is false when everything works", async () => {
			const r = await get("/health")
			expect(r.body.degraded).toBe(false)
			expect(r.body.degradedReason).toBeNull()
		})
	})

	describe("/refs", () => {
		it("returns projectVersion + structureVersion + items", async () => {
			const r = await get("/refs")
			expect(r.status).toBe(200)
			expect(typeof r.body.projectVersion).toBe("string")
			expect(typeof r.body.structureVersion).toBe("string")
			expect(typeof r.body.items).toBe("object")
			expect(typeof r.body.kinds).toBe("object")
			expect(typeof r.body.folders).toBe("object")
			itemNames = Object.keys(r.body.items)
			expect(itemNames.length).toBeGreaterThan(0)
		})

		it("projectVersion is deterministic across repeated calls", async () => {
			const r1 = await get("/refs")
			const r2 = await get("/refs")
			expect(r1.body.projectVersion).toBe(r2.body.projectVersion)
		})
	})

	describe("/fetch", () => {
		it("full fetch returns all items", async () => {
			const r = await post("/fetch", { knownItems: {} })
			expect(r.status).toBe(200)
			expect(Array.isArray(r.body.changed)).toBe(true)
			expect(Array.isArray(r.body.removed)).toBe(true)
			expect(r.body.projectVersion).toBe((await get("/refs")).body.projectVersion)
		})

		it("returned items have sourceText + version", async () => {
			const r = await post("/fetch", { knownItems: {} })
			for (const item of r.body.changed) {
				expect(typeof item.name).toBe("string")
				expect(typeof item.sourceText).toBe("string")
				expect(typeof item.version).toBe("string")
			}
		})

		it("projectVersion matches /refs", async () => {
			const f = await post("/fetch", { knownItems: {} })
			const r = await get("/refs")
			expect(f.body.projectVersion).toBe(r.body.projectVersion)
		})
	})

	describe("/push", () => {
		it("rejects bad expectedProjectVersion with <project> conflict", async () => {
			const r = await post("/push", { expectedProjectVersion: "deadbeef", ops: [] })
			expect(r.body.accepted).toBe(false)
			expect(r.body.conflicts.some((c: any) => c.name === "<project>")).toBe(true)
		})

		it("empty push with correct projectVersion is accepted", async () => {
			const pv = await currentVersion()
			const r = await post("/push", { expectedProjectVersion: pv, ops: [] })
			expect(r.body.accepted).toBe(true)
		})

		it("create + fetch + delete round-trip", async () => {
			const pv = await currentVersion()
			const create = await post("/push", {
				expectedProjectVersion: pv,
				ops: [{ op: "pushItem", name: "FB_VoltTest", folder: "POUs", sourceText: "FUNCTION_BLOCK FB_VoltTest\nVAR\n  x : INT;\nEND_VAR\n\nx := 42;\nEND_FUNCTION_BLOCK\n", ifVersion: null }],
			})
			expect(create.body.accepted).toBe(true)

			const fetchResult = await post("/fetch", { knownItems: {} })
			const item = fetchResult.body.changed.find((i: any) => i.name === "FB_VoltTest" || i.name.startsWith("FB_VoltTest."))
			expect(item).toBeDefined()

			await deleteItem("FB_VoltTest")
		})

		it("conflict on wrong ifVersion", async () => {
			const pv = await currentVersion()
			const create = await post("/push", {
				expectedProjectVersion: pv,
				ops: [{ op: "pushItem", name: "FB_VoltTest2", folder: "POUs", sourceText: "FUNCTION_BLOCK FB_VoltTest2\nVAR\nEND_VAR\nEND_FUNCTION_BLOCK\n", ifVersion: null }],
			})
			expect(create.body.accepted).toBe(true)

			const refs = await get("/refs")
			const update = await post("/push", {
				expectedProjectVersion: refs.body.projectVersion,
				ops: [{ op: "pushItem", name: "FB_VoltTest2", folder: "POUs", sourceText: "FUNCTION_BLOCK FB_VoltTest2\nVAR\n  y : INT;\nEND_VAR\n", ifVersion: "wrongversion" }],
			})
			expect(update.body.accepted).toBe(false)

			await deleteItem("FB_VoltTest2")
		})

		it("rename round-trip", async () => {
			const pv = await currentVersion()
			const create = await post("/push", {
				expectedProjectVersion: pv,
				ops: [{ op: "pushItem", name: "FB_VoltRename", folder: "POUs", sourceText: "FUNCTION_BLOCK FB_VoltRename\nVAR\nEND_VAR\nEND_FUNCTION_BLOCK\n", ifVersion: null }],
			})
			expect(create.body.accepted).toBe(true)

			const refs = await get("/refs")
			const rename = await post("/push", {
				expectedProjectVersion: refs.body.projectVersion,
				ops: [{ op: "renameItem", name: "FB_VoltRename", newName: "FB_VoltRenamed", ifVersion: refs.body.items["FB_VoltRename"] }],
			})
			expect(rename.body.accepted).toBe(true)

			await deleteItem("FB_VoltRenamed")
		})
	})

	describe("/build", () => {
		it.skip("returns success + diagnostics (builds can be slow)", async () => {
			const r = await post("/build", { buildType: "incremental" })
			expect(r.status).toBe(200)
			expect(typeof r.body.success).toBe("boolean")
			expect(typeof r.body.duration).toBe("number")
			expect(Array.isArray(r.body.diagnostics)).toBe(true)
		})

		it.skip("full build completes (builds can be slow)", async () => {
			const r = await post("/build", { buildType: "full" })
			expect(r.status).toBe(200)
		})
	})

	describe("Swagger", () => {
		it("generates all schemas", async () => {
			const r = await fetch(`${BASE}/swagger/v1/swagger.json`)
			const spec = (await r.json()) as any
			expect(spec.components.schemas).toHaveProperty("PushOp")
			expect(spec.components.schemas).toHaveProperty("PushItemOp")
			expect(spec.components.schemas).toHaveProperty("DeleteItemOp")
			expect(spec.components.schemas).toHaveProperty("RenameItemOp")
			expect(spec.components.schemas).toHaveProperty("MoveItemOp")
			expect(spec.components.schemas).toHaveProperty("FetchRequest")
			expect(spec.components.schemas).toHaveProperty("BuildRequest")
		})

		it("PushOp has discriminator + oneOf", async () => {
			const r = await fetch(`${BASE}/swagger/v1/swagger.json`)
			const spec = (await r.json()) as any
			const pushOp = spec.components.schemas.PushOp
			expect(pushOp.discriminator).toBeDefined()
			expect(pushOp.discriminator.propertyName).toBe("op")
			expect(Array.isArray(pushOp.oneOf)).toBe(true)
			expect(pushOp.oneOf.length).toBe(4)
		})
	})

	// Cleanup after all tests
	afterAll(async () => {
		for (const name of ["FB_VoltTest", "FB_VoltTest2", "FB_VoltRename", "FB_VoltRenamed"]) {
			await deleteItem(name)
		}
	})
})
