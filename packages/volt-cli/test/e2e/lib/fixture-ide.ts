/**
 * WHICH IDE THE SUITE MAY TOUCH — only one `scripts/ide.ps1` started on a FIXTURE COPY. Never an engineer's own.
 *
 * <p>The suite creates and deletes `VltE2E_*` items. It used to find its bridge by PREFIX — every
 * `volt.bridge.<vendor>.<pid>` on the machine — and take the first. With several IDEs open that is whichever pid
 * sorts first, and on 2026-10-03 `vendor-parity` created and deleted `VltE2E_par_*` items in an 881-item project that
 * was nobody's fixture. A prefix cannot tell a fixture from a customer project; the launcher's own record can.</p>
 *
 * <p>So a pipe is ours only when it is provably served by an IDE `ide.ps1 up` launched for an INSTANCE:</p>
 * <ul>
 *   <li>the pipe's pid is a process the instance's pid file records (same pid AND same start time), or a child of
 *       one (CODESYS re-execs during startup) — the exact rule `ide.ps1`'s own `Test-Ours` uses to decide what its
 *       `down` may close;</li>
 *   <li>every project that `up` opened (its `.projects` file) lies under that instance's copy root,
 *       `%TEMP%\volt-ide-<vendor>[-<instance>]\` — an `-InPlace` run serves the committed tree, which is not a copy;</li>
 *   <li>for TwinCAT, the XAE's own command line names a `.sln` under that copy root (CODESYS's command line carries no
 *       project — `ide.ps1` hands it over in the environment — so there the record is the evidence).</li>
 * </ul>
 *
 * <p>Two ways in, and nothing else: <code>VOLT_E2E_INSTANCE</code> (unset = the default instance, `ide.ps1 up` with no
 * `-Instance`) resolves that instance's pipe; an explicit exact <code>VOLT_PIPE</code> is accepted only if SOME
 * instance proves it, as above. Anything else is refused, naming the pipes it will not touch and what they serve.</p>
 *
 * <p>{@link resolveFixturePipes} is PURE (facts in, pipes or a refusal out) so the rule is unit-tested without an IDE
 * (`test/unit/fixture-ide.test.ts`); {@link gatherFacts} is the one place that reads the machine.</p>
 *
 * <p><b>The ONE implementation of the rule, for everything that drives a bridge from this checkout</b> — the e2e suite,
 * the volt-cli probes and `corpus-migration.ts`, and the LSP recorders (`volt-lsp-iec/scripts/bridge.ts` imports it
 * across the package boundary). A run drives exactly ONE pipe: {@link resolveOnePipe} narrows the instance's pipes to
 * one and refuses several (TwinCAT's `-Fixture both` serves two) — for a script ({@link scriptPipe}) and the e2e suite
 * (`pipe.ts`) alike. A PowerShell script asks the same code through the CLI
 * below — `bun test/e2e/lib/fixture-ide.ts <vendor> [instance]` prints the pipe or exits 1 with the refusal — rather
 * than carrying a second copy of it.</p>
 */
import { win32 } from "node:path"
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"

export type Vendor = "codesys" | "twincat"

/** One process, as CIM reports it. `ticks` is the start time in .NET UTC ticks, kept as a string: it exceeds 2^53. */
export type Proc = { pid: number; ppid: number; ticks?: string; name?: string; commandLine?: string; title?: string }

/** One `ide.ps1` instance's record: `%LOCALAPPDATA%\volt-bridge\<vendor>-ide[-<instance>].pids` + `.projects`. */
export type InstanceRecord = {
	instance: string
	records: { pid: number; ticks: string }[]
	projects: string[]
}

export type Facts = {
	vendor: Vendor
	/** The machine's live pipe names (the whole namespace, or at least every `volt.bridge.*`). */
	pipes: string[]
	procs: Map<number, Proc>
	instances: InstanceRecord[]
	/** The system temp dir the copy roots live under. */
	tempDir: string
}

export class FixtureRefusal extends Error {}

const label = (instance: string) => (instance ? `'${instance}'` : "(default)")

/** `%TEMP%\volt-ide-<vendor>[-<instance>]\` — `ide.ps1`'s Get-CopyRoot, WITH the separator so the default
 *  instance's root is never a prefix of another instance's. */
export function copyRoot(tempDir: string, vendor: Vendor, instance: string): string {
	return win32.join(tempDir, `volt-ide-${vendor}${instance ? `-${instance}` : ""}`) + "\\"
}

