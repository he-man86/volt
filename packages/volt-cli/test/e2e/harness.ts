/**
 * Shared harness for the e2e bridge suite. One typed client over EVERY op, version-snapshot + delta helpers
 * (the backbone of the hash-stability assertions), and test-item fixture cleanup. The SAME suite runs against
 * whichever live bridge the pipe points at (`VOLT_PIPE`, or `VOLT_VENDOR`: twincat /
 * CODESYS) — no vendor branches: a pass on one bridge and a fail on the other is a real parity bug, not an
 * expected difference. Tests provision their own fixtures (never read ambient project state) so this holds.
 *
 * All test items are named `${PREFIX}_*` so cleanup is a single prefix-based atomic delete.
 */
import { expect } from "bun:test"
import { connect } from "node:net"
import { readdirSync } from "node:fs"

export const VENDOR = process.env.VOLT_VENDOR === "twincat" ? "twincat" : "codesys"
// Both vendors serve ONE pipe per running IDE, keyed by pid (`volt.bridge.<vendor>.<pid>`). We target by prefix, not a
// fixed pid, so a TwinCAT XAE (or CODESYS) that restarts with a new pid is picked up automatically. VOLT_PIPE (an
// exact pid pipe, or a prefix) overrides the vendor default; even a dead-pid VOLT_PIPE resolves to the live pipe of
// the same vendor.
const PIPE_PREFIX = process.env.VOLT_PIPE || `volt.bridge.${VENDOR}`

/** The live per-pid pipe(s) matching the target (the VOLT_PIPE prefix, or any pipe of this vendor). */
function livePipes(): string[] {
	try {
		return readdirSync("\\\\.\\pipe\\").filter(
			(n) => n === PIPE_PREFIX || n.startsWith(PIPE_PREFIX + ".") || n.startsWith(`volt.bridge.${VENDOR}.`),
		)
	} catch {
		return []
	}
}

let cachedPipe: string | undefined
/** Resolve the live pipe: keep the cached one while it's still up, else re-discover. Falls back to the raw prefix
 *  (a `connect` there ENOENTs with a clear name) when no bridge is up. */
function resolvePipe(): string {
	if (cachedPipe && livePipes().includes(cachedPipe)) return cachedPipe
	cachedPipe = livePipes()[0] ?? PIPE_PREFIX
	return cachedPipe
}

export const PIPE = resolvePipe() // for labels + one-shot callers; live calls re-resolve
export const BASE = `pipe ${PIPE}` // a label for describe() titles (the wire is the pipe, not a URL)
export const PREFIX = "VltE2E"
export const FOLDER = "POUs"

/** One request per connection (mirrors the CLI's PipeClient): write `{op,body}\n`, drain frames, return the
 *  terminal result (progress frames ignored; an error frame throws). Re-resolves the pipe each call, so a bridge that
 *  restarted with a new pid is followed; a connect error drops the cached pipe so the next call re-discovers. */
function pipeCall(op: string, body?: unknown): Promise<any> {
	const pipe = resolvePipe()
	return new Promise((resolve, reject) => {
		const sock = connect(`\\\\.\\pipe\\${pipe}`)
		let buf = ""
		let result: unknown
		sock.on("connect", () => sock.write(JSON.stringify({ op, body: body ?? undefined }) + "\n"))
		sock.on("data", (d: Buffer) => {
			buf += d.toString("utf8")
			let nl: number
			while ((nl = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, nl)
				buf = buf.slice(nl + 1)
				if (!line) continue
				const frame = JSON.parse(line)
				if ("result" in frame) result = frame.result
				else if ("error" in frame) { reject(new Error(`${frame.error.code}: ${frame.error.message}`)); sock.destroy(); return }
				// progress frames ignored
			}
		})
		sock.on("end", () => resolve(result))
		sock.on("error", (e) => { cachedPipe = undefined; reject(e) })
	})
}

