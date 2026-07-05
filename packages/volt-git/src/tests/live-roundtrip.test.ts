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
import { expect, it, beforeAll, afterAll, beforeEach, setDefaultTimeout } from "bun:test"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { BridgeClient } from "../bridge/client.js"
import { pull } from "../sync/pull.js"
import { push } from "../sync/push.js"
import { show } from "../show.js"
import { build } from "../build.js"
import { checkpoint as checkpointWs, commit as commitWs, freshWorkspace, git as gitWs, ideDelete, ideSet, purge, refs, suite } from "./live-harness.js"

const PREFIX = "VltRT"

let bridge: BridgeClient
let ws: string
let cleanup: () => void

// ws-bound wrappers so the call sites below stay terse (each acts on the current suite's workspace).
const git = (...args: string[]): string => gitWs(ws, ...args)
const commit = (msg: string): void => commitWs(ws, msg)
const checkpoint = (): void => checkpointWs(ws)

const refsHas = async (name: string): Promise<boolean> => name in (await refs()).items
const refsFolder = async (name: string): Promise<string | undefined> => (await refs()).folders[name]

const wsPath = (rel: string): string => join(ws, "src", rel)
const readWs = (rel: string): string => readFileSync(wsPath(rel), "utf8")
const writeWs = (rel: string, content: string): void => { mkdirSync(dirname(wsPath(rel)), { recursive: true }); writeFileSync(wsPath(rel), content) }
const mvWs = (a: string, b: string): void => { mkdirSync(dirname(wsPath(b)), { recursive: true }); renameSync(wsPath(a), wsPath(b)) }
// Src-relative path of an item = its FULL tree folder (from /refs) + name. Structure-aware so the SAME
// assertion holds on either vendor's project shape — CODESYS nests items under "Device/Plc Logic/Application",
// TwinCAT is flat from the PLC-project root. `toFolder: ""` (create at the default root) resolves per vendor.
const srcRelOf = async (name: string): Promise<string> => { const f = await refsFolder(name); return f ? `${f}/${name}` : name }
const rmWs = (rel: string): void => rmSync(wsPath(rel), { force: true })

const fb = (name: string, body = "n := n + 1;"): string => `FUNCTION_BLOCK ${name}\nVAR\n\tn : INT;\nEND_VAR\n\n${body}\nEND_FUNCTION_BLOCK\n`

/** push operates on the committed branch — commit the worktree first, then push. */
const pushCommitted = async () => {
	commit("wip")
	return push(ws, bridge)
}

// Fresh workspace for a suite — bind the shared module lets from the harness handle.
async function setup(): Promise<void> {
	const h = await freshWorkspace(PREFIX)
	bridge = h.bridge
	ws = h.ws
	cleanup = h.cleanup
}

