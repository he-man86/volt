/**
 * Shared harness for the e2e bridge suite. One typed BridgeClient over EVERY endpoint, version-snapshot
 * + delta helpers (the backbone of the hash-stability assertions), test-item fixtures cleanup, and
 * vendor detection. Runs against whatever bridge VOLT_TC_PORT points at (8555 TwinCAT / 8556 CODESYS).
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
	refs: (): Promise<any> => get("/refs"),
	raw: (): Promise<any> => get("/raw"),
	fetch: (req: { knownItems?: Record<string, string>; onlyItems?: string[] } = {}): Promise<any> => post("/fetch", req),
	push: (req: { ops: unknown[]; expectedProjectVersion?: string }): Promise<any> => post("/push", req),
	build: (req: { buildType: "incremental" | "full" } = { buildType: "incremental" }): Promise<any> => post("/build", req),
	openapi: async (): Promise<string> => (await fetch(`${BASE}/openapi.yaml`)).text(),
}

export async function isTwinCAT(): Promise<boolean> { return (await bridge.health()).platform === "beckhoff" }
export async function requireHealthy(): Promise<void> {
	const h = await bridge.health()
	if (h.status !== "healthy") throw new Error(`bridge not healthy: ${h.status}`)
}

// ── name resolution (bare → full) ─────────────────────────────────────────────
/** Find the full wire name for a bare IDE name from the refs items map. */
export function fullWireName(items: Record<string, string>, bareName: string): string | undefined {
	if (items[bareName] !== undefined) return bareName
	const prefix = bareName + "."
	return Object.keys(items).find((k: string) => k.startsWith(prefix))
}

// ── test-item identity + cleanup ──────────────────────────────────────────────
export function id(s: string): string { return `${PREFIX}_${s}` }
/** Full wire name — appends .st (all test items are ST by default). */
export function fid(s: string): string { return id(s) + ".st" }

export async function cleanup(): Promise<void> {
	const refs = await bridge.refs()
	if (!refs.items) return
	const ops = Object.keys(refs.items)
		.filter(n => n.startsWith(PREFIX))
		.map(n => ({ op: "deleteItem", name: bareName(n), ifVersion: refs.items[n] }))
	if (ops.length === 0) return
	const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops })
	if (!r.accepted) console.warn("cleanup:", JSON.stringify(r.conflicts).slice(0, 200))
}

function bareName(full: string): string {
	const dot = full.lastIndexOf(".")
	return dot > 0 ? full.slice(0, dot) : full
}

// ── push helpers ──────────────────────────────────────────────────────────────
/** Push ops with a fresh expectedProjectVersion guard. */
export async function pushOps(ops: unknown[]): Promise<any> {
	const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops })
	if (!r.accepted) console.warn("push rejected:", JSON.stringify(r.conflicts || r).slice(0, 200))
	return r
}
export async function createItem(name: string, src: string, folder = FOLDER): Promise<any> {
	const r = await pushOps([{ op: "pushItem", name, folder, sourceText: src, ifVersion: null }])
	expect(r.accepted).toBe(true)
	return r
}
export async function updateItem(name: string, src: string, folder = FOLDER): Promise<any> {
	const refs = await bridge.refs()
	const v = refs.items[name]
		?? Object.keys(refs.items).find((k: string) => k.startsWith(name + "."))
		? refs.items[Object.keys(refs.items).find((k: string) => k.startsWith(name + "."))!]
		: null
	const r = await pushOps([{ op: "pushItem", name, folder, sourceText: src, ifVersion: v }])
	expect(r.accepted).toBe(true)
	return r
}
export async function fetchItem(name: string): Promise<any> {
	const f = await bridge.fetch({ knownItems: {}, onlyItems: [name] })
	const it = f.changed.find((i: any) => i.name === name || i.name.startsWith(name + "."))
	if (!it) throw new Error(`item '${name}' not in fetch`)
	return it
}
export async function fetchSource(name: string): Promise<string> { return (await fetchItem(name)).sourceText }

// ── PLC_PRG instantiation (required by CODESYS to compile FBs) ────────────────
let _plcPrgOriginal: string | null = null

const PLC_PRG = "PLC_PRG"

/** Strip any test-prefixed instance declarations from PLC_PRG so it compiles cleanly. */
export async function fixPlcPrg(): Promise<void> {
	const item = await fetchItem(PLC_PRG)
	if (!item.sourceText.includes(PREFIX)) return
	const lines = item.sourceText.split("\n")
	const clean = lines.filter((l: string) => !l.includes(PREFIX))
	const newSrc = clean.join("\n")
	const r = await pushOps([{
		op: "pushItem",
		name: PLC_PRG,
		folder: "",
		sourceText: newSrc,
		ifVersion: item.version,
	}])
	if (!r.accepted) console.warn("fixPlcPrg rejected:", JSON.stringify(r.conflicts || r).slice(0, 200))
}

