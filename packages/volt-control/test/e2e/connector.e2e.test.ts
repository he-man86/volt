/**
 * REAL cross-language e2e: volt-control's actual control-plane CLIENT (src/bridge/connector.ts) driven against the
 * REAL C# ControlServer (the production HTTP wire), via a small harness that serves a scriptable ConnectorView. No
 * mocked fetch — this is the one test that proves the C#-serialized wire and the TS-parsed wire AGREE, for a single
 * IDE and for MULTIPLE IDE instances across vendors. A field-name / shape drift between the two (the class of bug a
 * mocked unit test can't see) fails here.
 *
 * Run from packages/volt-control:  bun test test/e2e   (or `bun run test:e2e`)
 * Skips cleanly when the .NET SDK / harness can't be built, so it never blocks a machine without dotnet.
 */
import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectProject, connectorStatus, detectedProjects, disconnect, isServing } from "../../src/bridge/connector.js"

const HARNESS_DIR = join(import.meta.dir, "..", "..", "..", "volt-cli", "test", "Volt.Cli.Connector.ControlHarness")
const OUT = join(HARNESS_DIR, "bin", "Debug", "net8.0")
const EXE = join(OUT, "VoltControlHarness.exe")
const DLL = join(OUT, "VoltControlHarness.dll")
const PORT = 18560 // distinct from the production 8550 so a running dev connector doesn't clash
const VIEW = join(mkdtempSync(join(tmpdir(), "volt-ctl-e2e-")), "view.json")

// Prefer the real SDK path on Windows (PATH `dotnet` is an SDK-less x86 stub on some dev boxes); else plain `dotnet`.
function dotnet(): string {
	const win = "C:\\Program Files\\dotnet\\dotnet.exe"
	return existsSync(win) ? win : "dotnet"
}

// Build the harness if it isn't already built. Returns false if we can't (no SDK) → the suite skips.
function ensureHarness(): boolean {
	if (existsSync(EXE) || existsSync(DLL)) return true
	const r = spawnSync(dotnet(), ["build", join(HARNESS_DIR, "Volt.Cli.Connector.ControlHarness.csproj"), "-c", "Debug"], { stdio: "ignore" })
	return r.status === 0 && (existsSync(EXE) || existsSync(DLL))
}

const available = ensureHarness()
const suite = available ? describe : describe.skip
if (!available) console.warn("[connector.e2e] skipped — could not build the C# ControlServer harness (no .NET SDK?)")

// ── scriptable ConnectorView rows (what the live connector's ProjectView serializes to) ──
type Row = { id: string; displayName: string; vendor: string; dirty: boolean; connected: boolean; status: string; pipe?: string; ideVersion?: string; projectName?: string }
const cs = (name: string, pid: number, status = "idle"): Row =>
	({ id: `codesys:::${name}:`, displayName: name, vendor: "codesys", dirty: false, connected: false, status, pipe: `volt.bridge.codesys.${pid}`, ideVersion: "3.5", projectName: name })
const tc = (name: string, pid: number, status = "idle"): Row =>
	({ id: `twincat:::${name}:`, displayName: name, vendor: "twincat", dirty: false, connected: false, status, pipe: `volt.bridge.twincat.${pid}`, ideVersion: "15.0", projectName: name })

function writeView(rows: Row[]): void { writeFileSync(VIEW, JSON.stringify(rows)) }