const norm = (p: string) => win32.normalize(p.replace(/^"|"$/g, "")).toLowerCase()
const under = (path: string, root: string) => norm(path).startsWith(norm(root))

/** The pid a bridge pipe is named after, or undefined for a name that is not `volt.bridge.<vendor>.<pid>`. */
export function pipePid(pipe: string, vendor: Vendor): number | undefined {
	const m = new RegExp(`^volt\\.bridge\\.${vendor}\\.(\\d+)$`).exec(pipe)
	return m ? Number(m[1]) : undefined
}

/** `ide.ps1`'s Test-Ours: the process is one `up` recorded (same pid and start), or a recorded process STARTED it
 *  (the child no older than the parent, so a reused parent pid is not mistaken for ours), walking up through parents
 *  that are still alive. */
export function isRecorded(pid: number, inst: InstanceRecord, procs: Map<number, Proc>): boolean {
	let cur = pid
	for (let depth = 0; depth < 4; depth++) {
		const p = procs.get(cur)
		if (!p) return false
		for (const r of inst.records) {
			if (depth === 0 && r.pid === cur && r.ticks === p.ticks) return true
			if (r.pid === p.ppid && p.ticks !== undefined && BigInt(r.ticks) <= BigInt(p.ticks)) return true
		}
		cur = p.ppid
		if (cur <= 0) return false
	}
	return false
}

/** Why `pipe` is not this instance's fixture IDE, or null when it is. */
function whyNotOurs(facts: Facts, inst: InstanceRecord, pipe: string): string | null {
	const pid = pipePid(pipe, facts.vendor)
	if (pid === undefined) return `'${pipe}' is not a volt.bridge.${facts.vendor}.<pid> pipe`
	if (!isRecorded(pid, inst, facts.procs)) return `pid ${pid} was not started by ide.ps1 instance ${label(inst.instance)}`
	const root = copyRoot(facts.tempDir, facts.vendor, inst.instance)
	if (inst.projects.length === 0) return `instance ${label(inst.instance)} recorded no project it opened`
	const outside = inst.projects.filter((p) => !under(p, root))
	if (outside.length > 0) return `instance ${label(inst.instance)} opened ${outside.join(", ")}, not a copy under ${root}`
	if (facts.vendor === "twincat") {
		const cmd = facts.procs.get(pid)?.commandLine ?? ""
		const sln = /"([^"]+\.sln)"/i.exec(cmd)?.[1]
		if (!sln || !under(sln, root)) return `XAE ${pid} is not open on a solution under ${root} (command line: ${cmd || "unreadable"})`
	}
	return null
}

/** What a pipe serves, for a refusal message — from its process's window title, never by calling the pipe. */
function describePipe(facts: Facts, pipe: string): string {
	const pid = pipePid(pipe, facts.vendor)
	const p = pid === undefined ? undefined : facts.procs.get(pid)
	const sln = p?.commandLine ? /"([^"]+\.sln)"/i.exec(p.commandLine)?.[1] : undefined
	return `${pipe} (project ${sln ?? (p?.title || "unknown")})`
}

/** A named pipe that is not ONE exact `volt.bridge.<vendor>.<pid>` is refused by its spelling alone — decided before
 *  the machine is read, so the refusal never waits on the process table (a PowerShell CIM query, seconds when loaded). */
function refuseUnspelledPipe(pipe: string, vendor: Vendor): void {
	if (pipePid(pipe, vendor) === undefined)
		throw new FixtureRefusal(
			`refusing VOLT_PIPE='${pipe}': it must name ONE exact volt.bridge.${vendor}.<pid> pipe — a prefix is ` +
				`discovery, and discovery is how the suite once wrote into a project that was not a fixture`,
		)
}

/**
 * The fixture pipes the suite may drive, sorted — or a {@link FixtureRefusal} saying which pipes it refuses and why.
 *
 * @param opts.instance the `ide.ps1 -Instance` to resolve ("" = the default instance)
 * @param opts.explicit an exact pipe name the caller named (`VOLT_PIPE`); accepted only if an instance proves it
 */