/** A route path ("/fetch", "/refs?x") → the pipe op name ("fetch", "refs"). */
function opOf(path: string): string { return path.replace(/^\//, "").split("?")[0] }

// ── raw wire (named pipe) ──────────────────────────────────────────────────────
export async function get(path: string): Promise<any> { return pipeCall(opOf(path)) }
export async function post(path: string, body?: unknown): Promise<any> { return pipeCall(opOf(path), body) }

// ── typed op client (every op the bridge serves over the pipe) ────────────────
export const bridge = {
	health: (): Promise<any> => get("/health"),
	refs: (): Promise<any> => get("/refs"),
	fetch: (req: { knownItems?: Record<string, string>; onlyItems?: string[] } = {}): Promise<any> => post("/fetch", req),
	push: (req: { ops: unknown[]; expectedProjectVersion?: string }): Promise<any> => post("/push", req),
	build: (req: { buildType: "incremental" | "full" } = { buildType: "incremental" }): Promise<any> => post("/build", req),
	// The connection-lifecycle ops the CONNECTOR drives (the tray / the two frontends), not the CLI. `deselect`
	// is the tray's Disconnect: the bridge refuses sync until the next `select`, tearing nothing down.
	// Discovery folded into `health` — no separate `instances` op. Returns the FLAT connectable-projects array
	// (`health.projects`), each row self-describing: { vendor, version, project, status, dirty }. "Serving" is folded
	// into `status`: "idle" (detected, not served) | "healthy" | "degraded" (served).
	instances: (): Promise<any[]> => get("/health").then((h) => h.projects ?? []),
	connect: (req: { project?: string | null } = {}): Promise<any> => post("/connect", req),
	disconnect: (): Promise<any> => post("/disconnect"),
}

/** The bridge's error code for an op, or null when it succeeded. The e2e client surfaces errors as
 *  `Error("CODE: message")` (see pipeCall), so the code is the prefix. */
export async function opErrorCode(run: () => Promise<unknown>): Promise<string | null> {
	try { await run(); return null } catch (e) { return String((e as Error).message).split(":")[0] }
}

/** The bridge's connection state, derived from the flat `health.projects` array the SAME way the connector does:
 *  serving is a NON-IDLE row (status folds serving in). No served row → "unavailable". There is no root
 *  `status`/`connected`/`platform` on the wire — those are C#-only computed helpers off the served row, so e2e
 *  derives them here too. */
export function healthStatus(h: any): "healthy" | "degraded" | "unavailable" {
	const served = (h?.projects ?? []).find((p: any) => p.status && p.status !== "idle")
	if (!served) return "unavailable"
	return served.status === "degraded" ? "degraded" : "healthy"
}

/** Ensure the bridge is SERVING a project before a suite runs. CODESYS serves its loaded project by default, but a
 *  TwinCAT XAE worker starts every project `idle` and must be told which one to serve — so this SELECTS the first
 *  detected project and waits for it to go healthy (retrying across an IDE that is still loading, or one whose pipe
 *  just changed pid). Vendor-agnostic: on CODESYS the select is a harmless re-confirm. Throws with a clear reason if
 *  nothing becomes healthy in time. */
export async function requireHealthy(timeoutMs = 60_000): Promise<void> {
	const t0 = Date.now()
	let lastProject: string | undefined
	while (Date.now() - t0 < timeoutMs) {
		const h = await bridge.health().catch(() => ({ projects: [] }))
		if (healthStatus(h) === "healthy") return
		lastProject = (h.projects ?? [])[0]?.project as string | undefined
		if (lastProject) await bridge.connect({ project: lastProject }).catch(() => {}) // TwinCAT idle → select it
		await new Promise((r) => setTimeout(r, 1500))
	}
	throw new Error(
		lastProject
			? `bridge never served '${lastProject}' (selected it but it stayed idle — is the IDE still loading, or is the worker crashing?)`
			: `no project detected on the bridge (open the IDE + its project; for TwinCAT run scripts/twincat-instances.ps1 up)`,
	)
}

// ── test-item identity + cleanup ──────────────────────────────────────────────
// The wire speaks FULL names everywhere (the same principle as /refs and /fetch). `id` is the bare IEC
// identifier used INSIDE source text ("FUNCTION_BLOCK VltE2E_x"); `fid` is the FULL wire/file name (IEC
// name + extension) used for every op and lookup. No bare↔full resolution anywhere.
export function id(s: string): string { return `${PREFIX}_${s}` }
/** The FULL wire name: the IEC name + KIND extension. A POU is named by kind — default `.fb` (function
 *  block); pass "prg"/"fun"/"itf"/"dut"/"gvl" for other kinds (every DUT is one "dut"). */
export function fid(s: string, ext = "fb"): string { return `${id(s)}.${ext}` }

export async function cleanup(): Promise<void> {
	const refs = await bridge.refs()
	if (!refs.items) return
	const ops = Object.keys(refs.items)
		.filter(n => n.startsWith(PREFIX))
		.map(n => ({ op: "deleteItem", name: n, ifVersion: refs.items[n] }))   // n is already the full wire name
	if (ops.length === 0) return
	const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops })
	if (!r.accepted) console.warn("cleanup:", JSON.stringify(r.conflicts).slice(0, 200))
}

