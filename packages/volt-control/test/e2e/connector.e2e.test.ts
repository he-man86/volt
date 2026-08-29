/**
 * REAL cross-language e2e: volt-control's actual clients (src/bridge/connector.ts + session.ts) driven against the
 * REAL C# ControlServer (the production HTTP wire) over the REAL ConnectionManager/Reconciler — a harness fakes only
 * the DATA (a scriptable IProjectSource over the JSON file below), never the interest→serving DECISION, so the
 * shipped semantics apply here: bind is level-triggered, unbind is EDGE-triggered (a project no session ever wanted
 * keeps whatever it was serving; only a wanted→unwanted edge gates one). No mocked fetch — this is the one test that
 * proves the C#-serialized wire and the TS-parsed wire AGREE, for the session API (declare interest → reconcile →
 * serving) AND the ambient GET /status read (the connect picker), for one IDE and for MULTIPLE IDE instances across
 * vendors.
 *
 * Run from packages/volt-control:  bun test test/e2e   (or `bun run test:e2e`)
 * Skips cleanly when the .NET SDK / harness can't be built, so it never blocks a machine without dotnet.
 */
import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectorStatus, detectedProjects, isServing } from "../../src/bridge/connector.js"
import { declareInterest, dropInterest, shutdownSession, __resetSessionForTest } from "../../src/bridge/session.js"

const HARNESS_DIR = join(import.meta.dir, "..", "..", "..", "volt-cli", "test", "Volt.Connector.ControlHarness")
const OUT = join(HARNESS_DIR, "bin", "Debug", "net8.0")
const EXE = join(OUT, "VoltControlHarness.exe")
const DLL = join(OUT, "VoltControlHarness.dll")
const PORT = 18570 // distinct from the production 8550 so a running dev connector doesn't clash
const VIEW = join(mkdtempSync(join(tmpdir(), "volt-ctl-e2e-")), "view.json")

function dotnet(): string {
	const win = "C:\\Program Files\\dotnet\\dotnet.exe"
	return existsSync(win) ? win : "dotnet"
}

// Always rebuild the harness (its Program.cs changes with the wire); skip the suite only if we can't build (no SDK).
function ensureHarness(): boolean {
	const r = spawnSync(dotnet(), ["build", join(HARNESS_DIR, "Volt.Connector.ControlHarness.csproj"), "-c", "Debug"], { stdio: "ignore" })
	return r.status === 0 && (existsSync(EXE) || existsSync(DLL))
}

const available = ensureHarness()
const suite = available ? describe : describe.skip
if (!available) console.warn("[connector.e2e] skipped — could not build the C# ControlServer harness (no .NET SDK?)")

// ── scriptable ConnectorView rows (what the live connector's ProjectView serializes to) ──
type Row = { id: string; displayName: string; vendor: string; dirty: boolean; status: string; pipe?: string; ideVersion?: string; projectName?: string }
const cs = (name: string, pid: number): Row =>
	({ id: `codesys:::${name}:`, displayName: name, vendor: "codesys", dirty: false, status: "idle", pipe: `volt.bridge.codesys.${pid}`, ideVersion: "3.5", projectName: name })
const tc = (name: string, pid: number): Row =>
	({ id: `twincat:::${name}:`, displayName: name, vendor: "twincat", dirty: false, status: "idle", pipe: `volt.bridge.twincat.${pid}`, ideVersion: "15.0", projectName: name })

function writeView(rows: Row[]): void { writeFileSync(VIEW, JSON.stringify(rows)) }

function boundWorkspace(vendor: string, projectName: string): string {
	const dir = mkdtempSync(join(tmpdir(), "volt-sess-e2e-"))
	mkdirSync(join(dir, ".git", "volt"), { recursive: true })
	writeFileSync(join(dir, ".git", "volt", "config.json"), JSON.stringify({ bridge: { vendor }, project: { platform: vendor, projectName } }))
	return dir
}

