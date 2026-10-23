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
 * <p>Per cell, besides the suite (whose `test/e2e/contract` is the OpenRPC contract suite, its answers in
 * `<cell>.contract.jsonl`): the WIRE TRANSCRIPT, recorded on the fresh fixture copy before the suite runs and compared
 * with the cell's committed reference `packages/volt-cli/test/transcripts/<cell>.jsonl` (`<cell>.transcript.jsonl`,
 * `<cell>.transcript.diff`; openspec volt-cli-rework 1.3). A transcript that differs, or a cell with no reference, is red
 * by name. One more cell, `mixed-version`, pairs the current CLI with the previous release's bridge and the reverse
 * (`packages/volt-cli/scripts/mixed-version.ts`, on CODESYS 3.5.21.40 64-bit; red by name where that cannot run). And
 * `vendor-parity` compares the two vendors with EACH OTHER — every other cell serves one, so `vendor-parity.test.ts` and
 * the cross-vendor half of `refusals/` skip there: it serves a CODESYS and a TwinCAT cell's IDE under one instance, runs
 * those suites alone, and is red when either skipped (`judgeParity`). No step is interactive and every result is a file
 * in `dist/release-matrix/`, so a self-hosted runner can run this unchanged.</p>
 *
 * <p>EVERY run, partial too, appends its record to `runs.jsonl` — the commit it tested, the paths that differed, why it
 * was partial, each cell's verdict — and every cell log opens with that commit, so a small matrix names its commit and
 * a red attempt stays on file beside its green rerun. A red cell whose IDE did not come up quotes `ide.ps1 up`'s own
 * words (an XAE's unanswered dialog with its message, an XAE that exited before a worker attached).</p>
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
 *   bun run release:matrix --record-transcripts         # write each cell's wire transcript AS its reference (never a result)
 *   bun scripts/release-matrix.ts --verify <result.json> <sha>   # judge a result for a commit (promote.yml)
 *
 * Long: a full cell is the whole e2e suite (tens of minutes). Cells run 3 at a time (`--jobs`), each on its own
 * `ide.ps1` instance — its own fixture copy and pipe, which the e2e harness alone talks to. More at once loads the
 * machine enough to push the latency test past its floors. Windows only.
 */
import { spawn, spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
	bridgeBuilds, codesysCells, dirtyPaths, judge, judgeParity, mixedVersionCell, PARITY_TESTS, parseSummary, proofRefusal, renderMatrix, runRecord,
	transcriptReference, twincatCells, upFailure, vendorParityCell, withTranscript, type Cell, type Outcome, type Report, type TranscriptOutcome, type Verdict,
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
	const codesys = codesysCells(listDir(programFiles("ProgramW6432")), listDir(programFiles("ProgramFiles(x86)")), fixtures)
	const twincat = twincatCells(xaeShellBits(), vsProxy64Registered())
	return [...codesys, ...twincat, vendorParityCell(codesys, twincat), mixedVersionCell(codesys)]
}

/** The current CLI, built ONCE before the pool when the mixed-version cell runs: the e2e cells run `volt.exe` from the
 *  same `bin\`, and must not see it rebuilt under them. */
function buildCurrentCli(): string {
	console.log("building Volt.Cli (Release) ...")
	const r = spawnSync("C:\\Program Files\\dotnet\\dotnet.exe", ["build", join(CLI, "src", "Volt.Cli", "Volt.Cli.csproj"), "-c", "Release", "--nologo", "-v", "quiet"], { encoding: "utf8" })
	if (r.status !== 0) { console.error(`✗ Volt.Cli build failed - the mixed-version cell cannot run:\n${r.stdout ?? ""}${r.stderr ?? ""}`); process.exit(1) }
	const exe = join(CLI, "src", "Volt.Cli", "bin", "Release", "net10.0", "volt.exe")
	if (!existsSync(exe)) { console.error(`✗ no ${exe} after the build`); process.exit(1) }
	return exe
}

/** The mixed-version cell: `packages/volt-cli/scripts/mixed-version.ts` on its own instances, judged by its exit and
 *  summary. Its files are `dist/release-matrix/mixed-version/` (result.json, mixed-version.log, the previous tree). */
async function runMixedCell(cell: Cell, currentCli: string): Promise<Verdict> {
	const out = join(OUT, "mixed-version")
	const r = await run("bun", [join("scripts", "mixed-version.ts"), "--instance-prefix", instanceOf(cell), "--out", out,
		"--codesys-version", cell.version!, "--bits", String(cell.bits), "--current-cli", currentCli, "--no-build-current"], { cwd: CLI, timeout: 2 * 3600_000 })
	writeFileSync(join(OUT, `${cell.id}.log`), `${HEADER}\n${r.text}`)
	const lines = r.text.split(/\r?\n/).filter((l) => /^(GREEN|RED)\s|^what the protocol check/.test(l))
	return { cell, green: r.status === 0, why: lines.length ? lines.join(" | ") : `mixed-version.ts exited ${r.status} (see the cell log)` }
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
const instanceOf = (cell: Cell): string => `${RUN}-${cell.id}`

/** THE RUN every cell's instance is in (openspec shared-ide-machine-rules): `ide.ps1` owns instance `release-matrix` and
 *  every `release-matrix-…` one for it, the mixed-version cell's included, and its `up` refuses to start beside any other
 *  IDE. `sweep` downs every instance of the run that has a record; `check` names what `up` would refuse. */
const RUN = "release-matrix"
function ideRun(verb: "sweep" | "check"): { status: number | null; text: string } {
	const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(CLI, "scripts", "ide.ps1"), verb,
		"-Vendor", "codesys", "-Instance", RUN, "-Run", RUN], { encoding: "utf8" })
	return { status: r.status, text: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() }
}

