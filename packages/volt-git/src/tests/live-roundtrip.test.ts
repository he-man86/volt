/**
 * Live round-trip tests — drive the volt-git CLI (init / pull / push) against a REAL bridge (TwinCAT
 * or CODESYS), exercising the full git-native sync matrix the mock can't: real materialization +
 * reassembly, the bridge's `set`-op apply, and native `git merge`.
 *
 * Skips cleanly when no bridge is reachable. Run with a bridge on VOLT_TC_PORT
 * (default 8556 = CODESYS; set 8555 for TwinCAT). Every test item is namespaced `VltRT_*` and purged
 * on entry + exit — the suite NEVER touches the project's real items (it owns the VltRT namespace).
 *
 * The "IDE side" of each scenario is simulated by applying a `set`/`delete` op straight to the bridge
 * (exactly what the engineer's edit in the IDE produces); the "workspace side" goes through the CLI +
 * git, just like a user.
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach, setDefaultTimeout } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { BridgeClient } from "../bridge/client.js"
import { init } from "../init.js"
import { pull } from "../sync/pull.js"
import { push } from "../sync/push.js"
import { show } from "../show.js"

const PORT = Number.parseInt(process.env.VOLT_TC_PORT ?? "8556", 10)
const BASE = `http://127.0.0.1:${PORT}`
const PREFIX = "VltRT"

// Skip cleanly when no bridge is up (CI / dev without a running IDE) instead of hard-failing.
const bridgeUp = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false)
const suite = bridgeUp ? describe : describe.skip

const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }

let bridge: BridgeClient
let ws: string
let cleanup: () => void

// ── raw bridge = "the engineer editing in the IDE" ──────────────────────────
async function api(method: string, path: string, body?: unknown): Promise<any> {
	const r = await fetch(`${BASE}${path}`, body !== undefined ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method })
	return r.json()
}
async function refs(): Promise<{ projectVersion: string; items: Record<string, string>; folders: Record<string, string> }> {
	return api("GET", "/refs")
}
/** Apply one `set` straight to the bridge — i.e. "the engineer just did this in the IDE". */
async function ideSet(name: string, o: { folder?: string; toName?: string; toFolder?: string; sourceText?: string }): Promise<void> {
	const r = await refs()
	const cur = name in r.items ? r.items[name] : null
	const op: Record<string, unknown> = { op: "set", name, ifVersion: cur }
	if (cur === null && o.folder !== undefined) op.toFolder = o.folder // placement on create
	if (o.toName !== undefined) op.toName = o.toName
	if (o.toFolder !== undefined) op.toFolder = o.toFolder
	if (o.sourceText !== undefined) op.sourceText = o.sourceText
	const res = await api("POST", "/push", { expectedProjectVersion: r.projectVersion, ops: [op] })
	if (!res.accepted) throw new Error(`ideSet ${name} rejected: ${JSON.stringify(res.conflicts)}`)
}
async function ideDelete(...names: string[]): Promise<void> {
	const r = await refs()
	const ops = names.filter((n) => n in r.items).map((n) => ({ op: "deleteItem", name: n, ifVersion: r.items[n] }))
	if (ops.length === 0) return
	const res = await api("POST", "/push", { expectedProjectVersion: r.projectVersion, ops })
	if (!res.accepted) console.warn("ideDelete failed:", JSON.stringify(res.conflicts))
}
/** Delete every VltRT_* item from the bridge (scoped cleanup — never the real project). */
async function purge(): Promise<void> {
	const r = await refs()
	await ideDelete(...Object.keys(r.items).filter((full) => full.replace(/\.[^.]+$/, "").startsWith(PREFIX)))
}
const refsHas = async (name: string): Promise<boolean> => name in (await refs()).items
const refsFolder = async (name: string): Promise<string | undefined> => (await refs()).folders[name]

// ── workspace + git (the user side) ─────────────────────────────────────────
const git = (...args: string[]): string => execFileSync("git", ["-C", ws, ...args], { encoding: "utf8", env: ENV }).trim()
const commit = (msg: string): void => {
	git("add", "-A")
	if (git("status", "--porcelain").length > 0) git("commit", "-q", "-m", msg) // no-op on a clean tree (e.g. just after a pull ff/merge)
}
const wsPath = (rel: string): string => join(ws, "src", rel)
const readWs = (rel: string): string => readFileSync(wsPath(rel), "utf8")
const writeWs = (rel: string, content: string): void => { mkdirSync(dirname(wsPath(rel)), { recursive: true }); writeFileSync(wsPath(rel), content) }
const mvWs = (a: string, b: string): void => { mkdirSync(dirname(wsPath(b)), { recursive: true }); renameSync(wsPath(a), wsPath(b)) }
const rmWs = (rel: string): void => rmSync(wsPath(rel), { force: true })

