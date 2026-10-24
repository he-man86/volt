/**
 * Which run an `ide.ps1` instance is in, and which running IDE processes that run does not own — offline, against the
 * pure functions of `scripts/ide-run.ps1` (openspec shared-ide-machine-rules). The live half (pid records, Test-Ours,
 * the refusal on `up`) runs in the release matrix.
 */
import { describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

const CORE = join(import.meta.dir, "..", "..", "scripts", "ide-run.ps1")

/** Dot-source the core, run `body`, and parse what it writes as JSON. */
function ps(body: string): any {
	const script = `$ErrorActionPreference = "Stop"; . '${CORE}'; ${body}`
	const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8" })
	if (r.status !== 0) throw new Error(r.stderr || r.stdout)
	return JSON.parse(r.stdout)
}

describe("run membership", () => {
	it("a run owns its own instance and every <tag>-… one, nothing else", () => {
		const r = ps(`@(
			(Test-RunOwns 'release-matrix' 'release-matrix'),
			(Test-RunOwns 'release-matrix' 'release-matrix-codesys-3.5.22.40-64'),
			(Test-RunOwns 'release-matrix' 'release-matrix-mixed-version-cur-cli'),
			(Test-RunOwns 'release-matrix' 'release-matrixx'),
			(Test-RunOwns 'release-matrix' 'volt-cli-rework'),
			(Test-RunOwns 'release-matrix' '')
		) | ConvertTo-Json -Compress`)
		expect(r).toEqual([true, true, true, false, false, false])
	})

	it("the empty tag owns the default instance only — never every instance", () => {
		const r = ps(`@((Test-RunOwns '' ''), (Test-RunOwns '' 'a'), (Test-RunOwns '' '-a')) | ConvertTo-Json -Compress`)
		expect(r).toEqual([true, false, false])
	})

	it("membership is case-sensitive, like the pid record's file name", () => {
		expect(ps(`(Test-RunOwns 'release-matrix' 'Release-Matrix-x') | ConvertTo-Json`)).toBe(false)
	})
})

describe("the run an invocation is in", () => {
	it("-Run wins over VOLT_IDE_RUN, which wins over the instance alone", () => {
		const r = ps(`@(
			(Resolve-RunTag $true 'release-matrix' 'other' 'release-matrix-x'),
			(Resolve-RunTag $false '' 'release-matrix' 'release-matrix-x'),
			(Resolve-RunTag $false '' '' 'volt-cli-rework')
		) | ConvertTo-Json -Compress`)
		expect(r).toEqual(["release-matrix", "release-matrix", "volt-cli-rework"])
	})

	it("an instance outside the run it is told it is in is refused by name", () => {
		expect(() => ps(`Resolve-RunTag $false '' 'release-matrix' 'volt-cli-rework' | ConvertTo-Json`)).toThrow(
			"instance volt-cli-rework is not in run 'release-matrix'",
		)
	})
})

describe("pid record names", () => {
	it("names the vendor and the instance; the default instance is the empty one; anything else is no record", () => {
		const r = ps(`@(
			(Get-RecordInstance 'codesys-ide.pids'),
			(Get-RecordInstance 'twincat-ide-volt-cli-rework.pids'),
			(Get-RecordInstance 'codesys-ide-release-matrix-codesys-3.5.22.40-64.pids'),
			(Get-RecordInstance 'codesys-ide-x.projects'),
			(Get-RecordInstance 'other-ide-x.pids')
		) | ForEach-Object { if ($null -eq $_) { 'none' } else { "$($_.Vendor)|$($_.Instance)" } } | ConvertTo-Json -Compress`)
		expect(r).toEqual(["codesys|", "twincat|volt-cli-rework", "codesys|release-matrix-codesys-3.5.22.40-64", "none", "none"])
	})
})

describe("foreign processes", () => {
	const PROCS = `@(
		[pscustomobject]@{ Pid = 10; Name = 'CODESYS.exe'; CommandLine = 'CODESYS.exe --runscript=x.py' },
		[pscustomobject]@{ Pid = 20; Name = 'TcXaeShell.exe'; CommandLine = 'TcXaeShell.exe "C:\\\\t\\\\Project14.sln"' },
		[pscustomobject]@{ Pid = 30; Name = 'VoltBridgeTwincat.exe'; CommandLine = $null }
	)`

	it("everything the run's records do not name is foreign — an unreadable owner included", () => {
		const r = ps(`@(Select-Foreign ${PROCS} @(20) | ForEach-Object { $_.Pid }) | ConvertTo-Json -Compress`)
		expect(r).toEqual([10, 30])
	})

	it("nothing running, or all of it the run's own, is no refusal", () => {
		expect(ps(`@(Select-Foreign ${PROCS} @(10, 20, 30)).Count | ConvertTo-Json`)).toBe(0)
		expect(ps(`@(Select-Foreign @() @()).Count | ConvertTo-Json`)).toBe(0)
	})

	// The live matrix started beside ONE foreign CODESYS: a function's one-element array reaches its caller as the bare
	// element, and Windows PowerShell's [pscustomobject] has no .Count — so "$foreign.Count -gt 0" was false.
	it("ONE foreign process is a refusal — a single element is not nothing", () => {
		const one = `@([pscustomobject]@{ Pid = 10; Name = 'CODESYS.exe'; CommandLine = 'CODESYS.exe' })`
		const text: string = ps(`Get-ForeignRefusal 'release-matrix' ${one} @() | ConvertTo-Json`)
		expect(text).toContain("will not start beside an IDE it does not own - 1 running")
		expect(text).toContain("pid 10 CODESYS.exe: CODESYS.exe")
		expect(ps(`$null -eq (Get-ForeignRefusal 'release-matrix' ${one} @(10)) | ConvertTo-Json`)).toBe(true)
		expect(ps(`$null -eq (Get-ForeignRefusal 'release-matrix' @() @()) | ConvertTo-Json`)).toBe(true)
	})

	// And the reverse: NO IDE running reaches it as $null (a function's empty array), which a pipeline counts as one
	// process — the matrix refused "pid  : (command line not readable)" on an empty machine.
	it("no process at all — $null, as a function returns an empty list — is no refusal", () => {
		expect(ps(`function None { @() }; $null -eq (Get-ForeignRefusal 'release-matrix' (None) @()) | ConvertTo-Json`)).toBe(true)
	})

	it("the refusal names each process by pid, image and command line", () => {
		const text: string = ps(`Get-ForeignRefusal 'release-matrix' ${PROCS} @(20) | ConvertTo-Json`)
		expect(text).toContain("run 'release-matrix' will not start beside an IDE it does not own - 2 running")
		expect(text).toContain("pid 10 CODESYS.exe: CODESYS.exe --runscript=x.py")
		expect(text).toContain("pid 30 VoltBridgeTwincat.exe: (command line not readable)")
		expect(text).not.toContain("pid 20")
	})
})
