/**
 * Shared live-bridge test harness — the raw bridge API ("the engineer editing in the IDE"), a git runner,
 * and a temp-workspace factory. Used by live-roundtrip + graphical-roundtrip; both skip cleanly when no
 * bridge is reachable. The git helpers take `ws` explicitly so each suite can own its own workspace.
 * VOLT_TC_PORT picks the bridge (8556 = CODESYS, 8555 = TwinCAT).
 */
import { describe } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BridgeClient } from "../bridge/client.js"
import { init } from "../init.js"

export const PORT = Number.parseInt(process.env.VOLT_TC_PORT ?? "8556", 10)
export const BASE = `http://127.0.0.1:${PORT}`
export const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }

// Skip cleanly when no bridge is up (CI / dev without a running IDE) instead of hard-failing.
export const bridgeUp = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false)
export const suite = bridgeUp ? describe : describe.skip

// ── raw bridge = "the engineer editing in the IDE" ──────────────────────────
export async function api(method: string, path: string, body?: unknown): Promise<any> {
	const r = await fetch(`${BASE}${path}`, body !== undefined ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method })
	return r.json()
}
export async function refs(): Promise<{ projectVersion: string; items: Record<string, string>; folders: Record<string, string> }> {
	return api("GET", "/refs")
}
/** Apply one `set` straight to the bridge — create / edit / rename (toName) / move (toFolder). */
export async function ideSet(name: string, o: { folder?: string; toName?: string; toFolder?: string; sourceText?: string }): Promise<void> {
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
export async function ideDelete(...names: string[]): Promise<void> {
	const r = await refs()
	const ops = names.filter((n) => n in r.items).map((n) => ({ op: "deleteItem", name: n, ifVersion: r.items[n] }))
	if (ops.length === 0) return
	const res = await api("POST", "/push", { expectedProjectVersion: r.projectVersion, ops })
	if (!res.accepted) console.warn("ideDelete failed:", JSON.stringify(res.conflicts))
}
/** Delete every item whose bare name starts with `prefix` — scoped cleanup, never a real project item. */
export async function purge(prefix: string): Promise<void> {
	const r = await refs()
	await ideDelete(...Object.keys(r.items).filter((full) => full.replace(/\.[^.]+$/, "").startsWith(prefix)))
}

// ── workspace + git (ws passed explicitly so two suites can each own one) ────
export const git = (ws: string, ...args: string[]): string => execFileSync("git", ["-C", ws, ...args], { encoding: "utf8", env: ENV }).trim()
export const commit = (ws: string, msg: string): void => {
	git(ws, "add", "-A")
	if (git(ws, "status", "--porcelain").length > 0) git(ws, "commit", "-q", "-m", msg) // no-op on a clean tree
}
/** Commit any worktree changes between tests (so a pull starts clean); no-op when nothing to commit. */
export const checkpoint = (ws: string): void => {
	try {
		commit(ws, "checkpoint")
	} catch {
		/* nothing to commit */
	}
}
export function walk(dir: string): string[] {
	const out: string[] = []
	for (const e of readdirSync(dir)) {
		if (e === ".git") continue
		const p = join(dir, e)
		if (statSync(p).isDirectory()) out.push(...walk(p))
		else out.push(p)
	}
	return out
}
/** Fresh temp workspace bound to the bridge: purge `prefix` strays, mkdtemp, init (first pull), set git config. */
export async function freshWorkspace(prefix: string): Promise<{ bridge: BridgeClient; ws: string; cleanup: () => void }> {
	const bridge = new BridgeClient({ port: PORT })
	await purge(prefix) // clear strays from an interrupted run / the previous block
	const root = mkdtempSync(join(tmpdir(), "voltg-live-"))
	const ws = join(root, "ws")
	mkdirSync(ws, { recursive: true })
	const r = await init(ws, bridge)
	if (r.kind !== "ok") throw new Error(`init failed: ${JSON.stringify(r)}`)
	git(ws, "config", "core.autocrlf", "false")
	git(ws, "config", "user.name", "t") // autoCommitSrc commits via plumbing git → reads repo config
	git(ws, "config", "user.email", "t@t")
	return { bridge, ws, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}
