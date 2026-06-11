/**
 * Bridge push API test suite — covers all ops with complex POU structures.
 * Runs against a live TwinCAT bridge. Tests round-trip fidelity.
 */
import { describe, expect, it, beforeAll, afterAll } from "bun:test"

const PORT = Number.parseInt(process.env.VOLT_TC_PORT ?? "8555", 10)
const BASE = `http://127.0.0.1:${PORT}`
const PREFIX = "FB_VltPushTest"

async function get(path: string): Promise<any> {
	return (await fetch(`${BASE}${path}`)).json()
}

async function post(path: string, body?: unknown): Promise<any> {
	const r = await fetch(`${BASE}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body ?? {}),
	})
	return r.json()
}

async function pv(): Promise<string> { return (await get("/refs")).projectVersion }

async function fetchAll(): Promise<any> { return post("/fetch", { knownItems: {} }) }

async function push(ops: unknown[]): Promise<any> {
	const version = await pv()
	const r = await post("/push", { expectedProjectVersion: version, ops })
	if (!r.accepted) console.warn("push rejected:", JSON.stringify(r.conflicts || r).slice(0, 200))
	return r
}

async function deleteItems(...names: string[]): Promise<void> {
	const refs = await get("/refs")
	const ops = names.filter(n => refs.items[n]).map(n => ({ op: "deleteItem", name: n, ifVersion: refs.items[n] }))
	if (ops.length === 0) return
	const r = await post("/push", { expectedProjectVersion: refs.projectVersion, ops })
	if (!r.accepted) console.warn("cleanup:", JSON.stringify(r.conflicts))
}

const FB_SRC = (name: string, body: string) =>
	`FUNCTION_BLOCK ${name}\nVAR\n\tspeed : INT;\nEND_VAR\n\n${body}\nEND_FUNCTION_BLOCK\n`

const FB_WITH_ACTION = (name: string) =>
	`FUNCTION_BLOCK ${name}\nVAR\n\tspeed : INT;\nEND_VAR\n\nspeed := 100;\nEND_FUNCTION_BLOCK\n\nACTION Start\nspeed := 1;\nEND_ACTION\n`

const FB_WITH_METHODS = (name: string) =>
	`FUNCTION_BLOCK ${name}\nVAR\n\tspeed : INT;\nEND_VAR\n\nspeed := 100;\nEND_FUNCTION_BLOCK\n\nMETHOD Accelerate : INT\nVAR_INPUT\n\tdelta : INT;\nEND_VAR\n\nAccelerate := speed + delta;\nEND_METHOD\n\nMETHOD Stop\nspeed := 0;\nEND_METHOD\n`

const FB_WITH_PROPERTY = (name: string) =>
	`FUNCTION_BLOCK ${name}\nVAR\n\t_speed : INT;\nEND_VAR\n\nEND_FUNCTION_BLOCK\n\nPROPERTY Speed : INT\n\nGET\n\tSpeed := _speed;\n\nSET\n\t_speed := Speed;\nEND_PROPERTY\n`

function generateName(id: string): string { return `${PREFIX}_${id}` }

const ALL_TEST_NAMES = ["simple","root","nested","withAction","withMethods","withProp","multiChild","upd1","upd2","upd3","del1","del2","renOld","renNew","batchNew","batchUpd","batchDel","batchRej1","batchRej2","fid1","fid2"].map(generateName)

describe("bridge push API", () => {
	beforeAll(async () => {
		const h = await get("/health")
		if (h.status !== "healthy") throw new Error(`Bridge not healthy: ${h.status}`)
		await deleteItems(...ALL_TEST_NAMES)
	})

	afterAll(async () => {
		await deleteItems(...ALL_TEST_NAMES)
	})

	describe("pushItem — create", () => {
		it("creates a simple FB and fetches it back", async () => {
			const name = generateName("simple")
			const src = FB_SRC(name, "speed := 42;")
			const r = await push([{ op: "pushItem", name, folder: "POUs", sourceText: src, ifVersion: null }])
			expect(r.accepted).toBe(true)

			const refs = await get("/refs")
			expect(refs.items).toHaveProperty(name)

			const fetched = await post("/fetch", { knownItems: {}, onlyItems: [name] })
			const item = fetched.changed.find((i: any) => i.name === name)
			expect(item).toBeDefined()
			expect(item.sourceText).toContain("FUNCTION_BLOCK")
		})

		it("creates a root-level FB (no folder)", async () => {
			const name = generateName("root")
			const src = FB_SRC(name, "")
			const r = await push([{ op: "pushItem", name, folder: "", sourceText: src, ifVersion: null }])
			expect(r.accepted).toBe(true)
		})

		it("creates in a nested folder", async () => {
			const name = generateName("nested")
			const src = FB_SRC(name, "")
			const r = await push([{ op: "pushItem", name, folder: "POUs/Sub", sourceText: src, ifVersion: null }])
			expect(r.accepted).toBe(true)
		})
	})

	describe("pushItem — complex POUs", () => {
		it("FB with one ACTION round-trips", async () => {
			const name = generateName("withAction")
			const src = FB_WITH_ACTION(name)
			const r = await push([{ op: "pushItem", name, folder: "POUs", sourceText: src, ifVersion: null }])
			expect(r.accepted).toBe(true)

			const fetched = await post("/fetch", { knownItems: {}, onlyItems: [name] })
			const item = fetched.changed.find((i: any) => i.name === name)
			expect(item).toBeDefined()
			expect(item.sourceText).toContain("ACTION Start")
			expect(item.sourceText).toContain("END_ACTION")
		})

		it("FB with two METHODs round-trips", async () => {
			const name = generateName("withMethods")
			const src = FB_WITH_METHODS(name)
			const r = await push([{ op: "pushItem", name, folder: "POUs", sourceText: src, ifVersion: null }])
			expect(r.accepted).toBe(true)

			const fetched = await post("/fetch", { knownItems: {}, onlyItems: [name] })
			const item = fetched.changed.find((i: any) => i.name === name)
			expect(item).toBeDefined()
			expect(item.sourceText).toContain("METHOD Accelerate")
			expect(item.sourceText).toContain("METHOD Stop")
			expect(item.sourceText).toContain("END_METHOD")
		})

		it("FB with PROPERTY round-trips", async () => {
			const name = generateName("withProp")
			const src = FB_WITH_PROPERTY(name)
			const r = await push([{ op: "pushItem", name, folder: "POUs", sourceText: src, ifVersion: null }])
			expect(r.accepted).toBe(true)

			const fetched = await post("/fetch", { knownItems: {}, onlyItems: [name] })
			const item = fetched.changed.find((i: any) => i.name === name)
			expect(item).toBeDefined()
			expect(item.sourceText).toContain("PROPERTY Speed")
		})

		it("FB with multiple children (action + methods + property) round-trips", async () => {
			const name = generateName("multiChild")
			const src = `FUNCTION_BLOCK ${name}\nVAR\n\tspeed : INT;\nEND_VAR\n\nspeed := 100;\nEND_FUNCTION_BLOCK\n\nACTION Start\nspeed := 1;\nEND_ACTION\n\nMETHOD Accelerate : INT\nVAR_INPUT\n\tdelta : INT;\nEND_VAR\n\nAccelerate := speed + delta;\nEND_METHOD\n\nPROPERTY MaxSpeed : INT\n\nGET\n\tMaxSpeed := 1000;\nEND_PROPERTY\n`
			const r = await push([{ op: "pushItem", name, folder: "POUs", sourceText: src, ifVersion: null }])
			expect(r.accepted).toBe(true)

			const fetched = await post("/fetch", { knownItems: {}, onlyItems: [name] })
			const item = fetched.changed.find((i: any) => i.name === name)
			expect(item).toBeDefined()
			expect(item.sourceText).toContain("ACTION Start")
			expect(item.sourceText).toContain("METHOD Accelerate")
			expect(item.sourceText).toContain("PROPERTY MaxSpeed")
		})
	})

	describe("pushItem — update", () => {
		it("updates an existing FB when ifVersion matches", async () => {
			const name = generateName("upd1")
			await push([{ op: "pushItem", name, folder: "POUs", sourceText: FB_SRC(name, "speed := 1;"), ifVersion: null }])

			const refs = await get("/refs")
			const r = await push([{ op: "pushItem", name, folder: "POUs", sourceText: FB_SRC(name, "speed := 999;"), ifVersion: refs.items[name] }])
			expect(r.accepted).toBe(true)

			const fetched = await post("/fetch", { knownItems: {}, onlyItems: [name] })
			expect(fetched.changed[0].sourceText).toContain("speed := 999")
		})

		it("rejects update with wrong ifVersion", async () => {
			const name = generateName("upd2")
			await push([{ op: "pushItem", name, folder: "POUs", sourceText: FB_SRC(name, ""), ifVersion: null }])

			const r = await push([{ op: "pushItem", name, folder: "POUs", sourceText: FB_SRC(name, "bad"), ifVersion: "wrongversion" }])
			expect(r.accepted).toBe(false)
			expect(r.conflicts.some((c: any) => c.name === name)).toBe(true)
		})

		it("rejects create (ifVersion=null) when item already exists", async () => {
			const name = generateName("upd3")
			await push([{ op: "pushItem", name, folder: "POUs", sourceText: FB_SRC(name, ""), ifVersion: null }])

			const r = await push([{ op: "pushItem", name, folder: "POUs", sourceText: FB_SRC(name, "dupe"), ifVersion: null }])
			expect(r.accepted).toBe(false)
		})
	})

	describe("deleteItem", () => {
		it("deletes an existing item", async () => {
			const name = generateName("del1")
			await push([{ op: "pushItem", name, folder: "POUs", sourceText: FB_SRC(name, ""), ifVersion: null }])

			const refs = await get("/refs")
			const r = await push([{ op: "deleteItem", name, ifVersion: refs.items[name] }])
			expect(r.accepted).toBe(true)

			const after = await get("/refs")
			expect(after.items).not.toHaveProperty(name)
		})

		it("rejects delete with wrong ifVersion", async () => {
			const name = generateName("del2")
			await push([{ op: "pushItem", name, folder: "POUs", sourceText: FB_SRC(name, ""), ifVersion: null }])

			const r = await push([{ op: "deleteItem", name, ifVersion: "wrongversion" }])
			expect(r.accepted).toBe(false)
		})
	})

	describe("renameItem", () => {
		it("renames an existing item", async () => {
			const old = generateName("renOld")
			const news = generateName("renNew")
			await push([{ op: "pushItem", name: old, folder: "POUs", sourceText: FB_SRC(old, ""), ifVersion: null }])

			const refs = await get("/refs")
			const r = await push([{ op: "renameItem", name: old, newName: news, ifVersion: refs.items[old] }])
			expect(r.accepted).toBe(true)

			const after = await get("/refs")
			expect(after.items).not.toHaveProperty(old)
			expect(after.items).toHaveProperty(news)
		})
	})

	describe("batch operations", () => {
		it("create + update + delete in one batch", async () => {
			const newName = generateName("batchNew")
			const updateName = generateName("batchUpd")
			const deleteName = generateName("batchDel")

			// Setup: create items to update and delete
			await push([
				{ op: "pushItem", name: updateName, folder: "POUs", sourceText: FB_SRC(updateName, ""), ifVersion: null },
				{ op: "pushItem", name: deleteName, folder: "POUs", sourceText: FB_SRC(deleteName, ""), ifVersion: null },
			])

			// Batch: create new + update existing + delete existing
			const refs = await get("/refs")
			const r = await post("/push", {
				expectedProjectVersion: refs.projectVersion,
				ops: [
					{ op: "pushItem", name: newName, folder: "POUs", sourceText: FB_SRC(newName, "speed := 1;"), ifVersion: null },
					{ op: "pushItem", name: updateName, folder: "POUs", sourceText: FB_SRC(updateName, "speed := 99;"), ifVersion: refs.items[updateName] },
					{ op: "deleteItem", name: deleteName, ifVersion: refs.items[deleteName] },
				],
			})
			expect(r.accepted).toBe(true)

			// Verify all three operations took effect
			const after = await get("/refs")
			expect(after.items).toHaveProperty(newName)
			expect(after.items).toHaveProperty(updateName)
			expect(after.items).not.toHaveProperty(deleteName)
		})

		it("entire batch is rejected if one op conflicts", async () => {
			const name1 = generateName("batchRej1")
			const name2 = generateName("batchRej2")
			await push([{ op: "pushItem", name: name1, folder: "POUs", sourceText: FB_SRC(name1, ""), ifVersion: null }])

			const refs = await get("/refs")
			const r = await post("/push", {
				expectedProjectVersion: refs.projectVersion,
				ops: [
					{ op: "pushItem", name: name2, folder: "POUs", sourceText: FB_SRC(name2, ""), ifVersion: null }, // OK
					{ op: "deleteItem", name: name1, ifVersion: "wrongversion" }, // CONFLICT
				],
			})
			expect(r.accepted).toBe(false)
			// Verify name2 was NOT created (atomic batch rejection)
			const after = await get("/refs")
			expect(after.items).not.toHaveProperty(name2)
			expect(after.items).toHaveProperty(name1) // still exists
		})
	})

	describe("content fidelity", () => {
		it("declaration-only code round-trips identically", async () => {
			const name = generateName("fid1")
			const src = `FUNCTION_BLOCK ${name}\nVAR\n\ta : INT;\n\tb : BOOL;\n\tc : REAL := 3.14;\nEND_VAR\nEND_FUNCTION_BLOCK\n`
			await push([{ op: "pushItem", name, folder: "POUs", sourceText: src, ifVersion: null }])

			const fetched = await post("/fetch", { knownItems: {}, onlyItems: [name] })
			expect(fetched.changed[0].sourceText).toContain("a : INT")
			expect(fetched.changed[0].sourceText).toContain("b : BOOL")
			expect(fetched.changed[0].sourceText).toContain("c : REAL := 3.14")
		})

		it("implementation body round-trips", async () => {
			const name = generateName("fid2")
			const src = `FUNCTION_BLOCK ${name}\nVAR\n\tresult : INT;\nEND_VAR\n\nresult := 1 + 2 * 3;\nIF result > 5 THEN\n\tresult := 100;\nEND_IF\nEND_FUNCTION_BLOCK\n`
			await push([{ op: "pushItem", name, folder: "POUs", sourceText: src, ifVersion: null }])

			const fetched = await post("/fetch", { knownItems: {}, onlyItems: [name] })
			expect(fetched.changed[0].sourceText).toContain("result := 1 + 2 * 3")
		})
	})
})