export function resolveFixturePipes(facts: Facts, opts: { instance: string; explicit?: string }): string[] {
	const live = facts.pipes.filter((n) => pipePid(n, facts.vendor) !== undefined).sort()
	if (opts.explicit) {
		const pipe = opts.explicit
		refuseUnspelledPipe(pipe, facts.vendor)
		if (!facts.pipes.includes(pipe)) throw new FixtureRefusal(`VOLT_PIPE='${pipe}' is not a live pipe`)
		const reasons: string[] = []
		for (const inst of facts.instances) {
			const why = whyNotOurs(facts, inst, pipe)
			if (why === null) return [pipe]
			reasons.push(why)
		}
		throw new FixtureRefusal(
			`refusing to touch ${describePipe(facts, pipe)}: no ide.ps1 fixture instance owns it` +
				(reasons.length ? ` (${reasons.join("; ")})` : " (no ide.ps1 instance is recorded at all)"),
		)
	}
	const inst = facts.instances.find((i) => i.instance === opts.instance)
	const foreign = live.map((p) => describePipe(facts, p)).join(", ") || "none"
	if (!inst)
		throw new FixtureRefusal(
			`no fixture IDE for instance ${label(opts.instance)} (${facts.vendor}): ide.ps1 has no record of one — start it ` +
				`with \`pwsh scripts/ide.ps1 up -Vendor ${facts.vendor}${opts.instance ? ` -Instance ${opts.instance}` : ""} -Wait\`. ` +
				`Refusing to touch pipe(s): ${foreign}`,
		)
	const ours: string[] = []
	const reasons: string[] = []
	for (const pipe of live) {
		const why = whyNotOurs(facts, inst, pipe)
		if (why === null) ours.push(pipe)
		else reasons.push(`${describePipe(facts, pipe)}: ${why}`)
	}
	if (ours.length === 0)
		throw new FixtureRefusal(
			`no fixture IDE for instance ${label(opts.instance)} (${facts.vendor}) is serving; refusing to touch pipe(s): ` +
				(reasons.join("; ") || "none live"),
		)
	return ours
}

/**
 * THE ONE pipe a run drives — {@link resolveFixturePipes} narrowed to exactly one. Several pipes owned by the instance
 * are refused too, not "the first": `ide.ps1 up -Vendor twincat -Fixture both` opens Project13 (x64) AND Project14
 * (ARM, 32-bit) — it was the default until 2026-10-16 — and a recorder that took whichever pid sorted first recorded
 * the wrong target, as the e2e suite drove the wrong project (`pipe.ts` onePipe).
 */
export function resolveOnePipe(facts: Facts, opts: { instance: string; explicit?: string }): string {
	const pipes = resolveFixturePipes(facts, opts)
	if (pipes.length === 1) return pipes[0]!
	throw new FixtureRefusal(
		`instance ${label(opts.instance)} (${facts.vendor}) serves ${pipes.length} fixture pipes ` +
			`(${pipes.map((p) => describePipe(facts, p)).join(", ")}) and a run drives ONE: name it with VOLT_PIPE ` +
			`(verified the same way), or serve one project (\`-Fixture 13\` or \`-Fixture 14\`)`,
	)
}

/**
 * The IDE process's bitness from its module names as a 64-BIT reader lists them: a WOW64 (32-bit) process carries
 * `wow64.dll`, a 64-bit process never does (DIALECT V5 measured the 64-bit view of the 32-bit TcXaeShell: only the
 * WOW64 layer). An empty list is no answer — refused, never read as either.
 */
export function bitnessOf(modules: string[]): 32 | 64 {
	if (modules.length === 0) throw new FixtureRefusal("the IDE process listed no modules, so its bitness is unknown")
	return modules.some((m) => m.toLowerCase() === "wow64.dll") ? 32 : 64
}

/** The bitness of the process serving `pipe` (`volt.bridge.<vendor>.<pid>`: the IDE's own pid on both vendors). */
export function pipeBitness(pipe: string, vendor: Vendor): 32 | 64 {
	const pid = pipePid(pipe, vendor)
	if (pid === undefined) throw new FixtureRefusal(`'${pipe}' names no pid`)
	const script =
		"if (-not [Environment]::Is64BitProcess) { [Console]::Error.WriteLine('a 32-bit reader cannot see a 64-bit process'); exit 3 }; " +
		`(Get-Process -Id ${pid} -ErrorAction Stop).Modules | ForEach-Object { $_.ModuleName }`
	const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 60_000 })
	if (r.status !== 0) throw new FixtureRefusal(`could not read the modules of pid ${pid}: ${r.stderr || r.error}`)
	return bitnessOf(r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
}