// ── push helpers ──────────────────────────────────────────────────────────────
/** Push ops with a fresh expectedProjectVersion guard. */
export async function pushOps(ops: unknown[]): Promise<any> {
	const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops })
	if (!r.accepted) console.warn("push rejected:", JSON.stringify(r.conflicts || r).slice(0, 200))
	return r
}
// ── PLC-project folder prefix (vendor-neutral) ────────────────────────────────
// The wire folder is the FULL tree path from the project root, so it carries each vendor's structural spine:
// CODESYS "Device/Plc Logic/Application", TwinCAT "" (its walk starts at the PLC project). Tests never hardcode
// that spine — they derive it from the main program (which lives at the PLC-project root) and build paths under
// it, so the SAME assertion holds on either bridge.
let _plcRoot: string | null = null
export async function plcRoot(): Promise<string> {
	if (_plcRoot !== null) return _plcRoot
	const main = await mainProgram()
	if (main) return (_plcRoot = (await fetchItem(main)).folder ?? "")
	// No standard main program (a library project): probe by creating a throwaway at the root, reading its
	// resolved folder, then deleting it.
	const probe = fid("__plcroot_probe__")
	await pushOps([{ op: "set", name: probe, toFolder: "", sourceText: "FUNCTION_BLOCK X\nEND_FUNCTION_BLOCK", ifVersion: null }])
	const root = (await fetchItem(probe)).folder ?? ""
	await pushOps([{ op: "deleteItem", name: probe, ifVersion: (await bridge.refs()).items[probe] }])
	return (_plcRoot = root)
}
/** A full wire folder path under the PLC-project root: `plcFolder("POUs/Sub")` → e.g. "Device/Plc Logic/Application/POUs/Sub". */
export async function plcFolder(sub = ""): Promise<string> {
	const root = await plcRoot()
	return sub ? (root ? `${root}/${sub}` : sub) : root
}

/** Create a NEW item — `name` is the FULL wire name. `folder` is a FULL wire path (default: the `POUs` folder
 *  under the PLC-project root); pass `""` to place at the PLC-project root. */
export async function createItem(name: string, src: string, folder?: string): Promise<any> {
	const toFolder = folder === undefined ? await plcFolder(FOLDER) : folder
	const r = await pushOps([{ op: "set", name, toFolder, sourceText: src, ifVersion: null }])
	expect(r.accepted).toBe(true)
	return r
}
/** Update an existing item's content in place (no move) by its FULL wire name, guarded with its current version.
 *  Pass `folder` (a full wire path) only to MOVE it. */
export async function updateItem(name: string, src: string, folder?: string): Promise<any> {
	const v = (await bridge.refs()).items[name] ?? null
	const op: Record<string, unknown> = { op: "set", name, sourceText: src, ifVersion: v }
	if (folder !== undefined) op.toFolder = folder
	const r = await pushOps([op])
	expect(r.accepted).toBe(true)
	return r
}
/** Fetch an item by its FULL wire name. */
export async function fetchItem(name: string): Promise<any> {
	const f = await bridge.fetch({ knownItems: {}, onlyItems: [name] })
	const it = f.changed.find((i: any) => i.name === name)
	if (!it) throw new Error(`item '${name}' not in fetch`)
	return it
}
export async function fetchSource(name: string): Promise<string> { return (await fetchItem(name)).sourceText }

// ── main-program instantiation (required to compile FBs: an instance forces compilation) ──
let _plcPrgOriginal: string | null = null

// The project's main/entry program — the POU we add FB instances to so the compiler reaches them.
// CODESYS default-names it PLC_PRG; TwinCAT default-names it MAIN. Resolve it from /refs (a program is
// named `.prg`) instead of hardcoding, so the SAME suite runs against either vendor's
// default project. Cached after the first lookup.
let _mainProgram: string | null = null
async function mainProgram(): Promise<string | null> {
	if (_mainProgram) return _mainProgram
	const items = (await bridge.refs()).items ?? {}
	for (const cand of ["PLC_PRG.prg", "MAIN.prg"]) if (items[cand] !== undefined) { _mainProgram = cand; return cand }
	return null   // some projects (a library / PackML app) have no standard main program — callers tolerate it
}

/** Strip any test-prefixed instance declarations from the main program so it compiles cleanly. */
export async function fixPlcPrg(): Promise<void> {
	const PLC_PRG = await mainProgram()
	if (!PLC_PRG) return
	const item = await fetchItem(PLC_PRG).catch(() => null)
	if (!item || !item.sourceText.includes(PREFIX)) return
	const lines = item.sourceText.split("\n")
	const clean = lines.filter((l: string) => !l.includes(PREFIX))
	const newSrc = clean.join("\n")
	const r = await pushOps([{
		op: "set",
		name: PLC_PRG,
		toFolder: "",
		sourceText: newSrc,
		ifVersion: item.version,
	}])
	if (!r.accepted) console.warn("fixPlcPrg rejected:", JSON.stringify(r.conflicts || r).slice(0, 200))
}