// Push and pull are tested in SEPARATE workspaces on purpose: `push` records the workspace's bytes into
// refs/remotes/volt/ide, while `pull` re-materializes every item from the IDE — so a workspace that has pushed
// original bytes and then pulls would try to 3-way-merge original-vs-materialized. Each block stays
// internally consistent (push = workspace bytes; pull = IDE bytes), which is exactly real usage.
suite("live: workspace → IDE (push)", () => {
	setDefaultTimeout(30_000)
	beforeAll(setup)
	afterAll(async () => { await purge(PREFIX); cleanup?.() })
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
		writeWs(`${n}.fb`, fb(n))
		expect((await pushCommitted()).kind).toBe("ok")
		expect(await refsHas(`${n}.fb`)).toBe(true)
	})
	it("edit: change a POU → push → its version moves", async () => {
		const n = `${PREFIX}_edit`
		writeWs(`${n}.fb`, fb(n)); expect((await pushCommitted()).kind).toBe("ok")
		const v1 = (await refs()).items[`${n}.fb`]
		writeWs(`${n}.fb`, fb(n, "n := n + 99;")); expect((await pushCommitted()).kind).toBe("ok")
		expect((await refs()).items[`${n}.fb`]).not.toBe(v1)
	})
	it("rename + edit: git mv + header change → push → renamed in the IDE", async () => {
		const a = `${PREFIX}_ren_a`, b = `${PREFIX}_ren_b`
		writeWs(`${a}.fb`, fb(a)); expect((await pushCommitted()).kind).toBe("ok"); commit("create ren")
		mvWs(`${a}.fb`, `${b}.fb`); writeWs(`${b}.fb`, fb(b))
		expect((await pushCommitted()).kind).toBe("ok")
		expect(await refsHas(`${b}.fb`)).toBe(true)
		expect(await refsHas(`${a}.fb`)).toBe(false)
	})
	it("move: into a folder → push → folder changes in the IDE", async () => {
		const n = `${PREFIX}_move`
		writeWs(`${n}.fb`, fb(n)); expect((await pushCommitted()).kind).toBe("ok"); commit("create move")
		mvWs(`${n}.fb`, `RtFolder/${n}.fb`)
		expect((await pushCommitted()).kind).toBe("ok")
		expect(await refsFolder(`${n}.fb`)).toBe("RtFolder")
	})
	it("delete: rm → push → gone from the IDE", async () => {
		const n = `${PREFIX}_del`
		writeWs(`${n}.fb`, fb(n)); expect((await pushCommitted()).kind).toBe("ok"); commit("create del")
		rmWs(`${n}.fb`)
		expect((await pushCommitted()).kind).toBe("ok")
		expect(await refsHas(`${n}.fb`)).toBe(false)
	})
	it("outgoing diff: VOLTIDE = last pushed, WORKSPACE = my live (uncommitted) edit", async () => {
		const n = `${PREFIX}_outdiff`
		writeWs(`${n}.fb`, fb(n, "n := 1;")); expect((await pushCommitted()).kind).toBe("ok") // pushed → volt/ide = HEAD
		writeWs(`${n}.fb`, fb(n, "n := 222;")) // edited, NOT committed — the real UX scenario
		const base = await show(ws, bridge, "VOLTIDE", `${n}.fb`)
		const work = await show(ws, bridge, "WORKSPACE", `${n}.fb`)
		expect(Buffer.isBuffer(base) ? base.toString("utf8") : "").toContain("n := 1;") // left = last pushed baseline
		expect(Buffer.isBuffer(work) ? work.toString("utf8") : "").toContain("n := 222;") // right = my live edit (no commit)
	})
	it("build: delegates to the live IDE and returns a result", async () => {
		const r = await build(bridge, false)
		expect(typeof r.success).toBe("boolean")
		expect(Array.isArray(r.diagnostics)).toBe(true)
	})
})