suite("volt-control ↔ real ControlServer", () => {
	let proc: ChildProcess

	beforeAll(async () => {
		process.env.VOLT_CONTROL_BASE = `http://127.0.0.1:${PORT}`
		writeView([cs("MyMachine", 1000)]) // some initial view so the server answers immediately
		const runner = existsSync(EXE) ? { cmd: EXE, args: [VIEW, String(PORT)] } : { cmd: dotnet(), args: [DLL, VIEW, String(PORT)] }
		proc = spawn(runner.cmd, runner.args, { stdio: ["pipe", "inherit", "inherit"] })
		// Ready = the REAL endpoint answers (Start() swallows a bind failure, so the READY line alone isn't proof).
		const t0 = Date.now()
		while (Date.now() - t0 < 30_000) {
			if (await connectorStatus(500)) break
			await Bun.sleep(200)
		}
		expect(await connectorStatus()).toBeDefined() // the harness is really serving
	}, 90_000) // EXPLICIT hook timeout: the spawn + readiness poll can take > bun's 5s default on a cold CI runner
	// (the .NET runtime cold-start + HttpListener bind). Without this the hook is killed at 5s and every test "fails".

	afterAll(() => {
		try { proc?.stdin?.end() } catch {}
		try { proc?.kill() } catch {}
		delete process.env.VOLT_CONTROL_BASE
	})

	beforeEach(async () => { await disconnect() }, 15_000) // clear any active selection; generous vs bun's 5s default

	// ── single instance ──────────────────────────────────────────────────────────────
	test("single IDE: the client parses the view and a connect round-trips into status", async () => {
		writeView([cs("MyMachine", 1000)])
		const projects = await detectedProjects()
		expect(projects.length).toBe(1)
		const p = projects[0]!
		expect(p.id).toBe("codesys:::MyMachine:")
		expect(p.displayName).toBe("MyMachine")
		expect(p.vendor).toBe("codesys")
		expect(p.status).toBe("idle")
		expect(p.pipe).toBe("volt.bridge.codesys.1000")
		expect(isServing(p)).toBe(false) // detected, not served

		expect(await connectProject(p.id)).toBe(true) // POST /connect over the real wire
		const after = (await detectedProjects())[0]!
		expect(after.connected).toBe(true)
		expect(after.status).toBe("healthy")
		expect(isServing(after)).toBe(true) // connecting made its bridge serve
	})

	// ── multiple IDE instances (2 CODESYS + 2 TwinCAT) ─────────────────────────────────
	test("multiple IDEs: every instance across vendors is listed with its own identity", async () => {
		writeView([cs("MachineA", 1001), cs("MachineB", 1002, "healthy"), tc("Line1", 2001), tc("Line2", 2002)])
		const projects = await detectedProjects()
		expect(projects.length).toBe(4)
		expect(projects.map(p => p.id).sort()).toEqual([
			"codesys:::MachineA:", "codesys:::MachineB:", "twincat:::Line1:", "twincat:::Line2:",
		])
		expect(projects.filter(p => p.vendor === "codesys").length).toBe(2)
		expect(projects.filter(p => p.vendor === "twincat").length).toBe(2)
		// Each carries its OWN per-pid pipe — no collapsing across instances.
		expect(new Set(projects.map(p => p.pipe)).size).toBe(4)
		// One row arrived already serving (healthy); the client reads that off the wire.
		expect(projects.filter(p => isServing(p)).map(p => p.id)).toEqual(["codesys:::MachineB:"])
	})

	test("multiple IDEs: connecting one serves only that one; switching moves the selection", async () => {
		writeView([cs("MachineA", 1001), cs("MachineB", 1002), tc("Line1", 2001), tc("Line2", 2002)])

		expect(await connectProject("twincat:::Line1:")).toBe(true)
		let now = await detectedProjects()
		expect(now.filter(p => p.connected).map(p => p.id)).toEqual(["twincat:::Line1:"])
		expect(now.filter(p => isServing(p)).map(p => p.id)).toEqual(["twincat:::Line1:"]) // only the connected one serves

		// Switch to a CODESYS instance — the selection MOVES, it doesn't accumulate.
		expect(await connectProject("codesys:::MachineA:")).toBe(true)
		now = await detectedProjects()
		expect(now.filter(p => p.connected).map(p => p.id)).toEqual(["codesys:::MachineA:"])
		expect(now.find(p => p.id === "twincat:::Line1:")!.connected).toBe(false)
	})

	test("disconnect over the real wire clears the active selection and reports gated", async () => {
		writeView([cs("MachineA", 1001), tc("Line1", 2001)])
		await connectProject("codesys:::MachineA:")
		expect((await detectedProjects()).some(p => p.connected)).toBe(true)

		const r = await disconnect("codesys:::MachineA:")
		expect(r.ok).toBe(true)
		expect(r.gated).toBe(true) // the harness's ControlServer answers UnbindResult.Gated
		expect((await detectedProjects()).some(p => p.connected)).toBe(false)
	})

	test("the client reads no projects when the connector serves an empty view (not an error)", async () => {
		writeView([])
		expect(await detectedProjects()).toEqual([])
		expect(await connectorStatus()).toEqual({ projects: [] }) // a real empty ConnectorView, distinct from undefined (down)
	})

	// ── edge cases + stability under interaction (inherits the harness + per-test disconnect above) ──
	describe("edge cases + stability under churn", () => {
		test("connecting an unknown project id is rejected and changes nothing", async () => {
			writeView([cs("MachineA", 1001)])
			expect(await connectProject("codesys:::Ghost:")).toBe(false) // real connector rejects an id it can't find
			expect((await detectedProjects()).some(p => p.connected)).toBe(false)
		})

		test("disconnect with nothing connected is a clean no-op", async () => {
			writeView([cs("MachineA", 1001)])
			const r = await disconnect()
			expect(r.ok).toBe(true)
			expect((await detectedProjects()).some(p => p.connected)).toBe(false)
		})

		test("connecting the same project twice is idempotent — exactly one stays connected", async () => {
			writeView([cs("MachineA", 1001), cs("MachineB", 1002)])
			expect(await connectProject("codesys:::MachineA:")).toBe(true)
			expect(await connectProject("codesys:::MachineA:")).toBe(true)
			expect((await detectedProjects()).filter(p => p.connected).map(p => p.id)).toEqual(["codesys:::MachineA:"])
		})

		test("disconnecting a project that isn't the active one leaves the active one connected", async () => {
			writeView([cs("MachineA", 1001), cs("MachineB", 1002)])
			await connectProject("codesys:::MachineA:")
			await disconnect("codesys:::MachineB:") // not the active selection
			expect((await detectedProjects()).filter(p => p.connected).map(p => p.id)).toEqual(["codesys:::MachineA:"])
		})

		test("status stays coherent under a burst of concurrent polls + connect/disconnect churn", async () => {
			const rows = [cs("MachineA", 1001), cs("MachineB", 1002, "healthy"), tc("Line1", 2001), tc("Line2", 2002)]
			writeView(rows)
			const ids = rows.map(r => r.id)
			// Hammer the control plane: 40 concurrent /status polls interleaved with connect/disconnect actions.
			const actions: Promise<unknown>[] = []
			for (let i = 0; i < 40; i++) {
				actions.push(connectorStatus(3000))
				if (i % 5 === 0) actions.push(connectProject(ids[i % ids.length]!))
				if (i % 7 === 0) actions.push(disconnect())
			}
			const results = await Promise.all(actions)
			const views = results.filter((r): r is { projects: any[] } => !!r && typeof r === "object" && "projects" in (r as object))
			expect(views.length).toBeGreaterThan(0)
			for (const v of views) {
				// Every snapshot is WELL-FORMED under load: the full row set, valid statuses, and NEVER two active
				// selections at once (the invariant a torn read would violate).
				expect(v.projects.length).toBe(4)
				expect(v.projects.map((p: any) => p.id).sort()).toEqual([...ids].sort())
				expect(v.projects.filter((p: any) => p.connected).length).toBeLessThanOrEqual(1)
				for (const p of v.projects) expect(["idle", "healthy", "degraded"]).toContain(p.status)
			}
		})

		test("repeated status polls with no change are stable — no flicker", async () => {
			writeView([cs("MachineA", 1001), cs("MachineB", 1002, "healthy")])
			await connectProject("codesys:::MachineA:")
			const snaps = await Promise.all(Array.from({ length: 10 }, () => connectorStatus()))
			expect(new Set(snaps.map(s => JSON.stringify(s))).size).toBe(1) // all 10 byte-identical
		})

		test("a connected project that vanishes from the view never stays falsely connected", async () => {
			writeView([cs("MachineA", 1001), cs("MachineB", 1002)])
			await connectProject("codesys:::MachineA:")
			expect((await detectedProjects()).some(p => p.connected)).toBe(true)
			writeView([cs("MachineB", 1002)]) // MachineA's IDE closed — its row is gone
			const now = await detectedProjects()
			expect(now.length).toBe(1)
			expect(now.some(p => p.connected)).toBe(false) // the stale selection never resurrects a vanished project
		})
	})
})
