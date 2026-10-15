#!/usr/bin/env bun
/**
 * `bun run release:matrix` — THE LIVE RELEASE GATE: the e2e suite over EVERY IDE variant installed on this machine,
 * one cell per variant, the matrix printed, and a red cell fails the run (openspec environment-dependency-audit 3.1).
 *
 * <p>Why it exists: the TwinCAT bridge once failed on every plain TwinCAT install while every test passed, because the
 * dev machine had Visual Studio; and a CODESYS SP18 regression failed 212 of 218 e2e tests while the SP21 suite was
 * green, because nobody ran SP18. A release was gated by hand-run e2e on ONE IDE. Now `release.ts` refuses to promote
 * a build unless this matrix ran green on that build's commit (`dist/release-matrix/result.json`).</p>
 *
 * <p>The cells (found, never configured): every `CODESYS <version>` under `Program Files` (64-bit) and
 * `Program Files (x86)` (32-bit), and every registered XAE shell (32-bit TcXaeShell, 64-bit TcXaeShell64). Each is
 * served by `packages/volt-cli/scripts/ide.ps1 up -Instance release-matrix-<cell>` on that variant's OWN fixture project, the
 * whole `test/e2e` suite runs against it, and the run's own report (`VOLT_E2E_REPORT`) must name the version and
 * bitness the cell is about — a cell that drove some other IDE is red. A cell is red, by name, when:</p>
 * <ul>
 *   <li>the version has no fixture project of its own (owner, 2026-10-13: a project opened from another version's file
 *       is an upgrade on open, not a native project — task 2.5b makes one per version);</li>
 *   <li>a TwinCAT cell runs where Visual Studio's 64-bit msenvp proxy is registered — not the customer's machine
 *       (DIALECT C2t: the field bug passed every test because of it);</li>
 *   <li>the machine has no install of a vendor at all (`codesys-none`, `twincat-none`) — a vendor nobody ran is not
 *       covered, so it is never left out of the matrix;</li>
 *   <li>the suite failed, or the IDE did not come up.</li>
 * </ul>
 *
 * <p>A result is written only for a full run on a checkout that IS its HEAD (modified or untracked files outside
 * `openspec/` record it NOT green). `release.ts` attaches it to the release as `release-matrix.json`, and
 * `promote.yml` refuses a release whose attached result is missing or not green on the release's own commit
 * (`--verify`), so both doors to a release judge the same proof.</p>
 *
 *   bun run release:matrix                  # every cell
 *   bun run release:matrix --list           # the cells this machine has, and stop
 *   bun run release:matrix --jobs 1         # one cell at a time (default 3)
 *   bun run release:matrix --only codesys-3.5.21.60-32,twincat-32
 *   bun run release:matrix --tests test/e2e/endpoints   # a SUBSET: printed, never a release result
 *   bun scripts/release-matrix.ts --verify <result.json> <sha>   # judge a result for a commit (promote.yml)
 *
 * Long: a full cell is the whole e2e suite (tens of minutes). Cells run 3 at a time (`--jobs`), each on its own
 * `ide.ps1` instance — its own fixture copy and pipe, which the e2e harness alone talks to. More at once loads the
 * machine enough to push the latency test past its floors. Windows only.
 */
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
	codesysCells, dirtyPaths, judge, parseSummary, proofRefusal, renderMatrix, twincatCells,
	type Cell, type Outcome, type Report, type Verdict,
} from "../packages/volt-cli/scripts/release-matrix-cells.js"

const REPO = resolve(import.meta.dir, "..")
const CLI = join(REPO, "packages", "volt-cli")
const FIXTURES = join(CLI, "test", "fixtures")
const OUT = join(REPO, "dist", "release-matrix")

// ── reading this machine ─────────────────────────────────────────────────────────────────────────────────────

function ps(script: string, timeoutMs = 60_000): { status: number | null; out: string; err: string } {
	const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
		encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
	})
	return { status: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() || String(r.error ?? "") }
}

/** A Program Files folder as Windows names it to this process — never a hard-coded `C:\Program Files` (a machine may
 *  install Windows elsewhere), and refused by name when Windows names none. */
function programFiles(variable: "ProgramW6432" | "ProgramFiles(x86)"): string {
	const dir = process.env[variable]
	if (!dir) throw new Error(`%${variable}% is not set - cannot tell where ${variable === "ProgramW6432" ? "64" : "32"}-bit CODESYS installs`)
	return dir
}

/** The `CODESYS <version>` installs under `dir` (a folder that does not exist holds none; any other read error throws). */
function listDir(dir: string): string[] {
	if (!existsSync(dir)) return []
	return readdirSync(dir).filter((n) => existsSync(join(dir, n, "CODESYS", "Common", "CODESYS.exe")))
}

