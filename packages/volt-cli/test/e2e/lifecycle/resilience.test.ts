/**
 * Real-world lifecycle CHAOS at the bridge level (over the wire — no IDE process control; `ide-restart.test.ts`
 * actually closes/reopens the IDE). Verifies the bridge stays correct through disconnect storms, rapid project
 * switching, and bad selects: it keeps serving the RIGHT project, never cross-contaminates two open projects,
 * never corrupts, and refuses cleanly. The multi-instance cases need >= 2 running projects (the TwinCAT multi-XAE
 * scenario) and no-op otherwise, so the SAME file runs on either bridge.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, requireHealthy, snapshot, opErrorCode, cleanup, createItem, fetchSource, fid, BASE, VENDOR } from "../harness"

const DISCONNECTED = "PLC_DISCONNECTED"
type Bound = { instanceId?: string | null; project?: string | null; plcProject?: string | null }

let bound: Bound = {}
let projects: Bound[] = []

/** Is the bridge serving sync right now (what `volt push` would find)? */
async function serving(): Promise<boolean> { return (await opErrorCode(() => bridge.refs())) === null }

/** Select a project, TOLERATING a transient PLC_DISCONNECTED. A live TcXaeShell can be mid-restart / re-registering
 *  its DTE exactly when a select lands (the ephemeral-moniker / crash-restart reality) — the bridge refuses cleanly
 *  and the client retries, precisely as `volt` would. This models real-world resilience: the assertion is EVENTUAL
 *  correctness (the project becomes servable), not that every single COM call into a flaky IDE succeeds first try. */
async function selectStable(p: Bound, tries = 12): Promise<void> {
	for (let i = 0; i < tries; i++) {
		const code = await opErrorCode(() => bridge.select(p))
		if (code === null && (await serving())) return
		await new Promise((r) => setTimeout(r, 2000))
	}
	throw new Error(`could not bind '${p.project}' after ${tries} tries — its IDE never became stably available`)
}
/** Re-select the project the suite started on (idempotent, resilient to a mid-restart IDE). */
async function resume(): Promise<void> { await selectStable(bound) }

describe(`resilience / lifecycle chaos (${BASE})`, () => {
	setDefaultTimeout(120_000) // TwinCAT COM + full builds are slow

	beforeAll(async () => {
		await requireHealthy()
		const inst = await bridge.instances()
		const pairs: Bound[] = (inst.instances ?? []).flatMap((i: any) =>
			(i.projects ?? []).map((p: any) => ({ instanceId: i.instanceId, project: p.project, plcProject: p.subProjects?.[0] ?? null })))
		// Keep only the projects that actually SERVE right now: a window can be in the ROT but crashed / not yet
		// built, so instances[0] isn't necessarily usable. The bridge-level cases run against a live one; the
		// multi-instance cases need >= 2 LIVE projects (else they no-op).
		projects = []
		for (const p of pairs) {
			const code = await opErrorCode(() => bridge.select(p))
			if (code === null && (await serving())) projects.push(p)
		}
		if (projects.length === 0) throw new Error("no servable project — open + BUILD a fixture first (see test/e2e/README.md)")
		bound = projects[0]
		await resume()
	})
	afterEach(resume) // never leave the next test (or the engineer) staring at a gated/mis-bound bridge
	afterAll(async () => { await resume(); await cleanup() })

	it("survives a disconnect storm — rapid deselect/reselect keeps the same project + byte-identical versions", async () => {
		const before = await snapshot()
		for (let i = 0; i < 6; i++) { await bridge.deselect(); await resume() }
		expect(await serving()).toBe(true)
		const after = await snapshot()
		expect(after.project).toBe(before.project)      // content-derived version didn't move
		expect(after.structure).toBe(before.structure)
		expect(after.items).toEqual(before.items)        // every item, same hash — nothing churned or reloaded
	})

	it("work created before a disconnect storm survives it — no lost edits, no corruption", async () => {
		const name = fid("chaos_survives")
		await createItem(name, "FUNCTION_BLOCK VltE2E_chaos_survives\nVAR\n\tkeep : INT := 7;\nEND_VAR\nEND_FUNCTION_BLOCK")
		for (let i = 0; i < 4; i++) { await bridge.deselect(); await resume() }
		expect(await fetchSource(name)).toContain("keep : INT := 7")
	})

	it("a refused op during a disconnect storm writes NOTHING — the item never half-exists", async () => {
		const name = fid("chaos_nowrite")
		await bridge.deselect()
		const code = await opErrorCode(() =>
			bridge.push({ ops: [{ op: "set", name, toFolder: "", sourceText: "FUNCTION_BLOCK X\nEND_FUNCTION_BLOCK", ifVersion: null }] }))
		expect(code).toBe(DISCONNECTED)
		await resume()
		expect((await bridge.refs()).items[name]).toBeUndefined()
	})

	// ── multi-instance (the TwinCAT multi-XAE scenario) — needs >= 2 running projects, else a no-op ──

	it("switching between two open projects keeps serving (each select lands, no cross-error)", async () => {
		if (projects.length < 2) return
		for (const p of [projects[0], projects[1], projects[0], projects[1]]) {
			await selectStable(p)
			expect(await serving()).toBe(true)   // the bound project answers a live op; health-cache name can lag one poll
		}
	})

	it("an item created in project A is INVISIBLE in project B — no cross-contamination (the multi-XAE bug)", async () => {
		if (projects.length < 2) return
		const [a, b] = projects
		const name = fid("iso_only_in_a")
		try {
			await selectStable(a)
			await createItem(name, "FUNCTION_BLOCK VltE2E_iso_only_in_a\nEND_FUNCTION_BLOCK")
			await selectStable(b)
			expect((await bridge.refs()).items[name]).toBeUndefined()   // B must NOT see A's item — the whole point
			await selectStable(a)
			expect((await bridge.refs()).items[name]).toBeDefined()      // A still has it after the round-trip
		} finally {
			// remove A's probe item regardless of assertion outcome
			await selectStable(a)
			const v = (await bridge.refs()).items[name]
			if (v) await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [{ op: "deleteItem", name, ifVersion: v }] })
		}
	})

	it("selecting a project that isn't open refuses cleanly, and a valid select right after still works", async () => {
		// TwinCAT resolves the select by stable project NAME across every running instance, so a name that matches
		// nothing binds nothing -> the model is not-connected -> Core refuses PLC_DISCONNECTED. CODESYS serves ONE
		// project per pipe (the name is only confirmatory), so a bogus name still serves its project — skip there.
		if (VENDOR !== "twincat") return
		const code = await opErrorCode(() => bridge.select({ project: "VltE2E__no_such_project__" }))
		expect(code).toBe(DISCONNECTED)
		await resume()
		expect(await serving()).toBe(true)   // a real select recovers immediately after a bad one
	})

	it("a burst of switches ends in a serving state — no wedging", async () => {
		if (projects.length < 2) return
		// Sequential, not concurrent: firing overlapping COM selects into a live TcXaeShell can fault it in its own
		// process (out-of-process automation is single-threaded per instance). A real client serializes too.
		for (const p of [projects[0], projects[1], projects[0], projects[1], projects[0]]) {
			await bridge.select(p).catch(() => {}) // ignore an individual transient; the final resume + assert is the check
		}
		await resume()
		expect(await serving()).toBe(true)
	})
})