/** The IDE facts a run reports, as `health` states them. */
type IdeHealth = { productName?: string | null; productVersion?: string | null; ideVersion?: string | null }
const IDE_FACTS = ["productName", "productVersion", "ideVersion"] as const

/**
 * What a run drove, for `VOLT_E2E_REPORT` (the release matrix judges each cell by it). Every fact is required: one
 * that `health` does not state, or a bitness that could not be read (passed as the refusal), is refused by name —
 * never written as null, which would read as "some IDE" in a matrix cell.
 */
export function e2eReport(vendor: Vendor, project: string, pipe: string, health: IdeHealth, bits: 32 | 64 | FixtureRefusal) {
	if (bits instanceof FixtureRefusal) throw new FixtureRefusal(`cannot report the IDE's bitness: ${bits.message}`)
	const missing = IDE_FACTS.filter((k) => typeof health[k] !== "string" || health[k] === "")
	if (missing.length > 0) throw new FixtureRefusal(`cannot report the IDE: health states no ${missing.join(", ")}`)
	return { vendor, project, pipe, bits, productName: health.productName!, productVersion: health.productVersion!, ideVersion: health.ideVersion! }
}

/** The console's one line about the IDE: what health states and the bitness, a missing or unreadable fact NAMED. */
export function ideLine(health: IdeHealth, bits: 32 | 64 | FixtureRefusal): string {
	const missing = IDE_FACTS.filter((k) => typeof health[k] !== "string" || health[k] === "")
	const stated = [health.productName, health.productVersion].filter((x): x is string => typeof x === "string" && x !== "").join(" ")
	const parts = [stated || undefined, missing.includes("ideVersion") ? undefined : `platform ${health.ideVersion}`]
		.filter((x): x is string => x !== undefined)
	if (missing.length > 0) parts.push(`health states no ${missing.join(", ")}`)
	return parts.join(", ") + (bits instanceof FixtureRefusal ? `; bitness unreadable (${bits.message})` : `, ${bits}-bit`)
}

/**
 * The environment for a Windows PowerShell child that calls `Add-Type`: its csc (.NET Framework) cannot write into a
 * folder the ANSI code page cannot spell — measured 2026-10-13 with TEMP under `volt-Тест-Юникод` on a code-page-1252
 * machine: "cannot write to the output file … the directory name is invalid" (environment-dependency-audit 2.5). So the
 * child compiles in an ASCII TEMP; everything else keeps the caller's. Same rule as `ide.ps1`'s Get-CompileTemp.
 */
export function compileTempEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const temp = env.TEMP ?? env.TMP ?? tmpdir()
	if (/^[\x20-\x7e]*$/.test(temp)) return env
	const alt = win32.join(env.ProgramData ?? "C:\\ProgramData", "volt-ide-compile")
	if (!/^[\x20-\x7e]*$/.test(alt)) throw new FixtureRefusal(`no ASCII folder for Add-Type to compile in (TEMP ${temp}, ${alt})`)
	mkdirSync(alt, { recursive: true })
	return { ...env, TEMP: alt, TMP: alt }
}

// ── reading the machine ─────────────────────────────────────────────────────────────────────────────────────────

/** `%LOCALAPPDATA%\volt-bridge`, where `ide.ps1` keeps its per-instance records. */
function workDir(): string {
	const base = process.env.LOCALAPPDATA
	if (!base) throw new FixtureRefusal("LOCALAPPDATA is not set, so ide.ps1's instance records cannot be read")
	return win32.join(base, "volt-bridge")
}

/** One `.pids` file's records. Lines are `<pid> <start ticks>`; anything else — a bare `<pid>` included — is skipped,
 *  exactly as `ide.ps1`'s Read-Records skips it: a pid with no start time names whatever later reuses the number (as a
 *  recorded PARENT it claimed another session's IDE, ld-fbd-coverage gate 2R.3). */
export function parseRecords(text: string): InstanceRecord["records"] {
	return text
		.split(/\r?\n/)
		.map((l) => l.trim().split(/\s+/))
		.filter((x) => /^\d+$/.test(x[0] ?? "") && /^\d+$/.test(x[1] ?? ""))
		.map((x) => ({ pid: Number(x[0]), ticks: x[1]! }))
}

