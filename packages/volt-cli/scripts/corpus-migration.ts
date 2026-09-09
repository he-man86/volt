/**
 * CORPUS MIGRATION — a GAP FINDER, not a gate.
 *
 * It pushes a real customer project into an EMPTY one and materializes the result back, so every item is a
 * CREATE: folders, kinds, children, graphical bodies, the lot. `test/e2e/whole-project.test.ts` pushes a
 * project's own bytes back over ITSELF and therefore only ever exercises the UPDATE path; this finds what that
 * cannot. It is also the operation a user actually performs — migrating a machine builder's project into a
 * fresh one — which is why the oracle is a real project rather than a shape Volt authored.
 *
 * **Nothing here is a permanent test.** The corpora are big, slow and live outside `volt-cli`, and running them
 * proves nothing on a build agent. Their job is to SURFACE gaps; every gap this finds gets a dedicated,
 * offline test in `volt-cli` that fails without the fix, and THAT is the standing coverage. The first run
 * produced `Volt.Engine.Tests/sync/CreateUnauthorableBodyTests.cs` — the create path wrote a CFC/SFC body
 * marker as if it were source and landed an EMPTY function block, with the push reporting success.
 *
 * WHAT IS COMPARED. Writable items only (`SOURCE_EXTENSIONS`, `.task`, folder markers), because that is all a push may
 * carry: library signatures, device/task descriptors and project settings belong to the TARGET project, and a
 * blank one legitimately has different ones. Paths are normalized on the device-root segment (`Device` in every
 * corpus, `PLCWinNT` in the CODESYS blank template) so the comparison is about structure, not about what the
 * target's controller happens to be called.
 *
 * WHAT IS NOT MIGRATABLE, AND WHY THAT IS NOT A FINDING. A CFC/SFC/IL body has no text form at all — its file
 * carries a `(* @volt-graphical: LANG *)` marker instead of source — so there is nothing to create it FROM.
 * Those are counted and reported, never staged; pushing one is refused by `BodyFormatGuard`.
 *
 * RUNNING IT. It owns the IDE lifecycle: a throwaway blank project is opened per corpus and closed again, so no
 * bridge should be running when it starts.
 *
 *   bun run scripts/corpus-migration.ts                 # every corpus
 *   bun run scripts/corpus-migration.ts pro2193         # one
 *
 * Budget ~5-20 min per corpus; pro2193 and lenze-mid are ~8k items each. Exits non-zero when anything drifted.
 */
import { execFileSync } from "node:child_process"
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, sep } from "node:path"
import { SOURCE_EXTENSIONS } from "@volt/control"
// The e2e harness owns the pipe framing; importing it keeps ONE client rather than a second copy of the wire.
import { callOn } from "../test/e2e/lib/pipe"

const REPO = join(import.meta.dir, "..", "..", "..")
const VOLT = join(REPO, "packages", "volt-cli", "src", "Volt.Cli", "bin", "Release", "net10.0", "volt.exe")
const CORPUS_ROOT = join(REPO, "packages", "volt-lsp-iec", "test-corpus")
const LAUNCHER = join(import.meta.dir, "ide.ps1")
/** The pipe THIS run launched. Every `volt` call is pinned to it, so a stray IDE cannot be used. */
let activePipe: string | undefined


/** A referenced library's files carry SOURCE extensions but are read-only by LOCATION — the push refuses them
 *  and the blank target has different libraries anyway. Excluded by folder, exactly as the CLI does.
 *  Each vendor names that folder itself: `Library Manager` on CODESYS, `References` on TwinCAT. */
const LIBRARY_DIRS = new Set(["Library Manager", "References"])
const FOLDER_MARKER = ".gitkeep"
/** A body with no text form — CFC, SFC, IL. The file carries this instead of source. */
const BODY_MARKER = "(* @volt-graphical:"

const VENDOR = process.env.VOLT_VENDOR ?? "codesys"

// ── vendor lifecycle: open a BLANK project, serve it, close it ────────────────────────────────────────────

interface Blank {
	/** Opens a throwaway empty project and resolves once its pipe is SERVING a project. */
	open(label: string): Promise<void>
	close(): void
}

