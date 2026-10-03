/**
 * IDE-PROCESS chaos: close the IDE serving the bound project MID-CONNECTION and reopen it, asserting the bridge
 * (a) reports a clean disconnect while the IDE is gone — no crash, no wrong-project, `PLC_DISCONNECTED` (never a
 * dead-handle "still serving" nor an opaque INTERNAL_ERROR), and (b) AUTO-RECOVERS to the SAME project by its
 * stable name once the IDE returns, with the work saved before the kill still intact (no corruption).
 *
 * This drives real OS process kills + a fresh TcXaeShell boot + build, so it is SLOW, DESTRUCTIVE (it closes an
 * IDE window), and LOCAL-only. It is GATED behind `VOLT_E2E_IDE_CHAOS=1` and runs only for TwinCAT: there the
 * connector worker survives the IDE's death and must recover; for CODESYS the in-proc host dies WITH the IDE, so
 * there's nothing on the far side of the pipe to test. It only ever kills the XAE behind the harness's OWN pipe — one
 * an `ide.ps1` instance started on a fixture copy (`lib/fixture-ide.ts`) — and reopens that same copy's `.sln`.
 *
 *   pwsh scripts/ide.ps1 up -Vendor twincat -Fixture 13 -Wait
 *   $env:VOLT_E2E_IDE_CHAOS="1"; $env:VOLT_VENDOR="twincat"; bun test test/e2e/connection/ide-restart.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { spawnSync } from "node:child_process"
import { basename, join } from "node:path"
import { bridge, requireHealthy, opErrorCode, createItem, fetchSource, fid, BASE, VENDOR, currentPipe, livePipes } from "../harness"
import { servedSolutionDir } from "../lib/tc-files"

const DISCONNECTED = "PLC_DISCONNECTED"
const ENABLED = process.env.VOLT_E2E_IDE_CHAOS === "1" && VENDOR === "twincat"
const XAE = "C:\\Program Files (x86)\\Beckhoff\\TcXaeShell\\Common7\\IDE\\TcXaeShell.exe"

type Bound = { project?: string | null }

function ps(cmd: string): void {
	spawnSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8", timeout: 60_000 })
}

/**
 * The XAE behind the harness's pipe and the copy's `.sln` it has open — captured once, while it is alive. The pipe is
 * `volt.bridge.twincat.<xae pid>` and was proven to belong to an ide.ps1 fixture instance before anything here runs.
 *
 * <p>This used to kill every TcXaeShell whose window TITLE carried the project name — an engineer's own window with a
 * `Project13` in it included — and reopen through `ide.ps1 up -Which`, a parameter that no longer exists.</p>
 */
let target: { xaePid: number; sln: string } | undefined
function captureTarget(): void {
	const dir = servedSolutionDir()
	target = { xaePid: Number(currentPipe().split(".").pop()), sln: join(dir, `${basename(dir)}.sln`) }
}
/** Kill the XAE (its own process; the worker survives). Only ever the one the harness's own pipe is named after. */
function killIde(): void {
	ps(`Stop-Process -Id ${target!.xaePid} -Force -ErrorAction SilentlyContinue`)
}
/** Reopen the SAME fixture copy. `ide.ps1 down` still closes it: it finds an XAE holding its copy by command line. */
function reopenIde(): void {
	ps(`Start-Process -FilePath '${XAE}' -ArgumentList '"${target!.sln}"'`)
}
async function serving(): Promise<boolean> { return (await opErrorCode(() => bridge.refs())) === null }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** This test kills and reopens "the" IDE, so it REQUIRES its fixture instance to serve exactly one XAE: with two, the
 *  harness's pick after a restart could land on the other and the failures look like product bugs (they aren't). */
function requireSingleIde(): void {
	const pipes = livePipes()
	if (pipes.length !== 1)
		throw new Error(
			`ide-restart needs its fixture instance to serve EXACTLY ONE TwinCAT XAE, found ${pipes.length} (${pipes.join(", ")}). ` +
				`Reset with: pwsh scripts/ide.ps1 up -Vendor twincat -Fixture 13 -Wait`,
		)
}

describe.skipIf(!ENABLED)(`ide-restart / close + reopen the IDE mid-connection (${BASE})`, () => {
	setDefaultTimeout(300_000) // a fresh IDE boot + build is minutes
	let bound: Bound = {}

	beforeAll(async () => {
		requireSingleIde()
		await requireHealthy()
		captureTarget()
		const row = (await bridge.projects())?.[0]
		bound = { project: row?.project }
		await bridge.connect(bound)
	})
	afterAll(async () => { try { await bridge.connect(bound) } catch {} })

	it("closing the IDE => a clean PLC_DISCONNECTED, not a crash and not a stale wrong-project read", async () => {
		expect(await serving()).toBe(true)
		killIde()
		// Within a few probe cycles the worker must notice the dead DTE and refuse cleanly. The two failure modes we
		// are ruling out: keeping a dead handle and reporting "still serving" (code null), or an opaque INTERNAL_ERROR.
		let code: string | null = "?"
		for (let i = 0; i < 20; i++) {
			code = await opErrorCode(() => bridge.refs())
			if (code === DISCONNECTED) break
			await sleep(2000)
		}
		expect(code).toBe(DISCONNECTED)
	})

	it("reopening the IDE => the bridge auto-recovers the SAME project by name, work saved before the kill intact", async () => {
		// A pushed item is SaveAll'd to disk, so it must survive the IDE dying and coming back.
		const name = fid("restart_survives")
		// (the IDE is down from the previous test) bring it back first so we can create the item
		reopenIde()
		let up = false
		for (let i = 0; i < 90; i++) { // up to ~3 min: boot + build
			const c = await opErrorCode(() => bridge.connect(bound))
			if (c === null && (await serving())) { up = true; break }
			await sleep(2000)
		}
		expect(up).toBe(true)

		await createItem(name, "FUNCTION_BLOCK VltE2E_restart_survives\nVAR\n\tkeep : INT := 99;\nEND_VAR\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK")

		// Now the real test: kill it AFTER the item is saved, reopen, and the item must still be there.
		killIde()
		for (let i = 0; i < 20; i++) { if ((await opErrorCode(() => bridge.refs())) === DISCONNECTED) break; await sleep(2000) }
		reopenIde()
		let recovered = false
		for (let i = 0; i < 90; i++) {
			const c = await opErrorCode(() => bridge.connect(bound))
			if (c === null && (await serving())) { recovered = true; break }
			await sleep(2000)
		}
		expect(recovered).toBe(true)
		expect(await fetchSource(name)).toContain("keep : INT := 99") // no corruption across the crash/restart

		const v = (await bridge.refs()).items[name]
		if (v) await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops: [{ op: "deleteItem", name, ifVersion: v }] })
	})
})