/** `ide.ps1 up|down` of `host` (a vendor cell) under `instance`; on a failed `up`, why - in ide.ps1's own words. */
async function ide(action: "up" | "down", host: Cell, instance: string, log: string[]): Promise<string | undefined> {
	const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(CLI, "scripts", "ide.ps1"), action,
		"-Vendor", host.vendor, "-Instance", instance]
	if (action === "up") {
		if (host.vendor === "codesys") args.push("-CodesysVersion", host.version!, "-CodesysBitness", String(host.bits), "-Fixture", join(FIXTURES, host.fixture!))
		else args.push("-Fixture", join(FIXTURES, host.fixture!), "-XaeBitness", String(host.bits))
		args.push("-Wait", "-NoBuild")   // built once, before the pool (buildBridges): cells at once share one bin\
	}
	const r = await run("powershell", args, { timeout: action === "up" ? 20 * 60_000 : 10 * 60_000 })
	log.push(`── ide.ps1 ${action} ${host.vendor} (exit ${r.status})`, r.text)
	return r.status === 0 ? undefined : upFailure(r.text)
}

/** The bridges every cell serves (`bridgeBuilds`), built ONCE before the cells start: each `ide.ps1 up` used to rebuild
 *  them into the same bin\, and three cells starting together failed on each other's locked output (MSB3231). Same
 *  dotnet and build line as ide.ps1's Build-Bridge: the TwinCAT worker per shell bitness, `-r <rid> --self-contained`. */
function buildBridges(cells: Cell[]): void {
	for (const b of bridgeBuilds(cells)) {
		const proj = join(CLI, "src", b.project, `${b.project}.csproj`)
		const rid = b.rid ? ["-r", b.rid, "--self-contained", "true"] : []
		console.log(`building ${b.project} (Release${b.rid ? ` ${b.rid}` : ""}) ...`)
		const r = spawnSync("C:\\Program Files\\dotnet\\dotnet.exe", ["build", proj, "-c", "Release", ...rid, "--nologo", "-v", "quiet"], { encoding: "utf8" })
		if (r.status !== 0) { console.error(`✗ ${b.project} build failed - no cell can run:\n${r.stdout ?? ""}${r.stderr ?? ""}`); process.exit(1) }
	}
}

/**
 * The cell's wire transcript (`packages/volt-cli/scripts/wire-transcript.ts`), recorded on the fresh fixture copy BEFORE
 * the suite touches it, then compared with the cell's committed reference — or, with `--record-transcripts`, written AS
 * that reference. Every file it makes is the cell's: `<cell>.transcript.jsonl` and `<cell>.transcript.diff`.
 */
async function transcript(cell: Cell, env: NodeJS.ProcessEnv, record: boolean, log: string[]): Promise<TranscriptOutcome> {
	const recorded = join(OUT, `${cell.id}.transcript.jsonl`)
	const reference = transcriptReference(cell)
	const tool = join("scripts", "wire-transcript.ts")
	const rec = await run("bun", [tool, "record", "--vendor", cell.vendor, "--instance", instanceOf(cell), "--out", record ? join(CLI, reference) : recorded],
		{ cwd: CLI, env, timeout: 60 * 60_000 })
	log.push(`── wire-transcript record (exit ${rec.status})`, rec.text)
	if (rec.status !== 0) return { kind: "failed", why: `the scenario exited ${rec.status} (see the cell log)` }
	if (record) return { kind: "recorded", reference }
	const diff = join(OUT, `${cell.id}.transcript.diff`)
	const cmp = await run("bun", [tool, "compare", "--reference", join(CLI, reference), "--run", recorded, "--diff", diff], { cwd: CLI, env, timeout: 10 * 60_000 })
	log.push(`── wire-transcript compare (exit ${cmp.status})`, cmp.text)
	if (cmp.status === 0) return { kind: "identical" }
	if (cmp.status === 2) return { kind: "no-reference", reference }
	if (cmp.status === 1) return { kind: "differs", steps: Number(/^(\d+) step\(s\) differ/m.exec(cmp.text)?.[1] ?? NaN) }
	return { kind: "failed", why: `the comparer exited ${cmp.status}` }
}