const CODESYS: Blank = {
	async open(label) {
		// A COPY of the shipped template, per corpus — never a committed fixture, and never twice over the same
		// file: the point is that the target starts empty every single time.
		const scratch = mkdtempSync(join(tmpdir(), `volt-blank-${label}-`))
		const project = join(scratch, "Blank.project")
		copyFileSync(join(codesysInstall(), "CODESYS", "Templates", "Standard.project"), project)
		// `-NoBuild` because `buildToolchain()` already did it, ONCE, before the first IDE started — the launcher's
		// own rebuild cannot run while a previous corpus's CODESYS still holds the DLL, and rebuilding per corpus
		// would be four wasted builds. Never drop the up-front build: `PushService` lives in Volt.Engine, which
		// ships INSIDE the bridge, so a fix compiled into volt.exe alone leaves the wire serving the old code and
		// the run measures a binary that no longer exists. That is the stale-bridge trap, and it has cost a
		// re-recorded corpus before.
		// VOLT_SHOW serves the blank through the PRODUCTION host and leaves the IDE open at the end, so the
		// migrated project can be looked at AND DRIVEN. The on-disk `Blank.project` is useless for that on its
		// own: a push writes into the IDE's in-memory project and nothing here saves, so the file on disk is
		// still the untouched template.
		//
		// Nothing is needed to make the IDE usable: the launcher serves every project through the SHIPPED host,
		// so the IDE's own message loop answers the pipe and the window stays clickable while the push runs.
		// `-Wait` blocks until a NEW pipe appears and prints its name. Pinning to that is what stops the run
		// attaching to an IDE someone left open — and it is the only thing that can: CODESYS RE-EXECS during
		// startup, so the pid `Start-Process` reported is not the pid that ends up serving.
		activePipe = pipeFrom(ps(LAUNCHER, ["-Action", "up", "-Vendor", "codesys", "-NoBuild", "-Fixture", project, "-Wait"]))
	},
	close() {
		if (process.env.VOLT_SHOW) {
			console.log("  VOLT_SHOW: leaving the IDE open on the migrated project — close it yourself when done")
			return
		}
		ps(LAUNCHER, ["-Action", "down", "-Vendor", "codesys"])
	},
}

/** Build the bridge AND the CLI before anything opens, so the run cannot measure a stale binary. */
function buildToolchain(): void {
	const dotnet = "C:\\Program Files\\dotnet\\dotnet.exe"
	for (const proj of ["src/Volt.Ide.Codesys/Volt.Ide.Codesys.csproj", "src/Volt.Cli/Volt.Cli.csproj"]) {
		process.stdout.write(`building ${proj}… `)
		execFileSync(dotnet, ["build", join(REPO, "packages", "volt-cli", proj), "-c", "Release", "--nologo", "-v", "quiet"], {
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		})
		console.log("ok")
	}
}

/** The TwinCAT blank.
 *
 * There is NO template to copy — CODESYS ships `Standard.project`, TwinCAT ships nothing — so a committed
 * FIXTURE solution is copied per corpus and the first push empties it, exactly as the CODESYS path empties the
 * template's `PLC_PRG`. A copy, never the fixture itself: the fixture is a real project under version control
 * and a migration would gut it.
 *
 * The launcher spawns the worker (`--xae-pid`) rather than waiting for one. In production the CONNECTOR
 * supervises it, but only once a client declares an interest in that project — a session dance a finder has no
 * business performing, and one that would make the run depend on the tray being up.
 */
const TWINCAT: Blank = {
	async open(label) {
		const scratch = mkdtempSync(join(tmpdir(), `volt-blank-tc-${label}-`))
		cpSync(join(REPO, "packages", "volt-cli", "test", "fixtures", "TwinCAT Project13"), scratch, { recursive: true })
		const sln = join(scratch, "TwinCAT Project13.sln")

		// The launcher spawns the worker and waits for the ROT, so this arm no longer carries its own copy of
		// either. It used to sleep a flat 90s before spawning, because TcXaeShell's window exists long before
		// the PLC project is loaded — `--list-xae-pids` answers that question instead of guessing at it.
		const pipe = pipeFrom(ps(LAUNCHER, ["-Action", "up", "-Vendor", "twincat", "-Fixture", sln, "-Wait"]))
		activePipe = pipe

		// A TwinCAT XAE starts every project IDLE and must be TOLD which to serve — CODESYS serves its loaded
		// project by default. Without this the first `volt init` fails with "the bridge has no PLC project
		// loaded", which reads like the IDE never opened and is really "nobody selected it". In production the
		// CONNECTOR does this select when a client declares an interest; a finder has no session, so it selects
		// directly. Same framing the e2e harness uses (`callOn`), deliberately not a second copy of it.
		const deadline = Date.now() + 120_000
		while (Date.now() < deadline) {
			const health = await callOn(pipe, "health").catch(() => ({ projects: [] as any[] }))
			if ((health.projects ?? []).some((p: any) => p.status === "healthy")) return
			const first = (health.projects ?? [])[0]?.project
			if (first) await callOn(pipe, "connect", { project: first }).catch(() => {})
			await new Promise((r) => setTimeout(r, 2000))
		}
		throw new Error(`the TwinCAT bridge never served a project on ${pipe} — is the XAE still loading?`)
	},
	close() {
		// `down -Vendor twincat` closes the XAE windows AND the workers attached to them.
		ps(LAUNCHER, ["-Action", "down", "-Vendor", "twincat"])
	},
}

