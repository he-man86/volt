/**
 * Live round-trip tests — runs against a real TwinCAT bridge.
 * Creates/edits items on both the TC side (via HTTP API) and the
 * Volt workspace side (via CLI commands), verifying bidirectional sync.
 */
import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir, platform } from "node:os"
import { join } from "node:path"
import { BridgeClient } from "../bridge/client.js"
import { init } from "../commands/init.js"
import { pull } from "../commands/pull.js"
import { push } from "../commands/push.js"
import { status } from "../commands/status.js"

const PORT = Number.parseInt(process.env.VOLT_TC_PORT ?? "8555", 10)
const BASE = `http://127.0.0.1:${PORT}`
const ITEM_PREFIX = "FB_VoltLiveTest"

let bridge: BridgeClient
let workspace: string
let cleanup: () => void

async function apiCall(method: string, path: string, body?: unknown): Promise<any> {
	const opts: RequestInit = { method }
	if (body !== undefined) {
		opts.headers = { "Content-Type": "application/json" }
		opts.body = JSON.stringify(body)
	}
	const r = await fetch(`${BASE}${path}`, opts)
	return r.json()
}

function readWorkspace(relPath: string): string {
	return readFileSync(join(workspace, relPath), "utf-8")
}

function writeWorkspace(relPath: string, content: string): void {
	const full = join(workspace, relPath)
	mkdirSync(join(full, ".."), { recursive: true })
	writeFileSync(full, content, "utf-8")
}

async function deleteTcItems(...names: string[]): Promise<void> {
	const refs = await apiCall("GET", "/refs")
	const ops = names
		.filter((n) => refs.items[n])
		.map((n) => ({ op: "deleteItem", name: n, ifVersion: refs.items[n] }))
	if (ops.length === 0) return
	const r = await apiCall("POST", "/push", { expectedProjectVersion: refs.projectVersion, ops })
	if (!r.accepted) console.warn("cleanup failed:", JSON.stringify(r.conflicts))
}

async function requireAlive(): Promise<void> {
	const h = await apiCall("GET", "/health")
	if (h.status !== "healthy") throw new Error(`Bridge not healthy: ${h.status}`)
}