/** Every `ide.ps1` instance of a vendor that has a record (`parseRecords`). */
export function readInstances(vendor: Vendor): InstanceRecord[] {
	const dir = workDir()
	if (!existsSync(dir)) return []
	const out: InstanceRecord[] = []
	for (const f of readdirSync(dir)) {
		const m = new RegExp(`^${vendor}-ide(?:-(.+))?\\.pids$`).exec(f)
		if (!m) continue
		const records = parseRecords(readFileSync(win32.join(dir, f), "utf8"))
		const projFile = win32.join(dir, f.replace(/\.pids$/, ".projects"))
		const projects = existsSync(projFile)
			? readFileSync(projFile, "utf8").replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
			: []
		out.push({ instance: m[1] ?? "", records, projects })
	}
	return out
}

/** The process table, in ONE PowerShell call (CIM: Bun has no process-tree API): pid, parent, start ticks, and —
 *  for the IDE processes only — the command line and window title a refusal names. */
export function readProcs(): Map<number, Proc> {
	const script =
		"$t=@{}; Get-Process CODESYS,TcXaeShell -ErrorAction SilentlyContinue | % { $t[$_.Id]=$_.MainWindowTitle }; " +
		"@(Get-CimInstance Win32_Process | % { $ide = $_.Name -in 'CODESYS.exe','TcXaeShell.exe'; [pscustomobject]@{ " +
		"pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId; " +
		"ticks=$(if ($_.CreationDate) { [string]$_.CreationDate.ToUniversalTime().Ticks }); name=$_.Name; " +
		"commandLine=$(if ($ide) { $_.CommandLine }); title=$(if ($ide) { $t[[int]$_.ProcessId] }) } }) | ConvertTo-Json -Compress"
	const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		timeout: 60_000,
	})
	if (r.status !== 0 || !r.stdout?.trim()) throw new FixtureRefusal(`could not read the process table: ${r.stderr || r.error}`)
	const rows = JSON.parse(r.stdout) as Proc[]
	const procs = new Map<number, Proc>()
	for (const p of rows) procs.set(p.pid, { ...p, ticks: p.ticks ?? undefined, commandLine: p.commandLine ?? undefined, title: p.title ?? undefined })
	return procs
}

export function livePipeNames(): string[] {
	try {
		return readdirSync("\\\\.\\pipe\\").filter((n) => n.startsWith("volt.bridge."))
	} catch {
		return []
	}
}

export function gatherFacts(vendor: Vendor): Facts {
	return { vendor, pipes: livePipeNames(), procs: readProcs(), instances: readInstances(vendor), tempDir: tmpdir() }
}

/** The instance a run targets: `VOLT_E2E_INSTANCE`, else the default instance. */
export const E2E_INSTANCE = process.env.VOLT_E2E_INSTANCE ?? ""

/** Resolve against the live machine. Throws {@link FixtureRefusal}. */
export function fixturePipesFor(vendor: Vendor, explicit?: string, instance = E2E_INSTANCE): string[] {
	if (explicit) refuseUnspelledPipe(explicit, vendor)
	return resolveFixturePipes(gatherFacts(vendor), { instance, explicit: explicit || undefined })
}

/**
 * The one pipe a SCRIPT may drive, against the live machine: `VOLT_PIPE` when set (verified — an instance must own it),
 * else the `VOLT_E2E_INSTANCE` instance's one pipe. Throws {@link FixtureRefusal} naming the pipes and projects it will
 * not touch. Probes, `corpus-migration.ts` and the LSP recorders all come through here.
 */
export function scriptPipe(vendor: Vendor, explicit = process.env.VOLT_PIPE, instance = E2E_INSTANCE): string {
	if (explicit) refuseUnspelledPipe(explicit, vendor)
	return resolveOnePipe(gatherFacts(vendor), { instance, explicit: explicit || undefined })
}

/** The vendor a script names, refusing anything else (a typo must not become a default). */
export function vendorOf(value: string | undefined, fallback: Vendor = "codesys"): Vendor {
	const v = value || fallback
	if (v !== "codesys" && v !== "twincat") throw new FixtureRefusal(`unknown vendor '${v}' (codesys | twincat)`)
	return v
}

// The CLI for PowerShell callers (a script that cannot import TypeScript): print the one pipe, or the refusal and exit 1.
if (import.meta.main) {
	const [vendor, instance] = process.argv.slice(2)
	try {
		console.log(scriptPipe(vendorOf(vendor), process.env.VOLT_PIPE, instance ?? E2E_INSTANCE))
	} catch (e) {
		console.error((e as Error).message)
		process.exit(1)
	}
}