const BLANKS: Record<string, Blank> = { codesys: CODESYS, twincat: TWINCAT }

function codesysInstall(): string {
	const dir = "C:\\Program Files\\CODESYS 3.5.21.40"
	if (!existsSync(dir)) throw new Error(`CODESYS SP21 not found at ${dir}`)
	return dir
}

/** The host serves `volt.bridge.<vendor>.<pid>`; wait for any pipe under the vendor prefix. */
/**
 * Wait for the bridge pipe — and for THE ONE THIS RUN LAUNCHED when its pid is known.
 *
 * <p>Matching only the PREFIX takes whichever IDE answers first, which is fine only while exactly one is
 * running. Leave a CODESYS open on another project and the finder silently migrates into THAT — measured: a
 * stray instance holding a probe's leftovers produced `ENOENT ... VltCollideA.prg` and it was reported as a
 * GAP in the product. A fabricated finding from a real run is worse than no run.</p>
 */
/** The pipe `ide.ps1 -Wait` reported — the IDE THIS run brought up, which is the only one it may drive.
 *
 *  The launcher's last such token is that pipe: `-Wait` returns the one that appeared during the call, so an
 *  IDE someone left open cannot be mistaken for it. Strays are still NAMED, because an IDE serving a different
 *  project is exactly the setup that once fabricated a GAP, and the operator is the only one who can close it.
 *  (The polling this function used to do lives in the launcher now, for both vendors.) */
function pipeFrom(out: string): string {
	const all = [...out.matchAll(/volt\.bridge\.(?:codesys|twincat)\.\d+/g)].map((m) => m[0])
	if (all.length === 0) throw new Error(`the launcher never reported a pipe:\n${out}`)
	const mine = all[all.length - 1]
	const vendor = mine.split(".")[2]
	const strays = readdirSync("\\\\.\\pipe\\").filter((p) => p.startsWith(`volt.bridge.${vendor}.`) && p !== mine)
	if (strays.length > 0)
		console.log(`   NOTE  ${strays.length} other ${vendor} IDE(s) serving (${strays.join(", ")}) — this run `
			+ `is pinned to ${mine}`)
	return mine
}

function ps(script: string, args: string[]): string {
	return execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	})
}

/** `volt`, with the CLI's own stdout/stderr preserved on failure — a refused push says WHY, and that message is
 *  the finding, not noise to be swallowed by an exec error. */
