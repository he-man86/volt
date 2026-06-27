/**
 * Shared harness for the e2e bridge suite. One typed BridgeClient over EVERY endpoint, version-snapshot
 * + delta helpers (the backbone of the hash-stability assertions), and test-item fixture cleanup. The
 * SAME suite runs against whatever bridge VOLT_TC_PORT points at (8555 TwinCAT / 8556 CODESYS) — no
 * vendor branches: a pass on one bridge and a fail on the other is a real parity bug, not an expected
 * difference. Tests provision their own fixtures (never read ambient project state) so this holds.
 *
 * All test items are named `${PREFIX}_*` so cleanup is a single prefix-based atomic delete.
 */
import { expect } from "bun:test"

const PORT = Number.parseInt(process.env.VOLT_TC_PORT ?? "8555", 10)
export const BASE = `http://127.0.0.1:${PORT}`
export const PREFIX = "VltE2E"
export const FOLDER = "POUs"

// ── raw HTTP ──────────────────────────────────────────────────────────────────
export async function get(path: string): Promise<any> {
	return (await fetch(`${BASE}${path}`)).json()
}
export async function post(path: string, body?: unknown): Promise<any> {
	const r = await fetch(`${BASE}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body ?? {}),
	})
	return r.json()
}

// ── typed endpoint client (every route the bridge serves) ─────────────────────
export const bridge = {
	health: (): Promise<any> => get("/health"),
	instances: (): Promise<any> => get("/instances"),
	// /refs returns items as a LIST ({name, folder, version}); expose name-keyed items/folders maps for
	// test ergonomics. The raw list shape is asserted by the openapi contract test + the volt-git schema.
	refs: async (): Promise<any> => {
		const r = await get("/refs")
		const items: Record<string, string> = {}
		const folders: Record<string, string> = {}
		for (const it of r.items ?? []) {
			items[it.name] = it.version
			folders[it.name] = it.folder
		}
		return { ...r, items, folders }
	},
	raw: (): Promise<any> => get("/raw"),
	fetch: (req: { knownItems?: Record<string, string>; onlyItems?: string[] } = {}): Promise<any> => post("/fetch", req),
	push: (req: { ops: unknown[]; expectedProjectVersion?: string }): Promise<any> => post("/push", req),
	build: (req: { buildType: "incremental" | "full" } = { buildType: "incremental" }): Promise<any> => post("/build", req),
	openapi: async (): Promise<string> => (await fetch(`${BASE}/openapi.yaml`)).text(),
}

export async function requireHealthy(): Promise<void> {
	const h = await bridge.health()
	if (h.status !== "healthy") throw new Error(`bridge not healthy: ${h.status}`)
}

// ── test-item identity + cleanup ──────────────────────────────────────────────
// The wire speaks FULL names everywhere (the same principle as /refs and /fetch). `id` is the bare IEC
// identifier used INSIDE source text ("FUNCTION_BLOCK VltE2E_x"); `fid` is the FULL wire/file name (IEC
// name + extension) used for every op and lookup. No bare↔full resolution anywhere.
export function id(s: string): string { return `${PREFIX}_${s}` }
/** The FULL wire name: the IEC name + extension (defaults to .st; pass ".fbd"/".ld"/".struct"/… per kind). */
export function fid(s: string, ext = "st"): string { return `${id(s)}.${ext}` }

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
/** Create a NEW item — `name` is the FULL wire name (e.g. `fid("x")`, or `fid("x","ld")`). */
export async function createItem(name: string, src: string, folder = FOLDER): Promise<any> {
	const r = await pushOps([{ op: "set", name, toFolder: folder, sourceText: src, ifVersion: null }])
	expect(r.accepted).toBe(true)
	return r
}
/** Update an existing item by its FULL wire name, guarded with its current version. */
export async function updateItem(name: string, src: string, folder = FOLDER): Promise<any> {
	const v = (await bridge.refs()).items[name] ?? null
	const r = await pushOps([{ op: "set", name, toFolder: folder, sourceText: src, ifVersion: v }])
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
// CODESYS default-names it PLC_PRG; TwinCAT default-names it MAIN. Resolve it from /refs (the wire
// name carries the .st extension) instead of hardcoding, so the SAME suite runs against either vendor's
// default project. Cached after the first lookup.
let _mainProgram: string | null = null
async function mainProgram(): Promise<string | null> {
	if (_mainProgram) return _mainProgram
	const items = (await bridge.refs()).items ?? {}
	for (const cand of ["PLC_PRG.st", "MAIN.st"]) if (items[cand] !== undefined) { _mainProgram = cand; return cand }
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

/** A snapshot item's version by its FULL wire name (e.g. "VltE2E_x.st"). */
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