/** The registered XAE shells' bitness, by the PE machine of each `TcXaeShell*.DTE.*` ProgID's LocalServer32. */
function xaeShellBits(): (32 | 64)[] {
	const r = ps(
		"$found=@(); foreach ($v in [Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64) { " +
			"$h=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::ClassesRoot,$v); " +
			"foreach ($p in @($h.GetSubKeyNames() | ? { $_ -match '^TcXaeShell(64)?\\.DTE\\.\\d+\\.\\d+$' })) { " +
			"$c=$h.OpenSubKey(\"$p\\CLSID\"); if (-not $c) { continue }; $s=$h.OpenSubKey(\"CLSID\\$($c.GetValue(''))\\LocalServer32\"); if (-not $s) { continue }; " +
			"$e=([string]$s.GetValue('')).Trim(); if ($e -match '^\"([^\"]+)\"') { $e=$Matches[1] } elseif ($e -match '^(\\S+\\.exe)') { $e=$Matches[1] }; " +
			"if ((Test-Path $e) -and ($found -notcontains $e)) { $found+=$e } } }; " +
			"$found | % { $b=[IO.File]::ReadAllBytes($_); $pe=[BitConverter]::ToInt32($b,0x3C); [BitConverter]::ToUInt16($b,$pe+4) }",
	)
	if (r.status !== 0) throw new Error(`could not read the registered XAE shells: ${r.err}`)
	return r.out.split(/\r?\n/).filter(Boolean).map((m) => {
		if (m === "332") return 32
		if (m === "34404") return 64
		throw new Error(`a registered XAE shell is neither x86 nor x64 (PE machine ${m})`)
	})
}

function vsProxy64Registered(): boolean {
	const r = ps("[bool]([Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine','Registry64').OpenSubKey('SOFTWARE\\Classes\\CLSID\\{E6D78900-BB40-4039-9C54-593A242B65DA}'))")
	if (r.status !== 0) throw new Error(`could not read the msenvp registration: ${r.err}`)
	return r.out === "True"
}

export function machineCells(): Cell[] {
	const fixtures = readdirSync(FIXTURES)
	return [
		...codesysCells(listDir(programFiles("ProgramW6432")), listDir(programFiles("ProgramFiles(x86)")), fixtures),
		...twincatCells(xaeShellBits(), vsProxy64Registered()),
	]
}

// ── running a cell ───────────────────────────────────────────────────────────────────────────────────────────

/** spawnSync's result, without blocking: the cells run side by side. */
function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout: number }): Promise<{ status: number | null; text: string }> {
	return new Promise((done) => {
		const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env })
		const chunks: Buffer[] = []
		child.stdout.on("data", (b: Buffer) => chunks.push(b))
		child.stderr.on("data", (b: Buffer) => chunks.push(b))
		const timer = setTimeout(() => child.kill(), opts.timeout)
		child.on("close", (status) => { clearTimeout(timer); done({ status, text: Buffer.concat(chunks).toString("utf8") }) })
	})
}

/** Each cell its own ide.ps1 instance, so cells running at once never share an IDE, a fixture copy or a pipe. */
const instanceOf = (cell: Cell): string => `release-matrix-${cell.id}`

async function ide(action: "up" | "down", cell: Cell, log: string[]): Promise<boolean> {
	const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(CLI, "scripts", "ide.ps1"), action,
		"-Vendor", cell.vendor, "-Instance", instanceOf(cell)]
	if (action === "up") {
		if (cell.vendor === "codesys") args.push("-CodesysVersion", cell.version!, "-CodesysBitness", String(cell.bits), "-Fixture", join(FIXTURES, cell.fixture!))
		else args.push("-Fixture", "14", "-XaeBitness", String(cell.bits))
		args.push("-Wait", "-NoBuild")   // built once, before the pool (buildBridges): cells at once share one bin\
	}
	const r = await run("powershell", args, { timeout: action === "up" ? 20 * 60_000 : 10 * 60_000 })
	log.push(`── ide.ps1 ${action} (exit ${r.status})`, r.text)
	return r.status === 0
}

/** The bridges every cell serves, built ONCE before the cells start: each `ide.ps1 up` used to rebuild them into the
 *  same bin\, and three cells starting together failed on each other's locked output (MSB3231). Same dotnet and
 *  build line as ide.ps1's Build-Bridge. */
function buildBridges(cells: Cell[]): void {
	const projects = { codesys: "Volt.Ide.Codesys", twincat: "Volt.Ide.Twincat" }
	for (const vendor of new Set(cells.filter((c) => !c.refusal).map((c) => c.vendor))) {
		const proj = join(CLI, "src", projects[vendor], `${projects[vendor]}.csproj`)
		console.log(`building ${projects[vendor]} (Release) ...`)
		const r = spawnSync("C:\\Program Files\\dotnet\\dotnet.exe", ["build", proj, "-c", "Release", "--nologo", "-v", "quiet"], { encoding: "utf8" })
		if (r.status !== 0) { console.error(`✗ ${projects[vendor]} build failed - no cell can run:\n${r.stdout ?? ""}${r.stderr ?? ""}`); process.exit(1) }
	}
}