function volt(cwd: string, args: string[]): string {
	try {
		// VOLT_PIPE, not prefix discovery. `volt` finds a bridge the same way `waitForPipe` used to —
		// first match — so pinning the wait alone still leaves the CLI free to talk to a stray IDE.
		return execFileSync(VOLT, args, {
			cwd,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
			env: activePipe ? { ...process.env, VOLT_PIPE: activePipe } : process.env,
		})
	} catch (err) {
		const e = err as { stdout?: string; stderr?: string }
		throw new Error(`volt ${args.join(" ")} failed:\n${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim())
	}
}

/** A fresh workspace materialized from whatever the bridge currently serves. */
function initWorkspace(label: string): { root: string; src: string; dispose: () => void } {
	const tmp = mkdtempSync(join(tmpdir(), `volt-${label}-`))
	volt(tmp, ["init", "--vendor", VENDOR])
	const created = readdirSync(tmp, { withFileTypes: true }).filter((e) => e.isDirectory())
	if (created.length !== 1) throw new Error(`expected one workspace under ${tmp}, found ${created.length}`)
	const root = join(tmp, created[0]!.name)
	return { root, src: join(root, "src"), dispose: () => rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }) }
}

// ── the tree under comparison ─────────────────────────────────────────────────────────────────────────────

/**
 * THE STRUCTURAL PREFIX a vendor puts in front of the engineer's own items — stripped so two vendors' trees can
 * be compared as what they are: the same payload under different plumbing.
 *
 * CODESYS puts THREE levels first (`<Device>/Plc Logic/Application`); TwinCAT puts NONE, and materializes the PLC
 * project's contents at the top of `src/` (DIALECT N15). Everything under `Application` is the payload, and on
 * TwinCAT that payload IS the root. Normalising only the device SEGMENT — which is what this did — compares
 * `Device/Plc Logic/Application/99 Library/Round.fun` against `99 Library/Round.fun` and calls every item
 * MISSING+EXTRA.
 *
 * Returns "" when the vendor has no prefix, which is not an error and must not be treated as one.
 */
function structuralPrefix(root: string): string {
	const device = readdirSync(root, { withFileTypes: true }).filter(
		(e) => e.isDirectory() && existsSync(join(root, e.name, "Plc Logic")),
	)
	if (device.length > 1) throw new Error(`expected at most one device root under ${root}, found ${device.length}`)
	if (device.length === 0) return ""                                  // TwinCAT: the payload is the root

	// `Application` is where the engineer's items begin. A CODESYS project can hold more than one; the finder
	// handles the single-application shape every corpus has, and says so rather than picking one silently.
	const plc = join(root, device[0]!.name, "Plc Logic")
	const apps = readdirSync(plc, { withFileTypes: true }).filter((e) => e.isDirectory())
	if (apps.length !== 1)
		throw new Error(`expected exactly one Application under ${plc}, found ${apps.length} — multi-application ` +
			`projects are not handled by this finder`)
	return `${device[0]!.name}/Plc Logic/${apps[0]!.name}`
}

/** Strip the vendor's structural prefix, and the TASK CONTAINER with it.
 *
 *  <p>A task's container is structure too, and the vendors disagree about it twice over: CODESYS nests tasks in
 *  a node it NAMES (`Task Configuration`, or `Taskkonfiguration` on a German install — DIALECT C22), TwinCAT has
 *  no such node and puts `PlcTask.task` at the root. So the container is dropped on both sides and a task is
 *  compared by its own name, which is what the wire keys it by anyway.</p> */
function stripStructure(rel: string, prefix: string): string {
	let out = prefix && rel.startsWith(prefix + "/") ? rel.slice(prefix.length + 1) : rel
	if (out.endsWith(".task")) out = out.slice(out.lastIndexOf("/") + 1)
	return out
}

/** Every extension a push may CARRY. `SOURCE_EXTENSIONS` is writable *source*; a `.task` is a writable
 *  DESCRIPTOR (`ItemKind.WritableReferenceKinds`) and is pushed by exactly the same wire, so leaving it out
 *  meant the finder never staged, created or compared a single task — a blind spot sitting directly over the
 *  most recently fixed create path. */
const PUSHABLE_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, "task"])

function isSource(name: string): boolean {
	const dot = name.lastIndexOf(".")
	return dot >= 0 && PUSHABLE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

/**
 * Every pushable file under `root`, keyed by its device-normalized relative path. Library signatures are
 * dropped by folder (read-only by location) and reference manifests by extension.
 */
function pushableTree(root: string): Map<string, string> {
	const prefix = structuralPrefix(root)
	const out = new Map<string, string>()
	const walk = (dir: string): void => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.isDirectory()) {
				if (!LIBRARY_DIRS.has(e.name)) walk(join(dir, e.name))
			} else if (isSource(e.name) || e.name === FOLDER_MARKER) {
				const path = join(dir, e.name)
				const rel = relative(root, path).split(sep).join("/")
				out.set(stripStructure(rel, prefix), readFileSync(path, "utf8"))
			}
		}
	}
	walk(root)
	return out
}

/** The folder the TARGET keeps its tasks in, relative to its structural prefix — "" when it keeps them at the
 *  root, which is what TwinCAT does. Read from a tree that still HAS a task; after the emptying push it cannot
 *  be recovered. */
function taskContainer(root: string): string {
	const prefix = structuralPrefix(root)
	const walk = (dir: string): string | null => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name)
			if (e.isDirectory()) {
				const hit = walk(p)
				if (hit !== null) return hit
			} else if (e.name.endsWith(".task")) {
				const rel = relative(root, p).split(sep).join("/")
				const within = prefix && rel.startsWith(prefix + "/") ? rel.slice(prefix.length + 1) : rel
				const cut = within.lastIndexOf("/")
				return cut < 0 ? "" : within.slice(0, cut)
			}
		}
		return null
	}
	return walk(root) ?? ""
}

/**
 * Rewrite the fields the TARGET vendor cannot express, and SAY SO.
 *
 * A `.task` pulled from CODESYS can carry three things TwinCAT has no counterpart for, and `TcTaskSchedule`
 * refuses each by name rather than dropping it. Measured across the five corpora: 10 of 13 tasks carry a
 * WATCHDOG and one is `Type: Freewheeling`, so 11 of 13 would be refused before a single POU was judged — the
 * run would report a wall of task refusals and say nothing about the source round-trip it exists to test.
 *
 * The watchdog is the one that matters, and dropping it is a real loss, not a formatting detail: TwinCAT's
 * `ExceedWarning` counts tolerated overruns, which is NOT CODESYS's time-plus-sensitivity watchdog, and the
 * driver deliberately refuses to equate them rather than write a number that means something else. So this
 * is not "normalising a vendor difference" — it is stating, in the report, that **a CODESYS project cannot be
 * migrated to TwinCAT with its task watchdogs intact**. Silently stripping them would hide exactly that.
 */
function adaptForVendor(files: Map<string, string>): { files: Map<string, string>; notes: string[] } {
	if (VENDOR !== "twincat") return { files, notes: [] }

	// MATCH THE LINE, THEN COMPARE THE VALUE - no negative lookahead. `^Watchdog:( +)(?!off$)...` reads
	// correctly and is wrong: `( +)` BACKTRACKS, giving back a space so the lookahead is tested at " off",
	// where `off` does not match, the guard passes, and the line matches after all. It reported
	// `Watchdog: off` as a dropped watchdog and every `Type: Cyclic` as "Cyclic -> Cyclic". A lookahead behind
	// a greedy quantifier is not a guard; reading the value and comparing it is.
	const field = (label: string) => new RegExp("^" + label + ":( +)([^\\r\\n]*)", "m")
	const WATCHDOG = field("Watchdog")
	const TYPE = field("Type")
	const INTERVAL = field("Interval")

	const notes: string[] = []
	const out = new Map<string, string>()
	for (const [rel, text] of files) {
		if (!rel.endsWith(".task")) {
			out.set(rel, text)
			continue
		}
		let adapted = text
		const name = rel.slice(rel.lastIndexOf("/") + 1)

		const watchdog = WATCHDOG.exec(adapted)
		if (watchdog && watchdog[2].trim() !== "off") {
			adapted = adapted.replace(watchdog[0], `Watchdog:${watchdog[1]}off`)
			notes.push(`${name}: watchdog "${watchdog[2].trim()}" DROPPED - TwinCAT has no per-task watchdog ` +
				`with a time and a sensitivity`)
		}
		// AN IEC TIME LITERAL IS A SPELLING, NOT A CAPABILITY — unlike the two below it.
		//
		// CODESYS keeps `interval` and `interval_unit` SEPARATELY, exactly as TwinCAT does, and accepts either
		// form: type a number and a unit and it stores `4`/`ms`; type `t#4ms` and it stores that literal with
		// NO unit. Volt reports whichever the engineer wrote, so both spellings appear in the same CODESYS
		// corpora — measured across the five: 6 literals against 8 number+unit. TwinCAT has no literal form, so
		// every task carrying one is refused and never reaches the comparison.
		//
		// Converting is lossless where the literal is simple, and this ONLY converts those: one number, one
		// unit. A compound (`T#1s500ms`) or fractional (`t#0.5s`) literal is left alone and will be refused by
		// the bridge, because folding those into a single number is arithmetic on the engineer's schedule and
		// belongs in a considered change, not in a test fixture adapter.
		const interval = INTERVAL.exec(adapted)
		const simple = interval && /^[tT]#(\d+)(ns|us|µs|ms|s|m|h|d)$/.exec(interval[2].trim())
		if (interval && simple) {
			adapted = adapted.replace(interval[0], `Interval:${interval[1]}${simple[1]} ${simple[2]}`)
			notes.push(`${name}: interval "${interval[2].trim()}" -> "${simple[1]} ${simple[2]}" - same duration, ` +
				`TwinCAT has no TIME-literal spelling`)
		}

		const type = TYPE.exec(adapted)
		if (type && type[2].trim() !== "Cyclic") {
			adapted = adapted.replace(type[0], `Type:${type[1]}Cyclic`)
			notes.push(`${name}: type "${type[2].trim()}" -> Cyclic - a TwinCAT PLC task is always cyclic`)
		}
		out.set(rel, adapted)
	}
	return { files: out, notes }
}

/** Lay the staged files into the workspace, removing any the workspace has and the set does not — so one push
 *  exercises create, update AND delete, which is what a real migration does.
 *
 *  <p>The payload arrives with every vendor structure stripped, so it is put back under the TARGET's: its
 *  prefix (`<Device>/Plc Logic/<Application>` on CODESYS, nothing on TwinCAT) and, for a task, the container
 *  the target itself uses. `tasksAs` is read from the target BEFORE it is emptied — once its tasks are gone the
 *  tree no longer says where they live, and on TwinCAT the answer is legitimately "" (the root).</p> */
function stage(files: Map<string, string>, srcRoot: string, tasksAs: string): void {
	const prefix = structuralPrefix(srcRoot)
	const abs = (rel: string): string => {
		const placed = rel.endsWith(".task") && tasksAs ? `${tasksAs}/${rel}` : rel
		return join(srcRoot, (prefix ? `${prefix}/${placed}` : placed).split("/").join(sep))
	}
	for (const rel of pushableTree(srcRoot).keys()) if (!files.has(rel)) rmSync(abs(rel))
	for (const [rel, text] of files) {
		const path = abs(rel)
		mkdirSync(dirname(path), { recursive: true })
		writeFileSync(path, text)
	}
}

/**
 * A readable report: what is missing, what is extra, and the first line that differs.
 *
 * An item the bridge REFUSED BY NAME is not a finding here. It was deliberately not pushed, the refusal is
 * already printed as its own line, and reporting it a second time as `MISSING` says the run failed at something
 * it in fact handled — which is exactly how a known vendor limit starts reading as noise and gets ignored.
 */
function diff(expected: Map<string, string>, actual: Map<string, string>, refused: Map<string, string>): string[] {
	const problems: string[] = []
	for (const [rel, want] of expected) {
		if (refused.has(rel)) continue
		const got = actual.get(rel)
		if (got === undefined) problems.push(`${rel}: MISSING — did not survive the migration`)
		else if (got !== want) problems.push(`${rel}: DRIFTED\n${firstDifference(want, got)}`)
	}
	for (const rel of actual.keys()) if (!expected.has(rel)) problems.push(`${rel}: EXTRA — not in the corpus`)
	return problems
}

function firstDifference(want: string, got: string): string {
	const a = want.split("\n")
	const b = got.split("\n")
	for (let i = 0; i < Math.max(a.length, b.length); i++)
		if (a[i] !== b[i])
			return `    line ${i + 1}\n      want: ${JSON.stringify(a[i])}\n      got:  ${JSON.stringify(b[i])}`
	return "    (lines identical — the trailing newline differs)"
}


/**
 * THE MIGRATING PUSH, MINUS WHAT THIS VENDOR PAIR CANNOT CARRY.
 *
 * A push that the bridge refuses by NAME is a known vendor limit, not a broken run: TwinCAT cannot re-import an
 * Execute box even in a body TwinCAT itself authored (C20), so `POUexecute.prg` stops a Project14 migration at
 * item 7 of 9 and the other eight are never compared. The finder exists to find DRIFT, and it cannot find any
 * in files it never pushed.
 *
 * So a refusal removes that item and the push is retried — but ONLY a refusal the bridge NAMED. This is
 * deliberately not "retry until it works": an error this cannot parse an item name out of is rethrown
 * untouched, because a finder that shrinks its own input set until the push succeeds would report a clean
 * migration of nothing. Each dropped item is RETURNED and printed as a `refused` line beside the `adapted`
 * ones, which is what task 2 asks for — say what this vendor cannot do, by name, without learning to ignore
 * drift in general.
 *
 * The pull between attempts is the CLI's own instruction. A refused push is not rolled back ("6 of 9 item(s)
 * were already written ... Run `volt pull` to take them into the workspace, then push again"), so without it
 * the next push re-sends items the IDE already has and fails on their versions instead.
 */
function pushAllItCan(
	pusher: { root: string; src: string },
	staged: Map<string, string>,
	tasksAs: string,
): Map<string, string> {
	const refused = new Map<string, string>()
	const remaining = new Map(staged)

	// One attempt per refusable item, plus one that must succeed. A bound rather than `while (true)`: if a
	// refusal names an item that is not in the set, dropping it changes nothing and this would spin forever.
	for (let attempt = 0; attempt <= staged.size; attempt++) {
		try {
			volt(pusher.root, ["push"])
			return refused
		} catch (err) {
			const message = String((err as Error).message)
			// MATCHED BY BASE NAME, AND WITHOUT THE EXTENSION.
			//
			// The bridge names an item the way the WIRE does while the staged map is keyed by workspace PATH,
			// so the folder has to go: `POUs/POUexecute.prg` against `POUexecute.prg`.
			//
			// The EXTENSION has to go too, and that is not obvious. A DUT is ONE wire kind with FOUR file
			// extensions (`.struct`/`.enum`/`.union`/`.alias`), so lenze-mid's `sUDT_CamControlLS_Calculation`
			// is `.struct` on disk and `.dut` on the wire. Comparing with extensions matched nothing, the
			// refusal was rethrown as an unattributable failure, and a run that had found a real vendor limit
			// reported "the migration itself failed" instead of naming it. Every other kind spells both the
			// same, which is exactly why it survived the first four corpora.
			const lines = refusalLines(message)
			const stem = (n: string) => n.split("/").pop()!.replace(/\.[^.]+$/, "")
			const refusedStems = new Set([...lines.keys()].map(stem))
			const named = [...remaining.keys()].filter((k) => refusedStems.has(stem(k)))
			if (named.length === 0) throw err

			for (const k of named) {
				remaining.delete(k)
				const reason = [...lines].find(([n]) => stem(n) === stem(k))?.[1]
				refused.set(k, reason ?? "refused by the bridge")
			}
			// RE-STAGE FIRST, THEN PULL. `stage` deletes what is no longer in the map, so this drops the
			// refused file from the workspace before the merge sees it. The other order conflicts on exactly
			// that file — the IDE never received it, so a pull merges "locally added" against "not there" and
			// stops with `CONFLICT in 1 file(s)`, which is a worse failure than the refusal it was recovering
			// from.
			stage(remaining, pusher.src, tasksAs)
			volt(pusher.root, ["pull"])
		}
	}
	throw new Error("the push kept being refused after " + staged.size + " attempts. Refusals so far:\n" + [...refused].map((e) => e[0] + " - " + e[1]).join("\n"))
}

/**
 * The item names a refusal message carries. The bridge reports one `  <name>: <reason>` line per rejected op,
 * two-space indented under `the bridge rejected the push:` — so the shape is scanned rather than matched with a
 * regex built from the item name, which would need escaping the name for a pattern it is only ever compared to.
 */
function refusalLines(message: string): Map<string, string> {
	const out = new Map<string, string>()
	for (const raw of message.split("\n")) {
		if (!raw.startsWith("  ") || raw.startsWith("   ")) continue
		const colon = raw.indexOf(": ")
		if (colon < 0) continue
		const name = raw.slice(2, colon).trim()
		if (!name || name.includes(" ")) continue   // a prose line, not an item
		// Drop the CLI's own trailing advice; the REASON is the vendor's sentence.
		const reason = raw.slice(colon + 2).split(" — NOTE:")[0]!.trim()
		out.set(name, reason)
	}
	return out
}

// ── one corpus, end to end ────────────────────────────────────────────────────────────────────────────────

async function migrate(name: string): Promise<string[]> {
	const blank = BLANKS[VENDOR]
	if (!blank) throw new Error(`no blank-project launcher for '${VENDOR}' — CODESYS only for now`)

	const all = pushableTree(join(CORPUS_ROOT, name))
	if (all.size === 0) throw new Error(`${name} has no pushable source — is the corpus stale?`)
	const authorable = new Map([...all].filter(([, text]) => !text.includes(BODY_MARKER)))
	const unauthorable = all.size - authorable.size
	const { files: staged, notes } = adaptForVendor(authorable)

	console.log(`\n── ${name}: ${staged.size} file(s) to migrate${unauthorable ? `, ${unauthorable} unauthorable (CFC/SFC/IL)` : ""}`)
	// Printed BEFORE the run, never buried in the result: an adapted field is a fact about what this vendor
	// pair can carry, and it IS the finding - not noise on the way to one.
	for (const n of notes) console.log(`   adapted  ${n}`)

	await blank.open(name)
	const pusher = initWorkspace(`push-${name}`)
	try {
		// EMPTY THE TARGET IN ITS OWN PUSH, then migrate into it. The shipped template is not actually empty — it
		// carries a `PLC_PRG` under the Application — and doing both halves in one push let `git diff -M` pair
		// that deletion with an unrelated ADD by content similarity: two skeletal PROGRAM POUs are well over the
		// 50% threshold. The push then emitted a single move+rename `PLC_PRG -> POUTab` INTO the project root,
		// which CODESYS cannot perform at all (its `move` takes an IScriptObject and the project is not one), and
		// it failed at op 534 of 534 with 533 already written.
		//
		// Two pushes is also the more faithful shape: "migrate into an empty project" means the target IS empty
		// before the migration, so the second push is a pure CREATE — which is the path this exists to exercise.
		// Read BEFORE emptying: the target's own name for its task container is only visible while it still has
		// a task in it, and the migrating push needs it to place the `.task` files it lays down.
		const tasksAs = taskContainer(pusher.src)

		stage(new Map(), pusher.src, tasksAs)
		volt(pusher.root, ["push"])

		stage(staged, pusher.src, tasksAs)
		const refused = pushAllItCan(pusher, staged, tasksAs)
		for (const [k, r] of refused) console.log(`   refused  ${k} — ${r}`)

		// A SECOND workspace, so what comes back is a materialization and never a merge. A `volt pull` back into
		// the pusher would be a git merge, so a genuine reshape shows up as a CONFLICT rather than a readable
		// diff — which hides the one thing this is looking for.
		const reader = initWorkspace(`read-${name}`)
		try {
			return diff(staged, pushableTree(reader.src), refused)
		} finally {
			// VOLT_KEEP leaves both workspaces on disk and prints them. A DRIFTED line is one line of context; the
			// bug behind it is usually visible only in the whole file, and the run that produced it is the
			// expensive part.
			if (process.env.VOLT_KEEP) console.log(`  kept: read  ${reader.root}`)
			else reader.dispose()
		}
	} finally {
		if (process.env.VOLT_KEEP) console.log(`  kept: push  ${pusher.root}`)
		else pusher.dispose()
		blank.close()
	}
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────────────

const only = process.argv[2]
const corpora = readdirSync(CORPUS_ROOT, { withFileTypes: true })
	.filter((e) => e.isDirectory() && (!only || e.name === only))
	.map((e) => e.name)
if (corpora.length === 0) throw new Error(`no corpus matching '${only}' under ${CORPUS_ROOT}`)

buildToolchain()

const findings = new Map<string, string[]>()
for (const name of corpora) {
	try {
		findings.set(name, await migrate(name))
	} catch (err) {
		findings.set(name, [`the migration itself failed: ${err instanceof Error ? err.message : String(err)}`])
	}
}

console.log("\n══ corpus migration ══")
let total = 0
for (const [name, problems] of findings) {
	total += problems.length
	console.log(`  ${problems.length === 0 ? "OK  " : "GAP "} ${name.padEnd(22)} ${problems.length} problem(s)`)
}
for (const [name, problems] of findings) {
	if (problems.length === 0) continue
	console.log(`\n── ${name} — first ${Math.min(40, problems.length)} of ${problems.length}`)
	for (const p of problems.slice(0, 40)) console.log(`  ${p}`)
}
console.log(
	total === 0
		? "\nevery corpus migrated into a blank project unchanged."
		: `\n${total} problem(s). Each one is a GAP: fix it, then add a test to volt-cli that fails without the fix.`,
)
process.exit(total === 0 ? 0 : 1)
