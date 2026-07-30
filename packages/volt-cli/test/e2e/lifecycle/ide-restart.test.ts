/**
 * IDE-PROCESS chaos: close the IDE serving the bound project MID-CONNECTION and reopen it, asserting the bridge
 * (a) reports a clean disconnect while the IDE is gone — no crash, no wrong-project, `PLC_DISCONNECTED` (never a
 * dead-handle "still serving" nor an opaque INTERNAL_ERROR), and (b) AUTO-RECOVERS to the SAME project by its
 * stable name once the IDE returns, with the work saved before the kill still intact (no corruption).
 *
 * This drives real OS process kills + a fresh TcXaeShell boot + build, so it is SLOW, DESTRUCTIVE (it closes an
 * IDE window), and LOCAL-only. It is GATED behind `VOLT_E2E_IDE_CHAOS=1` and runs only for TwinCAT: there the
 * connector worker survives the IDE's death and must recover; for CODESYS the in-proc host dies WITH the IDE, so
 * there's nothing on the far side of the pipe to test. It reopens via the committed fixtures (twincat-instances.ps1),
 * so run it against a FIXTURE-launched setup, not a project you can't afford to have closed.
 *
 *   $env:VOLT_E2E_IDE_CHAOS="1"; $env:VOLT_PIPE="volt.bridge.twincat"; $env:VOLT_VENDOR="twincat"
 *   bun test test/e2e/lifecycle/ide-restart.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { bridge, requireHealthy, opErrorCode, createItem, fetchSource, fid, BASE, VENDOR } from "../harness"

const DISCONNECTED = "PLC_DISCONNECTED"
const ENABLED = process.env.VOLT_E2E_IDE_CHAOS === "1" && VENDOR === "twincat"

type Bound = { project?: string | null }

function ps(cmd: string): void {
	spawnSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8", timeout: 60_000 })
}
/** Kill the TcXaeShell window whose title carries this project name (its own process; the worker survives). */
function killIde(project: string): void {
	ps(`Get-Process TcXaeShell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*${project}*' } | Stop-Process -Force`)
}
/** Reopen the committed fixture for this project via the launcher (Project13 -> 13, Project14 -> 14). */
function reopenIde(project: string): void {
	const n = project.match(/(\d+)\s*$/)?.[1] ?? "14"
	ps(`& '${process.cwd()}\\scripts\\twincat-instances.ps1' up -Which ${n}`)
}
async function serving(): Promise<boolean> { return (await opErrorCode(() => bridge.refs())) === null }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** This test kills and reopens "the" IDE by project name, so it REQUIRES exactly one live XAE. With two open, the
 *  kill/reopen and the harness's pipe pick race each other and the failures look like product bugs (they aren't).
 *  Fail loud with the fix rather than quietly closing IDEs this test didn't open. */
function liveXaePipes(): string[] {
	try {
		return readdirSync("\\\\.\\pipe\\").filter((n) => n.startsWith("volt.bridge.twincat."))
	} catch {
		return []
	}
}
function requireSingleIde(): void {
	const pipes = liveXaePipes()
	if (pipes.length !== 1)
		throw new Error(
			`ide-restart needs EXACTLY ONE live TwinCAT XAE, found ${pipes.length} (${pipes.join(", ") || "none"}). ` +
				`Reset with: pwsh scripts/twincat-instances.ps1 down; then up -Which 13`,
		)
}

describe.skipIf(!ENABLED)(`ide-restart / close + reopen the IDE mid-connection (${BASE})`, () => {
	setDefaultTimeout(300_000) // a fresh IDE boot + build is minutes
	let bound: Bound = {}

	beforeAll(async () => {
		requireSingleIde()
		await requireHealthy()
		const row = (await bridge.instances())?.[0]
		bound = { project: row?.project }
		await bridge.connect(bound)
	})
	afterAll(async () => { try { await bridge.connect(bound) } catch {} })

	it("closing the IDE => a clean PLC_DISCONNECTED, not a crash and not a stale wrong-project read", async () => {
		expect(await serving()).toBe(true)
		killIde(bound.project!)
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
		reopenIde(bound.project!)
		let up = false
		for (let i = 0; i < 90; i++) { // up to ~3 min: boot + build
			const c = await opErrorCode(() => bridge.connect(bound))
			if (c === null && (await serving())) { up = true; break }
			await sleep(2000)
		}
		expect(up).toBe(true)

		await createItem(name, "FUNCTION_BLOCK VltE2E_restart_survives\nVAR\n\tkeep : INT := 99;\nEND_VAR\nEND_FUNCTION_BLOCK")

		// Now the real test: kill it AFTER the item is saved, reopen, and the item must still be there.
		killIde(bound.project!)
		for (let i = 0; i < 20; i++) { if ((await opErrorCode(() => bridge.refs())) === DISCONNECTED) break; await sleep(2000) }
		reopenIde(bound.project!)
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