suite("live: IDE → workspace + merge + git", () => {
	setDefaultTimeout(30_000)
	beforeAll(setup)
	afterAll(async () => { await purge(PREFIX); cleanup?.() })
	beforeEach(checkpoint)

	// ── IDE → workspace (pull) ──
	it("IDE create → pull surfaces it in src/", async () => {
		const n = `${PREFIX}_ide_create`
		await ideSet(`${n}.fb`, { folder: "", sourceText: fb(n) })
		const rel = await srcRelOf(`${n}.fb`)
		expect((await pull(ws, bridge)).kind).toBe("ok")
		expect(existsSync(wsPath(rel))).toBe(true)
	})
	it("IDE edit → pull updates src/", async () => {
		const n = `${PREFIX}_ide_edit`
		await ideSet(`${n}.fb`, { folder: "", sourceText: fb(n) })
		const rel = await srcRelOf(`${n}.fb`)
		expect((await pull(ws, bridge)).kind).toBe("ok"); commit("absorb")
		await ideSet(`${n}.fb`, { sourceText: fb(n, "n := 12345;") })
		expect((await pull(ws, bridge)).kind).toBe("ok")
		expect(readWs(rel)).toContain("12345")
	})
	it("IDE delete → pull removes from src/", async () => {
		const n = `${PREFIX}_ide_del`
		await ideSet(`${n}.fb`, { folder: "", sourceText: fb(n) })
		const rel = await srcRelOf(`${n}.fb`)
		expect((await pull(ws, bridge)).kind).toBe("ok"); commit("absorb")
		await ideDelete(`${n}.fb`)
		expect((await pull(ws, bridge)).kind).toBe("ok")
		expect(existsSync(wsPath(rel))).toBe(false)
	})
	it("diff baselines: VOLTIDE = last-synced, BRIDGE = live IDE (what the diff tab compares)", async () => {
		const n = `${PREFIX}_diffbase`
		await ideSet(`${n}.fb`, { folder: "", sourceText: fb(n, "n := 1;") })
		const rel = await srcRelOf(`${n}.fb`)
		expect((await pull(ws, bridge)).kind).toBe("ok"); commit("absorb")
		// the IDE changes it again → incoming. VOLTIDE (refs/remotes/volt/ide) is the synced baseline, NOT the live IDE.
		await ideSet(`${n}.fb`, { sourceText: fb(n, "n := 999;") })
		const base = await show(ws, bridge, "VOLTIDE", rel)
		const live = await show(ws, bridge, "BRIDGE", rel)
		expect(Buffer.isBuffer(base) ? base.toString("utf8") : "").toContain("n := 1;") // baseline = last synced
		expect(Buffer.isBuffer(live) ? live.toString("utf8") : "").toContain("n := 999;") // BRIDGE = live IDE
	})

	// ── dual-side / merge (the round-trip-fidelity tests) ──
	it("non-overlapping edits auto-merge (workspace decl + IDE body)", async () => {
		const n = `${PREFIX}_merge`
		await ideSet(`${n}.fb`, { folder: "", sourceText: `FUNCTION_BLOCK ${n}\nVAR\n\tcounter : INT := 0;\n\tlimit : INT := 99;\n\tpad : INT := 5;\nEND_VAR\n\ncounter := counter + 1;\nEND_FUNCTION_BLOCK\n` })
		const rel = await srcRelOf(`${n}.fb`)
		expect((await pull(ws, bridge)).kind).toBe("ok"); commit("merge base")
		const base = readWs(rel) // work from the ACTUAL materialized bytes — catches reassembly drift
		writeWs(rel, base.replace("limit : INT := 99", "limit : INT := 77")); commit("ws decl edit")
		await ideSet(`${n}.fb`, { sourceText: base.replace("counter := counter + 1", "counter := counter + 2") })
		expect((await pull(ws, bridge)).kind).toBe("ok")
		const after = readWs(rel)
		expect(after).toContain("limit : INT := 77")
		expect(after).toContain("counter := counter + 2")
		expect(after).not.toContain("<<<<<<<")
	})
	// ── git interplay ──
	it("simple flow: pull auto-commits local edits, then merges the IDE", async () => {
		const n = `${PREFIX}_dirty`
		await ideSet(`${n}.fb`, { folder: "", sourceText: fb(n) }) // incoming from the IDE
		// A workspace-created item must live at the SAME vendor root as a folder:"" create so it maps to a
		// valid IDE location on push (CODESYS: under the Application; TwinCAT: the flat root).
		const root = (await refsFolder(`${n}.fb`)) ?? ""
		const localRel = root ? `${root}/${PREFIX}_dirty_local.fb` : `${PREFIX}_dirty_local.fb`
		const ideRel = root ? `${root}/${n}.fb` : `${n}.fb`
		writeWs(localRel, fb(`${PREFIX}_dirty_local`)) // uncommitted local change
		expect((await pull(ws, bridge)).kind).toBe("ok") // auto-commits the local edit, then merges the incoming
		expect(existsSync(wsPath(localRel))).toBe(true) // my local item preserved
		expect(existsSync(wsPath(ideRel))).toBe(true) // IDE item pulled in
	})

	// Runs LAST: an aborted merge leaves volt/ide diverged from the branch, so any later pull would re-hit it.
	it("overlapping edits conflict (both edit the same line)", async () => {
		const n = `${PREFIX}_conflict`
		await ideSet(`${n}.fb`, { folder: "", sourceText: fb(n, "n := 1;") })
		const rel = await srcRelOf(`${n}.fb`)
		expect((await pull(ws, bridge)).kind).toBe("ok"); commit("conflict base")
		writeWs(rel, readWs(rel).replace("n := 1;", "n := 111;")); commit("ws edit")
		await ideSet(`${n}.fb`, { sourceText: fb(n, "n := 222;") })
		expect((await pull(ws, bridge)).kind).toBe("conflict")
		git("merge", "--abort")
	})
})
