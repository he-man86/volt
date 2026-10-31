/**
 * What `ide.ps1 up` says about a modal dialog it does not answer, and about an XAE that exited before a worker attached
 * — offline, against the pure functions of `scripts/ide-dialogs.ps1`. Gate 3.3 review: a twincat-32 attempt went red on
 * a `TcXaeShell` OK-only dialog whose MESSAGE nothing captured (only its title and buttons were logged), and the XAE's
 * exit was waited out for ten attach tries; a green rerun then left no trace of the fault. The live half (reading the
 * windows) is `Watch-XaeDialogs` in ide.ps1; the release matrix quotes these lines in a red cell (`upFailure`).
 */
import { beforeAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

const CORE = join(import.meta.dir, "..", "..", "scripts", "ide-dialogs.ps1")

const kid = (cls: string, text: string) => `[pscustomobject]@{ Class = '${cls}'; Text = "${text}" }`

// ONE PowerShell for every case: each spawn of Windows PowerShell costs a cold start (seconds on a loaded CI runner),
// and five of them put the first case past bun's 5 s default for work that is a handful of pure function calls.
const CASES = {
	message: `Format-XaeDialog 15572 'TcXaeShell' @(${kid("Static", "")}, ${kid("Static", "The operation could not be completed.")}, ${kid("Button", "OK")})`,
	lines: `Format-XaeDialog 1 'T' @(${kid("Static", "first`r`nsecond")}, ${kid("RichEdit20W", "third")}, ${kid("Button", "&Yes")}, ${kid("Button", "&No")})`,
	unreadable: `Format-XaeDialog 1 'T' @(${kid("Button", "OK")})`,
	exitShowed: `Format-XaeExit 15572 @("XAE 15572 shows a modal dialog 'TcXaeShell': x (buttons: OK) - not one ide.ps1 answers; left as is")`,
	exitNone: `Format-XaeExit 7 @()`,
}
let said: Record<keyof typeof CASES, string>

beforeAll(() => {
	const body = Object.entries(CASES).map(([k, v]) => `'${k}' = (${v})`).join("; ")
	const script = `$ErrorActionPreference = "Stop"; . '${CORE}'; @{ ${body} } | ConvertTo-Json`
	const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8" })
	if (r.status !== 0) throw new Error(r.stderr || r.stdout)
	said = JSON.parse(r.stdout)
}, 60_000) // ponytail: one cold PowerShell start; the bound is for the process start, not for the functions under test

describe("a modal dialog ide.ps1 does not answer", () => {
	it("is logged with its MESSAGE, not only its title and buttons", () => {
		expect(said.message).toBe("XAE 15572 shows a modal dialog 'TcXaeShell': The operation could not be completed. (buttons: OK) - not one ide.ps1 answers; left as is")
	})
	it("joins a message of several lines and parts into one line", () => {
		expect(said.lines).toBe("XAE 1 shows a modal dialog 'T': first second | third (buttons: &Yes, &No) - not one ide.ps1 answers; left as is")
	})
	it("says so when the dialog shows no readable message", () => {
		expect(said.unreadable).toBe("XAE 1 shows a modal dialog 'T': (no readable message) (buttons: OK) - not one ide.ps1 answers; left as is")
	})
})

describe("an XAE that exits before a worker attached", () => {
	it("is named with every dialog it showed", () => {
		expect(said.exitShowed).toBe("XAE 15572 exited before a worker attached; it showed: XAE 15572 shows a modal dialog 'TcXaeShell': x (buttons: OK) - not one ide.ps1 answers; left as is")
	})
	it("and says it showed none", () => {
		expect(said.exitNone).toBe("XAE 7 exited before a worker attached; it showed no dialog")
	})
})