const fb = (name: string, body = "n := n + 1;"): string => `FUNCTION_BLOCK ${name}\nVAR\n\tn : INT;\nEND_VAR\n\n${body}\nEND_FUNCTION_BLOCK\n`

/** push now operates on the committed branch — commit the worktree first, then push (commit-before-push). */
const pushCommitted = async () => {
	commit("wip")
	return push(ws, bridge)
}

async function freshWorkspace(): Promise<void> {
	bridge = new BridgeClient({ port: PORT })
	await purge() // clear strays from an interrupted run / the previous block
	const root = mkdtempSync(join(tmpdir(), "voltg-live-"))
	ws = join(root, "ws")
	mkdirSync(ws, { recursive: true })
	cleanup = () => rmSync(root, { recursive: true, force: true })
	const r = await init(ws, bridge)
	expect(r.kind).toBe("ok")
	git("config", "core.autocrlf", "false")
}
// pull needs a clean tree — checkpoint the worktree between tests so each starts fresh.
const checkpoint = (): void => {
	try {
		commit("checkpoint")
	} catch {
		/* nothing to commit */
	}
}

// Push and pull are tested in SEPARATE workspaces on purpose: `push` records the workspace's bytes into
// refs/volt/ide, while `pull` re-materializes every item from the IDE — so a workspace that has pushed
// original bytes and then pulls would try to 3-way-merge original-vs-materialized. Each block stays
// internally consistent (push = workspace bytes; pull = IDE bytes), which is exactly real usage.
suite("live: workspace → IDE (push)", () => {
	setDefaultTimeout(30_000)
	beforeAll(freshWorkspace)
	afterAll(async () => { await purge(); cleanup?.() })
	beforeEach(checkpoint)

	it("init materialized the project under src/", () => {
		expect(existsSync(join(ws, "src"))).toBe(true)
	})
	it("second pull is a no-op (already in sync)", async () => {
		expect((await pull(ws, bridge)).kind).toBe("ok")
	})
	it("push with no edits sends nothing", async () => {
		expect((await pushCommitted()).kind).toBe("ok")
	})

	it("create: new POU → push → exists in the IDE", async () => {
		const n = `${PREFIX}_create`
		writeWs(`${n}.st`, fb(n))
		expect((await pushCommitted()).kind).toBe("ok")
		expect(await refsHas(`${n}.st`)).toBe(true)
	})
	it("edit: change a POU → push → its version moves", async () => {
		const n = `${PREFIX}_edit`
		writeWs(`${n}.st`, fb(n)); expect((await pushCommitted()).kind).toBe("ok")
		const v1 = (await refs()).items[`${n}.st`]
		writeWs(`${n}.st`, fb(n, "n := n + 99;")); expect((await pushCommitted()).kind).toBe("ok")
		expect((await refs()).items[`${n}.st`]).not.toBe(v1)
	})
	it("rename + edit: git mv + header change → push → renamed in the IDE", async () => {
		const a = `${PREFIX}_ren_a`, b = `${PREFIX}_ren_b`
		writeWs(`${a}.st`, fb(a)); expect((await pushCommitted()).kind).toBe("ok"); commit("create ren")
		mvWs(`${a}.st`, `${b}.st`); writeWs(`${b}.st`, fb(b))
		expect((await pushCommitted()).kind).toBe("ok")
		expect(await refsHas(`${b}.st`)).toBe(true)
		expect(await refsHas(`${a}.st`)).toBe(false)
	})
	it("move: into a folder → push → folder changes in the IDE", async () => {
		const n = `${PREFIX}_move`
		writeWs(`${n}.st`, fb(n)); expect((await pushCommitted()).kind).toBe("ok"); commit("create move")
		mvWs(`${n}.st`, `RtFolder/${n}.st`)
		expect((await pushCommitted()).kind).toBe("ok")
		expect(await refsFolder(`${n}.st`)).toBe("RtFolder")
	})
	it("delete: rm → push → gone from the IDE", async () => {
		const n = `${PREFIX}_del`
		writeWs(`${n}.st`, fb(n)); expect((await pushCommitted()).kind).toBe("ok"); commit("create del")
		rmWs(`${n}.st`)
		expect((await pushCommitted()).kind).toBe("ok")
		expect(await refsHas(`${n}.st`)).toBe(false)
	})
})