/** The vendor-parity cell: CODESYS and TwinCAT up under ONE instance, and only the suites that compare them
 *  ({@link PARITY_TESTS}) - red when either compared one vendor with nothing (judgeParity). */
async function runParityCell(cell: Cell): Promise<Verdict> {
	const log: string[] = [HEADER]
	const hosts = [cell.parity!.codesys, cell.parity!.twincat]
	let outcome: Outcome | undefined
	let text = ""
	try {
		for (const host of hosts) {
			const down = await ide("up", host, instanceOf(cell), log)
			if (down) return { cell, green: false, why: `${host.vendor}: ${down}` }
		}
		const env = { ...process.env, VOLT_E2E_INSTANCE: instanceOf(cell) }
		for (const k of ["VOLT_PIPE", "VOLT_VENDOR", "VOLT_PIPE_CODESYS", "VOLT_PIPE_TWINCAT"]) delete (env as Record<string, string | undefined>)[k]
		const r = await run("bun", ["test", ...PARITY_TESTS], { cwd: CLI, env, timeout: 2 * 3600_000 })
		log.push(`── bun test ${PARITY_TESTS.join(" ")} (exit ${r.status})`, r.text)
		text = r.text
		outcome = parseSummary(r.text, r.status)
	} finally {
		for (const host of [...hosts].reverse()) await ide("down", host, instanceOf(cell), log)
		writeFileSync(join(OUT, `${cell.id}.log`), log.join("\n"))
	}
	return judgeParity(cell, outcome, text)
}

async function runCell(cell: Cell, tests: string, recordTranscripts: boolean, currentCli: () => string): Promise<Verdict> {
	if (cell.refusal) return judge(cell, undefined, [])
	if (cell.mixed) return runMixedCell(cell, currentCli())
	if (cell.parity) return runParityCell(cell)
	const log: string[] = [HEADER]
	const reportFile = join(OUT, `${cell.id}.report.jsonl`)
	const contractFile = join(OUT, `${cell.id}.contract.jsonl`)
	for (const f of [reportFile, contractFile, join(OUT, `${cell.id}.transcript.jsonl`), join(OUT, `${cell.id}.transcript.diff`)]) rmSync(f, { force: true })
	let outcome: Outcome | undefined
	let wire: TranscriptOutcome | undefined
	try {
		const down = await ide("up", cell, instanceOf(cell), log)
		if (down) return { cell, green: false, why: down }
		const env = { ...process.env, VOLT_E2E_INSTANCE: instanceOf(cell), VOLT_VENDOR: cell.vendor, VOLT_GRAPHICAL: "1", VOLT_E2E_REPORT: reportFile, VOLT_CONTRACT_REPORT: contractFile }
		delete (env as Record<string, string | undefined>).VOLT_PIPE
		wire = await transcript(cell, env, recordTranscripts, log)
		// The contract suite (test/e2e/contract) is part of test/e2e: it runs in every cell, its answers in <cell>.contract.jsonl.
		const r = await run("bun", ["test", tests], { cwd: CLI, env, timeout: 4 * 3600_000 })
		log.push(`── bun test ${tests} (exit ${r.status})`, r.text)
		outcome = parseSummary(r.text, r.status)
	} finally {
		await ide("down", cell, instanceOf(cell), log)
		writeFileSync(join(OUT, `${cell.id}.log`), log.join("\n"))
	}
	const reports = existsSync(reportFile)
		? readFileSync(reportFile, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as Report)
		: []
	return withTranscript(judge(cell, outcome, reports), wire)
}

/** What every cell log starts with: the commit the run tested, and whether the checkout was that commit (`runs.jsonl`
 *  holds the same, per run). Set once, before the pool. */