suite("volt-control ↔ real ControlServer (session model)", () => {
	let proc: ChildProcess

	beforeAll(async () => {
		process.env.VOLT_CONTROL_BASE = `http://127.0.0.1:${PORT}`
		writeView([cs("MyMachine", 1000)])
		const runner = existsSync(EXE) ? { cmd: EXE, args: [VIEW, String(PORT)] } : { cmd: dotnet(), args: [DLL, VIEW, String(PORT)] }
		proc = spawn(runner.cmd, runner.args, { stdio: ["pipe", "inherit", "inherit"] })
		const t0 = Date.now()
		while (Date.now() - t0 < 30_000) {
			if (await connectorStatus(500)) break
			await Bun.sleep(200)
		}
		expect(await connectorStatus()).toBeDefined() // the harness is really serving
	}, 90_000)

	afterAll(() => {
		try { proc?.stdin?.end() } catch {}
		try { proc?.kill() } catch {}
		delete process.env.VOLT_CONTROL_BASE
	})

	beforeEach(() => __resetSessionForTest())
	afterEach(async () => { try { await shutdownSession() } catch {}; __resetSessionForTest() })

	// ── the ambient read (the connect picker, before any session) ──
	test("GET /status lists every detected instance across vendors with its own identity — no session needed", async () => {
		writeView([cs("MachineA", 1001), cs("MachineB", 1002), tc("Line1", 2001), tc("Line2", 2002)])
		const projects = await detectedProjects()
		expect(projects.map(p => p.id).sort()).toEqual([
			"codesys:::MachineA:", "codesys:::MachineB:", "twincat:::Line1:", "twincat:::Line2:",
		])
		expect(new Set(projects.map(p => p.pipe)).size).toBe(4) // per-pid pipes — no collapsing across instances
		// These rows are SCRIPTED idle and nothing has ever wanted them, so the (edge-triggered) reconciler leaves
		// them alone — untouched, not gated. A row scripted as already-serving would stay serving here, by design.
		expect(projects.some(isServing)).toBe(false)
	})

	// ── the session API: declare interest → reconcile → serving ──
	test("declareInterest opens a session, declares the interest over the real wire, and the row serves", async () => {
		writeView([cs("MyMachine", 1000)])
		const r = await declareInterest(boundWorkspace("codesys", "MyMachine"))

		expect(r.ok).toBe(true) // the bound project is serving after the declare
		const p = (await detectedProjects()).find(x => x.id === "codesys:::MyMachine:")!
		expect(isServing(p)).toBe(true) // read back from the session's /sync view
	})

	test("dropInterest declares the smaller set — the project stops serving", async () => {
		writeView([cs("MyMachine", 1000)])
		const ws = boundWorkspace("codesys", "MyMachine")
		await declareInterest(ws)
		await dropInterest(ws)

		const p = (await detectedProjects()).find(x => x.id === "codesys:::MyMachine:")!
		expect(isServing(p)).toBe(false)
	})

	// THE CASE THE HARNESS USED TO MAKE UNTESTABLE. Every other fixture here scripts `status: "idle"`, so the old
	// harness's level-triggered "serving iff wanted" agreed with the product on all of them and stayed green while
	// modelling the opposite rule. It differs on exactly one input: a bridge ALREADY SERVING that no session has ever
	// wanted — a loaded CODESYS in-proc host serves its project without anyone asking. `Reconciler` leaves it alone
	// ("bind is level-triggered; unbind is edge-triggered … a project no session has ever wanted is left untouched"),
	// because gating it would break standalone `volt push` and would gate a neighbour the moment you connect
	// something else. The old harness idled it.
	test("a bridge already serving a project nobody declared keeps serving — connecting a neighbour does not gate it", async () => {
		const serving = { ...cs("Untouched", 1003), status: "healthy" } // serving by default, never wanted
		writeView([serving, cs("MachineA", 1001)])

		// 1. ambient read, no session at all: the pre-serving row is NOT gated.
		const before = (await detectedProjects()).find(p => p.id === "codesys:::Untouched:")!
		expect(isServing(before)).toBe(true)

		// 2. connect something ELSE: still not gated (the wanted->unwanted edge never fired for it).
		await declareInterest(boundWorkspace("codesys", "MachineA"))
		const after = await detectedProjects()
		expect(isServing(after.find(p => p.id === "codesys:::Untouched:")!)).toBe(true)
		expect(isServing(after.find(p => p.id === "codesys:::MachineA:")!)).toBe(true)
	})

	test("two workspaces declare two interests across vendors; both serve; dropping one leaves the other", async () => {
		writeView([cs("MachineA", 1001), tc("Line1", 2001)])
		const a = boundWorkspace("codesys", "MachineA")
		const b = boundWorkspace("twincat", "Line1")
		await declareInterest(a)
		await declareInterest(b)
		expect((await detectedProjects()).filter(isServing).map(p => p.id).sort()).toEqual(["codesys:::MachineA:", "twincat:::Line1:"])

		await dropInterest(a)
		expect((await detectedProjects()).filter(isServing).map(p => p.id)).toEqual(["twincat:::Line1:"]) // b still wanted
	})

	test("shutdownSession DELETEs the session — nothing stays served", async () => {
		writeView([cs("MyMachine", 1000)])
		await declareInterest(boundWorkspace("codesys", "MyMachine"))
		await shutdownSession()

		// The session is gone; the ambient GET /status shows the project idle again.
		expect((await detectedProjects()).find(x => x.id === "codesys:::MyMachine:")!.status).toBe("idle")
	})

	test("declaring interest in a project the connector doesn't have serves nothing (no error)", async () => {
		writeView([cs("MyMachine", 1000)])
		const r = await declareInterest(boundWorkspace("codesys", "Ghost"))
		expect(r.ok).toBe(false) // declared, but Ghost isn't detected → not serving
		expect((await detectedProjects()).some(isServing)).toBe(false)
	})

	test("the client reads no projects when the connector serves an empty view (not an error)", async () => {
		writeView([])
		expect(await detectedProjects()).toEqual([])
		expect(await connectorStatus()).toEqual({ projects: [] })
	})
})