async function runCell(cell: Cell, tests: string): Promise<Verdict> {
	if (cell.refusal) return judge(cell, undefined, [])
	const log: string[] = []
	const reportFile = join(OUT, `${cell.id}.report.jsonl`)
	rmSync(reportFile, { force: true })
	let outcome: Outcome | undefined
	try {
		if (!(await ide("up", cell, log))) return { cell, green: false, why: "the IDE did not come up (see the cell log)" }
		const env = { ...process.env, VOLT_E2E_INSTANCE: instanceOf(cell), VOLT_VENDOR: cell.vendor, VOLT_GRAPHICAL: "1", VOLT_E2E_REPORT: reportFile }
		delete (env as Record<string, string | undefined>).VOLT_PIPE
		const r = await run("bun", ["test", tests], { cwd: CLI, env, timeout: 4 * 3600_000 })
		log.push(`── bun test ${tests} (exit ${r.status})`, r.text)
		outcome = parseSummary(r.text, r.status)
	} finally {
		await ide("down", cell, log)
		writeFileSync(join(OUT, `${cell.id}.log`), log.join("\n"))
	}
	const reports = existsSync(reportFile)
		? readFileSync(reportFile, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as Report)
		: []
	return judge(cell, outcome, reports)
}

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name)
	return i >= 0 ? process.argv[i + 1] : undefined
}

if (import.meta.main) {
	// `--verify <result.json> <sha>`: judge a recorded result for a commit and run nothing — what promote.yml runs on the
	// `release-matrix.json` attached to the release, and the same judgement release.ts makes (proofRefusal).
	const verify = arg("--verify")
	if (verify !== undefined) {
		const sha = process.argv[process.argv.indexOf("--verify") + 2]
		if (!sha || !/^[0-9a-f]{40}$/.test(sha)) { console.error("usage: release-matrix.ts --verify <result.json> <40-hex commit>"); process.exit(2) }
		if (!existsSync(verify)) { console.error(`✗ no release matrix result at ${verify}`); process.exit(1) }
		const why = proofRefusal(JSON.parse(readFileSync(verify, "utf8")), sha)
		if (why) { console.error(`✗ ${why}`); process.exit(1) }
		console.log(`✓ the release matrix ran green on ${sha}`)
		process.exit(0)
	}
	if (process.platform !== "win32") {
		console.error("release:matrix drives live Windows IDEs - Windows only")
		process.exit(1)
	}
	let cells = machineCells()
	if (process.argv.includes("--list")) {
		for (const c of cells) console.log(`${c.id.padEnd(24)} ${c.refusal ? `RED before running: ${c.refusal}` : c.fixture ?? "TwinCAT Project14"}`)
		process.exit(0)
	}
	const only = arg("--only")?.split(",")
	if (only) {
		const unknown = only.filter((id) => !cells.some((c) => c.id === id))
		if (unknown.length) { console.error(`no such cell on this machine: ${unknown.join(", ")} (see --list)`); process.exit(1) }
		cells = cells.filter((c) => only.includes(c.id))
	}
	const tests = arg("--tests") ?? "test/e2e"
	const partial = tests !== "test/e2e" || only !== undefined
	mkdirSync(OUT, { recursive: true })
	const jobs = Number(arg("--jobs") ?? 3)
	if (!Number.isInteger(jobs) || jobs < 1) { console.error(`--jobs must be a whole number >= 1, not ${arg("--jobs")}`); process.exit(1) }
	buildBridges(cells)
	// A pool of `jobs` workers over the cell list; verdicts keep the cells' order for the matrix.
	const verdicts: Verdict[] = new Array(cells.length)
	let next = 0
	await Promise.all(Array.from({ length: Math.min(jobs, cells.length) }, async () => {
		while (next < cells.length) {
			const i = next++
			console.log(`• ${cells[i].id} ...`)
			const v = await runCell(cells[i], tests)
			console.log(`  ${cells[i].id} ${v.green ? "green" : "RED"}: ${v.why}`)
			verdicts[i] = v
		}
	}))
	console.log("\n" + renderMatrix(verdicts))
	const green = verdicts.length > 0 && verdicts.every((v) => v.green)
	if (partial) {
		console.log(`\nPARTIAL (${only ? "--only" : ""}${only && tests !== "test/e2e" ? ", " : ""}${tests !== "test/e2e" ? `--tests ${tests}` : ""}) - not a release result; result.json untouched`)
		process.exit(green ? 0 : 1)
	}
	const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim()
	// Untracked files count: an untracked source file is built into what ran, and HEAD does not hold it (dirtyPaths).
	const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: REPO, encoding: "utf8" })
	if (status.status !== 0) throw new Error(`git status failed: ${status.stderr}`)
	const changed = dirtyPaths(status.stdout)
	const dirty = changed.length > 0
	writeFileSync(join(OUT, "result.json"), JSON.stringify({
		commit, dirty, green: green && !dirty, at: new Date().toISOString(),
		cells: verdicts.map((v) => ({ id: v.cell.id, green: v.green, why: v.why })),
	}, null, 2))
	if (dirty) console.log(`\nthe checkout differs from HEAD (${changed.slice(0, 10).join(", ")}${changed.length > 10 ? ", …" : ""}) - the result is recorded as NOT green (it tested no commit)`)
	process.exit(green && !dirty ? 0 : 1)
}