export async function savePlcPrg(): Promise<void> {
	const PLC_PRG = await mainProgram()
	_plcPrgOriginal = PLC_PRG ? (await fetchItem(PLC_PRG)).sourceText : null
}

export async function restorePlcPrg(): Promise<void> {
	if (!_plcPrgOriginal) return
	const PLC_PRG = await mainProgram()
	if (!PLC_PRG) { _plcPrgOriginal = null; return }
	const current = await fetchItem(PLC_PRG)
	if (current.sourceText === _plcPrgOriginal) { _plcPrgOriginal = null; return }
	const r = await pushOps([{
		op: "set",
		name: PLC_PRG,
		toFolder: "",
		sourceText: _plcPrgOriginal,
		ifVersion: current.version,
	}])
	if (!r.accepted) console.warn("restorePlcPrg rejected:", JSON.stringify(r.conflicts || r).slice(0, 200))
	_plcPrgOriginal = null
}

/** Add an instance of a FB to the main program's VAR section so the compiler reaches it. */
export async function instantiateInPlcPrg(fbName: string): Promise<void> {
	const PLC_PRG = await mainProgram()
	if (!PLC_PRG) return   // no main program to instantiate into — CODESYS compiles every POU regardless
	const item = await fetchItem(PLC_PRG)
	const lines = item.sourceText.split("\n")
	const endVarIdx = lines.findIndex((l: string) => l.trim() === "END_VAR")
	if (endVarIdx === -1) throw new Error(`${PLC_PRG} has no END_VAR`)
	const varName = `inst_${fbName.replace(PREFIX + "_", "")}`
	lines.splice(endVarIdx, 0, `\t${varName} : ${fbName};`)
	const r = await pushOps([{
		op: "set",
		name: PLC_PRG,
		toFolder: "",
		sourceText: lines.join("\n"),
		ifVersion: item.version,
	}])
	expect(r.accepted).toBe(true)
}

/** Verify the FB compiles with zero errors. On TC (skips unreferenced POUs) an instance in the main program
 *  forces compilation; on CODESYS (compiles every POU) the instantiate no-ops and the build still reaches it. */
export async function ensureCompiles(fbName: string): Promise<void> {
	await instantiateInPlcPrg(fbName)
	const r = await bridge.build()
	// Assert the created POU's BODY compiled — NOT that the whole project is clean: a real fixture project may
	// carry pre-existing errors of its own (V71_PackML_Hauzer has two), so check only diagnostics naming our POU.
	const ours = r.diagnostics.filter((d: any) => d.severity === "error" && JSON.stringify(d).includes(PREFIX))
	if (ours.length > 0) console.warn("test-POU compile errors:", JSON.stringify(ours).slice(0, 300))
	expect(ours.length).toBe(0)
}

// ── version snapshots + delta assertions (the hash-stability spine) ───────────
export type Snapshot = { project: string; structure: string; items: Record<string, string> }
export async function snapshot(): Promise<Snapshot> {
	const r = await bridge.refs()
	return { project: r.projectVersion, structure: r.structureVersion, items: r.items }
}

/** A snapshot item's version by its FULL wire name (e.g. "VltE2E_x.fb"). */
export function snapshotItem(s: Snapshot, name: string): string | undefined {
	return s.items[name]
}

export function snapshotHas(s: Snapshot, name: string): boolean {
	return s.items[name] !== undefined
}

/**
 * Assert how a single item (by its FULL wire name) and the two aggregate versions moved between snapshots.
 *   item: "new" | "change" | "same" | "gone"
 *   project / structure: true = must change, false = must stay identical
 */
export function assertDelta(
	before: Snapshot, after: Snapshot, name: string,
	exp: { item: "new" | "change" | "same" | "gone"; project: boolean; structure: boolean },
): void {
	switch (exp.item) {
		case "new": expect(before.items[name]).toBeUndefined(); expect(after.items[name]).toBeDefined(); break
		case "change": expect(after.items[name]).toBeDefined(); expect(after.items[name]).not.toBe(before.items[name]); break
		case "same": expect(after.items[name]).toBe(before.items[name]); break
		case "gone": expect(before.items[name]).toBeDefined(); expect(after.items[name]).toBeUndefined(); break
	}
	if (exp.project) expect(after.project).not.toBe(before.project)
	else expect(after.project).toBe(before.project)
	if (exp.structure) expect(after.structure).not.toBe(before.structure)
	else expect(after.structure).toBe(before.structure)
}
