/**
 * IDE-PROCESS chaos, on the one-worker-per-XAE model: close the IDE serving the bound project MID-CONNECTION and open
 * the project again, asserting
 * (a) the worker of the closed XAE reports a clean disconnect — no crash, no wrong-project, `PLC_DISCONNECTED` (never a
 *     dead-handle "still serving" nor an opaque INTERNAL_ERROR) — and
 * (b) the SAME project — the copy the killed XAE had open, as it is on disk, not a fresh fixture (`ide.ps1 up -Reopen`
 *     neither re-copies nor clears its recovery entries; a marker file written beside it before the kill proves it) —
 *     opened again is a NEW XAE, served by a NEW worker on its own pipe (`volt.bridge.twincat.<new pid>`), by its
 *     stable name. A worker serves the one XAE whose pid names its pipe and never re-attaches to another window, so a
 *     reopened project comes back only through a new worker. HERE `ide.ps1` spawns it, with the arguments the connector
 *     uses (`--xae-pid <pid>`): running the real connector would also attach workers to XAE windows this run does not
 *     own. That the connector spawns one for a newly seen XAE and reaps the closed one's is pinned offline
 *     (`Volt.Connector.Tests/TwincatFleetTests.A_project_opened_again_in_a_new_XAE_gets_a_new_worker_and_the_closed_one_is_reaped`);
 *     this test proves the worker then serves the reopened project.
 *
 * What survives the kill is the engineer's, not Volt's: Volt never saves the project (a push is an edit in the open
 * IDE, as on CODESYS), so work the engineer did not save is gone with the process, exactly as in the IDE itself.
 *
 * This drives real OS process kills + a fresh TcXaeShell boot, so it is SLOW, DESTRUCTIVE (it closes an IDE window),
 * and LOCAL-only. It is GATED behind `VOLT_E2E_IDE_CHAOS=1` and runs only for TwinCAT: for CODESYS the in-proc host dies
 * WITH the IDE, so there's nothing on the far side of the pipe to test. It only ever kills the XAE behind the harness's
 * OWN pipe — one an `ide.ps1` instance started on a fixture copy (`lib/fixture-ide.ts`) — and opens that copy again
 * through that same instance, so the new XAE and worker are the instance's own (and `ide.ps1 down` closes them).
 *
 *   pwsh scripts/ide.ps1 up -Vendor twincat -Instance <name> -Fixture 14 -Wait
 *   $env:VOLT_E2E_INSTANCE="<name>"; $env:VOLT_E2E_IDE_CHAOS="1"; $env:VOLT_VENDOR="twincat"; bun test test/e2e/connection/ide-restart.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { bridge, serving, requireHealthy, opErrorCode, BASE, VENDOR, currentPipe } from "../harness"
import { callOn } from "../lib/pipe"
import { E2E_INSTANCE } from "../lib/fixture-ide"
import { servedSolutionDir } from "../lib/tc-files"

const DISCONNECTED = "PLC_DISCONNECTED"
const ENABLED = process.env.VOLT_E2E_IDE_CHAOS === "1" && VENDOR === "twincat"
const IDE_PS1 = join(import.meta.dir, "..", "..", "..", "scripts", "ide.ps1")

type Bound = { project?: string | null }

/**
 * The XAE behind the harness's pipe, its pipe, and the copy it has open — captured once, while it is alive, with a marker
 * written into that copy (no fixture holds one, so a fresh copy would not). The pipe is `volt.bridge.twincat.<xae pid>`
 * and was proven to belong to an ide.ps1 fixture instance before anything here runs.
 */
const MARKER = "volt-e2e-ide-restart.marker"
let target: { xaePid: number; pipe: string; dir: string } | undefined
function captureTarget(): void {
	const pipe = currentPipe()
	const dir = servedSolutionDir()
	writeFileSync(join(dir, MARKER), `written before XAE ${pipe} was killed
`)
	target = { xaePid: Number(pipe.split(".").pop()), pipe, dir }
}
/** Kill the XAE (its own process; its worker survives it). Only ever the one the harness's own pipe is named after. */
function killIde(): void {
	spawnSync("powershell", ["-NoProfile", "-Command", `Stop-Process -Id ${target!.xaePid} -Force -ErrorAction SilentlyContinue`],
		{ encoding: "utf8", timeout: 60_000 })
}
/** Open the SAME copy again as the engineer does, in a NEW XAE (`-Reopen`: no fresh copy, no recovery entry cleared; its
 *  Recovered Files dialog is answered "Do Not Recover", the engineer's choice for work Volt never saved), and give it its
 *  worker with the connector's arguments — through the same ide.ps1 instance, which first closes the dead XAE's worker. */
function reopenIde(): void {
	const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", IDE_PS1, "up", "-Vendor", "twincat",
		"-Instance", E2E_INSTANCE, "-Reopen", "-NoBuild", "-Wait"], { encoding: "utf8", timeout: 900_000 })
	if (r.status !== 0) throw new Error(`ide.ps1 up did not open the project again (exit ${r.status}): ${r.stdout}\n${r.stderr}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// It kills and reopens "the" IDE, so its fixture instance must serve exactly one XAE — which every run now requires:
// the harness refuses an instance serving several (`lib/pipe.ts` onePipe) instead of picking the first.

describe.skipIf(!ENABLED)(`ide-restart / close + reopen the IDE mid-connection (${BASE})`, () => {
	setDefaultTimeout(900_000) // a fresh IDE boot and a worker attach are minutes
	let bound: Bound = {}

	beforeAll(async () => {
		await requireHealthy()
		captureTarget()
		const row = (await bridge.projects())?.[0]
		bound = { project: row?.project }
		await bridge.connect(bound)
	})
	afterAll(async () => { try { await bridge.connect(bound) } catch {} })

	it("closing the IDE => its worker answers a clean PLC_DISCONNECTED, not a crash and not a stale wrong-project read", async () => {
		expect(await serving()).toBe(true)
		killIde()
		// Within a few probe cycles the worker must notice the dead DTE and refuse cleanly. The two failure modes we
		// are ruling out: keeping a dead handle and reporting "still serving" (code null), or an opaque INTERNAL_ERROR.
		let code: string | null = "?"
		for (let i = 0; i < 20; i++) {
			code = await opErrorCode(() => callOn(target!.pipe, "refs"))
			if (code === DISCONNECTED) break
			await sleep(2000)
		}
		expect(code).toBe(DISCONNECTED)
	})

	it("opening the same project again => a new XAE with a new worker serves it by name", async () => {
		// (the IDE is down from the previous test)
		reopenIde()
		// The copy the killed XAE had open, not a fresh one: same folder, and the marker written into it survived.
		expect(servedSolutionDir()).toBe(target!.dir)
		expect(existsSync(join(target!.dir, MARKER))).toBe(true)
		// The harness follows the instance to the new pipe: the old one is gone with its worker.
		await requireHealthy()
		const pipe = currentPipe()
		expect(pipe).not.toBe(target!.pipe)
		expect(Number(pipe.split(".").pop())).not.toBe(target!.xaePid)
		await bridge.connect(bound)
		const served = (await bridge.projects()).find((p: any) => p.status && p.status !== "idle")
		expect(served?.project).toBe(bound.project)
		expect(Object.keys((await bridge.refs()).items ?? {}).length).toBeGreaterThan(0)
	})
})
