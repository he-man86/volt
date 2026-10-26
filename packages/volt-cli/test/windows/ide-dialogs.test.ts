/**
 * What `ide.ps1 up` says about a modal dialog it does not answer, and about an XAE that exited before a worker attached
 * — offline, against the pure functions of `scripts/ide-dialogs.ps1`. Gate 3.3 review: a twincat-32 attempt went red on
 * a `TcXaeShell` OK-only dialog whose MESSAGE nothing captured (only its title and buttons were logged), and the XAE's
 * exit was waited out for ten attach tries; a green rerun then left no trace of the fault. The live half (reading the
 * windows) is `Watch-XaeDialogs` in ide.ps1; the release matrix quotes these lines in a red cell (`upFailure`).
 */
import { describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

const CORE = join(import.meta.dir, "..", "..", "scripts", "ide-dialogs.ps1")

function ps(body: string): any {
	const script = `$ErrorActionPreference = "Stop"; . '${CORE}'; ${body}`
	const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8" })
	if (r.status !== 0) throw new Error(r.stderr || r.stdout)
	return JSON.parse(r.stdout)
}

const kid = (cls: string, text: string) => `[pscustomobject]@{ Class = '${cls}'; Text = "${text}" }`

describe("a modal dialog ide.ps1 does not answer", () => {
	it("is logged with its MESSAGE, not only its title and buttons", () => {
		const line = ps(`Format-XaeDialog 15572 'TcXaeShell' @(${kid("Static", "")}, ${kid("Static", "The operation could not be completed.")}, ${kid("Button", "OK")}) | ConvertTo-Json`)
		expect(line).toBe("XAE 15572 shows a modal dialog 'TcXaeShell': The operation could not be completed. (buttons: OK) - not one ide.ps1 answers; left as is")
	})
	it("joins a message of several lines and parts into one line", () => {
		const line = ps(`Format-XaeDialog 1 'T' @(${kid("Static", "first`r`nsecond")}, ${kid("RichEdit20W", "third")}, ${kid("Button", "&Yes")}, ${kid("Button", "&No")}) | ConvertTo-Json`)
		expect(line).toBe("XAE 1 shows a modal dialog 'T': first second | third (buttons: &Yes, &No) - not one ide.ps1 answers; left as is")
	})
	it("says so when the dialog shows no readable message", () => {
		const line = ps(`Format-XaeDialog 1 'T' @(${kid("Button", "OK")}) | ConvertTo-Json`)
		expect(line).toBe("XAE 1 shows a modal dialog 'T': (no readable message) (buttons: OK) - not one ide.ps1 answers; left as is")
	})
})

describe("an XAE that exits before a worker attached", () => {
	it("is named with every dialog it showed", () => {
		const said = ps(`Format-XaeExit 15572 @("XAE 15572 shows a modal dialog 'TcXaeShell': x (buttons: OK) - not one ide.ps1 answers; left as is") | ConvertTo-Json`)
		expect(said).toBe("XAE 15572 exited before a worker attached; it showed: XAE 15572 shows a modal dialog 'TcXaeShell': x (buttons: OK) - not one ide.ps1 answers; left as is")
	})
	it("and says it showed none", () => {
		expect(ps(`Format-XaeExit 7 @() | ConvertTo-Json`)).toBe("XAE 7 exited before a worker attached; it showed no dialog")
	})
})