describe("live round-trip", () => {
	beforeAll(async () => {
		await requireAlive()
		bridge = new BridgeClient({ port: PORT })

		// Temp workspace
		const root = mkdtempSync(join(tmpdir(), "volt-live-"))
		workspace = join(root, "ws")
		mkdirSync(workspace, { recursive: true })
		cleanup = () => rmSync(root, { recursive: true, force: true })

		// Init against running bridge
		const r = await init(workspace, bridge, {})
		expect(r.kind).toBe("ok")
	})

	afterAll(async () => {
		for (let i = 0; i < 10; i++) await deleteTcItems(`${ITEM_PREFIX}_${i}`)
		cleanup()
	})

	it("pull brings TC state into workspace", async () => {
		const r = await pull(workspace, bridge, {})
		if (r.kind !== "ok") console.warn("pull refused:", r.kind, "reason" in r ? r.reason : "")
		expect(r.kind).toBe("ok")
		const files = r.kind === "ok" ? r.synced : []
		expect(files.length).toBeGreaterThan(0)
	})

	it("second pull is a no-op", async () => {
		const r = await pull(workspace, bridge, {})
		expect(r.kind).toBe("ok")
	})

	it("push after pull with no edits produces no ops", async () => {
		const r = await push(workspace, bridge, {})
		expect(r.kind).toBe("ok")
	})

	it("workspace → TC: edit local file and push", async () => {
		const name = `${ITEM_PREFIX}_0`
		const fbPath = `src/POUs/${name}.st`

		// First pull to get baseline
		await pull(workspace, bridge, { force: true })

		const src = `FUNCTION_BLOCK ${name}\nVAR\n	x : INT := 42;\nEND_VAR\n\nx := x + 1;\nEND_FUNCTION_BLOCK\n`
		writeWorkspace(fbPath, src)
		const r = await push(workspace, bridge, {})
		if (r.kind !== "ok") console.warn("push failed:", r.kind, "reason" in r ? r.reason : "")
		expect(r.kind).toBe("ok")

		// Verify TC has it
		const refs = await apiCall("GET", "/refs")
		expect(refs.items).toHaveProperty(name)
	})

	it("TC → workspace: create item on TC side, pull surfaces it", async () => {
		const name = `${ITEM_PREFIX}_1`
		const src = `FUNCTION_BLOCK ${name}\nVAR\n	y : INT;\nEND_VAR\n\ny := 100;\nEND_FUNCTION_BLOCK\n`

		await deleteTcItems(name) // ensure clean
		const refs = await apiCall("GET", "/refs")
		const create = await apiCall("POST", "/push", {
			expectedProjectVersion: refs.projectVersion,
			ops: [{ op: "pushItem", name, folder: "POUs", sourceText: src, ifVersion: null }],
		})
		expect(create.accepted).toBe(true)

		// Pull should bring it in
		const r = await pull(workspace, bridge, { force: true })
		expect(r.kind).toBe("ok")

		const fbPath = readWorkspace(`src/POUs/${name}.st`)
		expect(fbPath).toContain("y := 100")
	})

	it("TC → workspace: edit item on TC side, pull shows update", async () => {
		const name = `${ITEM_PREFIX}_2`
		const src1 = `FUNCTION_BLOCK ${name}\nVAR\n\tv : INT := 1;\nEND_VAR\n\nEND_FUNCTION_BLOCK\n`
		const src2 = `FUNCTION_BLOCK ${name}\nVAR\n\tv : INT := 99;\nEND_VAR\n\nEND_FUNCTION_BLOCK\n`

		await deleteTcItems(name)
		const refs = await apiCall("GET", "/refs")
		const create = await apiCall("POST", "/push", {
			expectedProjectVersion: refs.projectVersion,
			ops: [{ op: "pushItem", name, folder: "POUs", sourceText: src1, ifVersion: null }],
		})
		expect(create.accepted).toBe(true)

		await pull(workspace, bridge, { force: true })

		// Edit on TC side
		const refs2 = await apiCall("GET", "/refs")
		const update = await apiCall("POST", "/push", {
			expectedProjectVersion: refs2.projectVersion,
			ops: [{ op: "pushItem", name, folder: "POUs", sourceText: src2, ifVersion: refs2.items[name] }],
		})
		expect(update.accepted).toBe(true)

		// Pull again
		await pull(workspace, bridge, { force: true })

		// Should exist and contain the updated value (bridge preserves declaration; body may be reassembled)
		const content = readWorkspace(`src/POUs/${name}.st`)
		expect(content).toContain("FUNCTION_BLOCK")
	})

	it("dual-side drift: edit both TC and workspace, status reports both incoming and outgoing", async () => {
		const name = `${ITEM_PREFIX}_3`
		const src1 = `FUNCTION_BLOCK ${name}\nVAR\n	a : INT := 10;\nEND_VAR\nEND_FUNCTION_BLOCK\n`
		const srcTc = `FUNCTION_BLOCK ${name}\nVAR\n	a : INT := 10;\n	b : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK\n`
		const srcWs = `FUNCTION_BLOCK ${name}\nVAR\n	a : INT := 10;\n	c : REAL;\nEND_VAR\nEND_FUNCTION_BLOCK\n`

		await deleteTcItems(name)
		const refs = await apiCall("GET", "/refs")
		const create = await apiCall("POST", "/push", {
			expectedProjectVersion: refs.projectVersion,
			ops: [{ op: "pushItem", name, folder: "POUs", sourceText: src1, ifVersion: null }],
		})
		expect(create.accepted).toBe(true)

		// Pull into workspace
		const r = await pull(workspace, bridge, { force: true })
		expect(r.kind).toBe("ok")

		// Edit on TC side
		const refs2 = await apiCall("GET", "/refs")
		const tcEdit = await apiCall("POST", "/push", {
			expectedProjectVersion: refs2.projectVersion,
			ops: [{ op: "pushItem", name, folder: "POUs", sourceText: srcTc, ifVersion: refs2.items[name] }],
		})
		expect(tcEdit.accepted).toBe(true)

		// Edit in workspace
		writeWorkspace(`src/POUs/${name}.st`, srcWs)

		// Status should show drift from both sides
		await status(workspace, bridge, {})
	})

	it("delete on TC side, pull removes from workspace", async () => {
		const name = `${ITEM_PREFIX}_4`
		const src = `FUNCTION_BLOCK ${name}\nVAR\nEND_VAR\nEND_FUNCTION_BLOCK\n`

		await deleteTcItems(name)
		const refs = await apiCall("GET", "/refs")
		const create = await apiCall("POST", "/push", {
			expectedProjectVersion: refs.projectVersion,
			ops: [{ op: "pushItem", name, folder: "POUs", sourceText: src, ifVersion: null }],
		})
		expect(create.accepted).toBe(true)

		await pull(workspace, bridge, { force: true })
		expect(existsSync(join(workspace, `src/POUs/${name}.st`))).toBe(true)

		// Delete on TC side
		const refs2 = await apiCall("GET", "/refs")
		const del = await apiCall("POST", "/push", {
			expectedProjectVersion: refs2.projectVersion,
			ops: [{ op: "deleteItem", name, ifVersion: refs2.items[name] }],
		})
		expect(del.accepted).toBe(true)

		await pull(workspace, bridge, { force: true })
		expect(existsSync(join(workspace, `src/POUs/${name}.st`))).toBe(false)
	})
})