export async function savePlcPrg(): Promise<void> {
	_plcPrgOriginal = (await fetchItem(PLC_PRG)).sourceText
}

export async function restorePlcPrg(): Promise<void> {
	if (!_plcPrgOriginal) return
	const current = await fetchItem(PLC_PRG)
	if (current.sourceText === _plcPrgOriginal) { _plcPrgOriginal = null; return }
	const r = await pushOps([{
		op: "pushItem",
		name: PLC_PRG,
		folder: "",
		sourceText: _plcPrgOriginal,
		ifVersion: current.version,
	}])
	if (!r.accepted) console.warn("restorePlcPrg rejected:", JSON.stringify(r.conflicts || r).slice(0, 200))
	_plcPrgOriginal = null
}

/** Add an instance of a FB to PLC_PRG's VAR section so the CODESYS compiler reaches it. */
export async function instantiateInPlcPrg(fbName: string): Promise<void> {
	const item = await fetchItem(PLC_PRG)
	const lines = item.sourceText.split("\n")
	const endVarIdx = lines.findIndex((l: string) => l.trim() === "END_VAR")
	if (endVarIdx === -1) throw new Error("PLC_PRG has no END_VAR")
	const varName = `inst_${fbName.replace(PREFIX + "_", "")}`
	lines.splice(endVarIdx, 0, `\t${varName} : ${fbName};`)
	const r = await pushOps([{
		op: "pushItem",
		name: PLC_PRG,
		folder: "",
		sourceText: lines.join("\n"),
		ifVersion: item.version,
	}])
	expect(r.accepted).toBe(true)
}

/** Instantiate an FB in PLC_PRG and verify the project compiles with zero errors. */
export async function ensureCompiles(fbName: string): Promise<void> {
	await instantiateInPlcPrg(fbName)
	const r = await bridge.build()
	expect(r.success).toBe(true)
	const errors = r.diagnostics.filter((d: any) => d.severity === "error")
	if (errors.length > 0) console.warn("unexpected compile errors:", JSON.stringify(errors).slice(0, 300))
	expect(errors.length).toBe(0)
}

// ── version snapshots + delta assertions (the hash-stability spine) ───────────
export type Snapshot = { project: string; structure: string; items: Record<string, string> }
export async function snapshot(): Promise<Snapshot> {
	const r = await bridge.refs()
	return { project: r.projectVersion, structure: r.structureVersion, items: r.items }
}

/** Get a version from a snapshot by bare name, resolving to the full wire name. */
export function snapshotItem(s: Snapshot, bareName: string): string | undefined {
	const key = fullWireName(s.items, bareName)
	return key !== undefined ? s.items[key] : undefined
}

export function snapshotHas(s: Snapshot, bareName: string): boolean {
	return fullWireName(s.items, bareName) !== undefined
}

function fullName(items: Record<string, string>, bareName: string): string | undefined {
	if (items[bareName] !== undefined) return bareName
	const prefix = bareName + "."
	const key = Object.keys(items).find((k: string) => k.startsWith(prefix))
	return key
}

/**
 * Assert how a single item and the two aggregate versions moved between two snapshots.
 *   item: "new" | "change" | "same" | "gone"
 *   project / structure: true = must change, false = must stay identical
 */
export function assertDelta(
	before: Snapshot, after: Snapshot, name: string,
	exp: { item: "new" | "change" | "same" | "gone"; project: boolean; structure: boolean },
): void {
	const bKey = fullWireName(before.items, name)
	const aKey = fullWireName(after.items, name) ?? bKey
	switch (exp.item) {
		case "new": expect(bKey).toBeUndefined(); expect(aKey).toBeDefined(); break
		case "change": expect(aKey).toBeDefined(); expect(after.items[aKey!]).not.toBe(before.items[bKey!]); break
		case "same": expect(after.items[aKey!]).toBe(before.items[bKey!]); break
		case "gone": expect(bKey).toBeDefined(); expect(after.items[aKey!]).toBeUndefined(); break
	}
	if (exp.project) expect(after.project).not.toBe(before.project)
	else expect(after.project).toBe(before.project)
	if (exp.structure) expect(after.structure).not.toBe(before.structure)
	else expect(after.structure).toBe(before.structure)
}