suite("live: IDE → workspace + merge + git", () => {
	setDefaultTimeout(30_000)
	beforeAll(freshWorkspace)
	afterAll(async () => { await purge(); cleanup?.() })
	beforeEach(checkpoint)

	// ── IDE → workspace (pull) ──
	it("IDE create → pull surfaces it in src/", async () => {
		const n = `${PREFIX}_ide_create`
		await ideSet(`${n}.st`, { folder: "", sourceText: fb(n) })
		expect((await pull(ws, bridge)).kind).toBe("ok")
		expect(existsSync(wsPath(`${n}.st`))).toBe(true)
	})
	it("IDE edit → pull updates src/", async () => {
		const n = `${PREFIX}_ide_edit`
		await ideSet(`${n}.st`, { folder: "", sourceText: fb(n) })
		expect((await pull(ws, bridge)).kind).toBe("ok"); commit("absorb")
		await ideSet(`${n}.st`, { sourceText: fb(n, "n := 12345;") })
		expect((await pull(ws, bridge)).kind).toBe("ok")
		expect(readWs(`${n}.st`)).toContain("12345")
	})
	it("IDE delete → pull removes from src/", async () => {
		const n = `${PREFIX}_ide_del`
		await ideSet(`${n}.st`, { folder: "", sourceText: fb(n) })
		expect((await pull(ws, bridge)).kind).toBe("ok"); commit("absorb")
		await ideDelete(`${n}.st`)
		expect((await pull(ws, bridge)).kind).toBe("ok")
		expect(existsSync(wsPath(`${n}.st`))).toBe(false)
	})
	it("diff baselines: VOLTIDE = last-synced, BRIDGE = live IDE (what the diff tab compares)", async () => {
		const n = `${PREFIX}_diffbase`
		await ideSet(`${n}.st`, { folder: "", sourceText: fb(n, "n := 1;") })
		expect((await pull(ws, bridge)).kind).toBe("ok"); commit("absorb")
		// the IDE changes it again → incoming. VOLTIDE (refs/volt/ide) is the synced baseline, NOT the live IDE.
		await ideSet(`${n}.st`, { sourceText: fb(n, "n := 999;") })
		const base = await show(ws, bridge, "VOLTIDE", `${n}.st`)
		const live = await show(ws, bridge, "BRIDGE", `${n}.st`)
		expect(Buffer.isBuffer(base) ? base.toString("utf8") : "").toContain("n := 1;") // baseline = last synced
		expect(Buffer.isBuffer(live) ? live.toString("utf8") : "").toContain("n := 999;") // BRIDGE = live IDE
	})

	// ── dual-side / merge (the round-trip-fidelity tests) ──
	it("non-overlapping edits auto-merge (workspace decl + IDE body)", async () => {
		const n = `${PREFIX}_merge`
		await ideSet(`${n}.st`, { folder: "", sourceText: `FUNCTION_BLOCK ${n}\nVAR\n\tcounter : INT := 0;\n\tlimit : INT := 99;\n\tpad : INT := 5;\nEND_VAR\n\ncounter := counter + 1;\nEND_FUNCTION_BLOCK\n` })
		expect((await pull(ws, bridge)).kind).toBe("ok"); commit("merge base")
		const base = readWs(`${n}.st`) // work from the ACTUAL materialized bytes — catches reassembly drift
		writeWs(`${n}.st`, base.replace("limit : INT := 99", "limit : INT := 77")); commit("ws decl edit")
		await ideSet(`${n}.st`, { sourceText: base.replace("counter := counter + 1", "counter := counter + 2") })
		expect((await pull(ws, bridge)).kind).toBe("ok")
		const after = readWs(`${n}.st`)
		expect(after).toContain("limit : INT := 77")
		expect(after).toContain("counter := counter + 2")
		expect(after).not.toContain("<<<<<<<")
	})
	it("overlapping edits conflict (both edit the same line)", async () => {
		const n = `${PREFIX}_conflict`
		await ideSet(`${n}.st`, { folder: "", sourceText: fb(n, "n := 1;") })
		expect((await pull(ws, bridge)).kind).toBe("ok"); commit("conflict base")
		writeWs(`${n}.st`, readWs(`${n}.st`).replace("n := 1;", "n := 111;")); commit("ws edit")
		await ideSet(`${n}.st`, { sourceText: fb(n, "n := 222;") })
		expect((await pull(ws, bridge)).kind).toBe("conflict")
		git("merge", "--abort") // recover the clean state for the next test
	})

	// ── git interplay ──
	it("commit-before-pull: a dirty src/ tree refuses the pull", async () => {
		const n = `${PREFIX}_dirty`
		await ideSet(`${n}.st`, { folder: "", sourceText: fb(n) }) // give pull something to bring in
		writeWs(`${PREFIX}_dirty_local.st`, fb(`${PREFIX}_dirty_local`)) // uncommitted local change
		expect((await pull(ws, bridge)).kind).toBe("refused")
		commit("clean up dirty") // recover
	})
})