let HEADER = ""
function checkout(): { commit: string; changed: string[] } {
	const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim()
	// Untracked files count: an untracked source file is built into what ran, and HEAD does not hold it (dirtyPaths).
	const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: REPO, encoding: "utf8" })
	if (status.status !== 0 || !commit) throw new Error(`git rev-parse/status failed: ${status.stderr}`)
	return { commit, changed: dirtyPaths(status.stdout) }
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
		for (const c of cells) console.log(`${c.id.padEnd(24)} ${c.refusal ? `RED before running: ${c.refusal}` : c.parity ? `${c.parity.codesys.id} + ${c.parity.twincat.id} on one instance (${c.parity.codesys.fixture}, ${c.parity.twincat.fixture})` : c.fixture}`)
		process.exit(0)
	}
	const only = arg("--only")?.split(",")
	if (only) {
		const unknown = only.filter((id) => !cells.some((c) => c.id === id))
		if (unknown.length) { console.error(`no such cell on this machine: ${unknown.join(", ")} (see --list)`); process.exit(1) }
		cells = cells.filter((c) => only.includes(c.id))
	}
	const tests = arg("--tests") ?? "test/e2e"
	const recordTranscripts = process.argv.includes("--record-transcripts")
	const partial = tests !== "test/e2e" || only !== undefined || recordTranscripts
	const partialWhy = partial
		? [only ? `--only ${only.join(",")}` : "", tests !== "test/e2e" ? `--tests ${tests}` : "", recordTranscripts ? "--record-transcripts" : ""].filter(Boolean).join(", ")
		: null
	mkdirSync(OUT, { recursive: true })
	// The checkout BEFORE anything is built: what every cell log names, and what the run's record says it tested.
	const tested = checkout()
	const startedAt = new Date().toISOString()
	HEADER = `release matrix run of ${tested.commit}${tested.changed.length ? ` with ${tested.changed.length} changed path(s) (${tested.changed.slice(0, 10).join(", ")})` : ""}, started ${startedAt}${partialWhy ? ` - PARTIAL (${partialWhy})` : ""}`
	const jobs = Number(arg("--jobs") ?? 3)
	if (!Number.isInteger(jobs) || jobs < 1) { console.error(`--jobs must be a whole number >= 1, not ${arg("--jobs")}`); process.exit(1) }
	// THE MACHINE FIRST: every IDE of this run a killed earlier run left is closed (no exit hook ran for it), then the run
	// starts only beside no IDE it does not own — refused once, by name, instead of red cell by cell. Every exit from here
	// closes the run's IDEs again: a signal through its handler, a normal end through the sweep after the pool.
	process.env.VOLT_IDE_RUN = RUN
	for (const step of ["sweep", "check"] as const) {
		const r = ideRun(step)
		if (r.status !== 0) { console.error(r.text); process.exit(1) }
	}
	for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
		process.once(sig, () => { console.error(`\n${sig}: closing this run's IDEs`); console.error(ideRun("sweep").text); process.exit(130) })
	buildBridges(cells)
	const currentCli = cells.some((c) => c.mixed && !c.refusal) ? buildCurrentCli() : ""
	// A pool of `jobs` workers over the cell list; verdicts keep the cells' order for the matrix.
	const verdicts: Verdict[] = new Array(cells.length)
	let next = 0
	await Promise.all(Array.from({ length: Math.min(jobs, cells.length) }, async () => {
		while (next < cells.length) {
			const i = next++
			console.log(`• ${cells[i].id} ...`)
			const v = await runCell(cells[i], tests, recordTranscripts, () => currentCli)
			console.log(`  ${cells[i].id} ${v.green ? "green" : "RED"}: ${v.why}`)
			verdicts[i] = v
		}
	}))
	// A cell whose own `down` failed (or was cut by its timeout) leaves nothing behind either.
	const swept = ideRun("sweep")
	if (swept.status !== 0) console.error(`closing this run's IDEs failed:\n${swept.text}`)
	console.log("\n" + renderMatrix(verdicts))
	const green = verdicts.length > 0 && verdicts.every((v) => v.green)
	// The checkout again at the END: a commit or an edit during the run means it tested neither state.
	const after = checkout()
	const changed = after.commit === tested.commit
		? [...new Set([...tested.changed, ...after.changed])]
		: [...tested.changed, `HEAD moved to ${after.commit} during the run`]
	const record = runRecord(tested.commit, changed, startedAt, partialWhy, verdicts)
	// EVERY run, partial or not, red or green, appends its record: a red attempt stays on file beside its green rerun.
	appendFileSync(join(OUT, "runs.jsonl"), JSON.stringify(record) + "\n")
	if (partial) {
		console.log(`\nPARTIAL (${partialWhy}) - not a release result; result.json untouched; recorded in runs.jsonl for ${tested.commit}`)
		process.exit(green ? 0 : 1)
	}
	writeFileSync(join(OUT, "result.json"), JSON.stringify(record, null, 2))
	if (record.dirty) console.log(`\nthe checkout differs from HEAD (${changed.slice(0, 10).join(", ")}${changed.length > 10 ? ", …" : ""}) - the result is recorded as NOT green (it tested no commit)`)
	process.exit(record.green ? 0 : 1)
}
