/**
 * Shared harness for the e2e bridge suite. One typed client over EVERY op, version-snapshot + delta helpers
 * (the backbone of the hash-stability assertions), and test-item fixture cleanup. The SAME suite runs against
 * whichever live bridge the pipe points at (`VOLT_PIPE`, or `VOLT_VENDOR`: twincat /
 * CODESYS) — no vendor branches: a pass on one bridge and a fail on the other is a real parity bug, not an
 * expected difference. Tests provision their own fixtures (never read ambient project state) so this holds.
 *
 * All test items are named `${PREFIX}_*` so cleanup is a single prefix-based atomic delete.
 */
import { expect } from "bun:test"
import { connect } from "node:net"
import { readdirSync } from "node:fs"

export const VENDOR = process.env.VOLT_VENDOR === "twincat" ? "twincat" : "codesys"
// Both vendors serve ONE pipe per running IDE, keyed by pid (`volt.bridge.<vendor>.<pid>`). We target by prefix, not a
// fixed pid, so a TwinCAT XAE (or CODESYS) that restarts with a new pid is picked up automatically. VOLT_PIPE (an
// exact pid pipe, or a prefix) REPLACES the vendor default — it is exclusive. It used to be advisory: a third filter
// clause also matched `volt.bridge.<vendor>.*`, so with two IDEs of one vendor up, an explicit VOLT_PIPE silently ran
// the whole suite against the OTHER one (a developer's live project instead of the headless fixture). Naming a pipe
// means that pipe; if it isn't serving, pipeCall says so rather than retargeting.
const PIPE_PREFIX = process.env.VOLT_PIPE || `volt.bridge.${VENDOR}`

/** Is the pid in `volt.bridge.<vendor>.<pid>` still a running process? A killed TwinCAT XAE's worker keeps serving
 *  its pipe for up to ~15s until the connector reaps it, and that pipe answers PLC_DISCONNECTED ("waiting for an IDE
 *  project") — so picking it looks exactly like a product bug. The pipe is NAMED after the IDE's pid, so liveness is
 *  a cheap sync check. Un-suffixed / unparsable names are kept (nothing to check). Mirrors why the CLI has
 *  BridgeResolver: never target a bridge that isn't serving. */
function ideAlive(pipeName: string): boolean {
	const pid = Number(pipeName.split(".").pop())
	if (!Number.isInteger(pid) || pid <= 0) return true
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

/** The live per-pid pipe(s) matching the target — the VOLT_PIPE pipe/prefix, else every pipe of this vendor. */
function livePipes(): string[] {
	try {
		const matching = readdirSync("\\\\.\\pipe\\").filter((n) => n === PIPE_PREFIX || n.startsWith(PIPE_PREFIX + "."))
		// PREFER pipes whose IDE is still alive, so a stale worker is never picked while a live bridge exists. But if
		// none is alive, still return the real pipes: a TwinCAT worker deliberately OUTLIVES its IDE (~15s until the
		// connector reaps it) and must answer PLC_DISCONNECTED from that window — that is a product behavior the
		// chaos suite exists to assert, not a state to hide. This is a choice among REAL pipes, not a fabricated
		// result; the fabrication this file must never do is inventing a pipe name (see pipeCall).
		const alive = matching.filter(ideAlive)
		return alive.length > 0 ? alive : matching
	} catch {
		return []
	}
}

let cachedPipe: string | undefined
/** Resolve the live pipe: keep the cached one while it's still up, else re-discover. Falls back to the raw prefix
 *  (a `connect` there ENOENTs with a clear name) when no bridge is up. */
function resolvePipe(): string {
	if (cachedPipe && livePipes().includes(cachedPipe)) return cachedPipe
	cachedPipe = livePipes()[0] ?? PIPE_PREFIX
	// Stamp the RESOLVED name back into the environment, because a spawned `volt` inherits it — and VOLT_PIPE is
	// how the CLI is told which bridge to drive. Without this, the suite is normally started with the vendor
	// PREFIX (`VOLT_PIPE=volt.bridge.codesys`, exactly as the README says to), the harness resolves that to the
	// live per-pid pipe for its own calls, and every CLI child still inherits the prefix — which is not a pipe.
	// The CLI then reports "bridge is not reachable", correctly: naming a pipe means that pipe. That is the whole
	// of why the two conflict tests were red; they are the only e2e tests that drive the CLI rather than the wire.
	// The invariant below is not "the harness uses one pipe" — it is that EVERYTHING driving this bridge does.
	process.env.VOLT_PIPE = cachedPipe
	return cachedPipe
}

/** The live pipe, resolved AT CALL TIME. Anything that drives the bridge must use this, never `PIPE`: bun runs
 *  every e2e file in ONE process, so a module-load snapshot is minutes-to-hours stale by the time a late suite
 *  uses it, and `resolvePipe`'s cache is dropped on any socket error (see `pipeCall`). When both survive, a test
 *  can hand `init` the snapshot (pipe A) while every other harness call drives the re-resolved cache (pipe B) —
 *  it binds a workspace on one IDE and then operates against another, and the failure surfaces minutes later in
 *  an unrelated test. One question, one answer. */
export const currentPipe = (): string => resolvePipe()

export const PIPE = resolvePipe() // LABEL ONLY — a stable name for describe() titles. To drive a bridge: currentPipe().
export const BASE = `pipe ${PIPE}` // a label for describe() titles (the wire is the pipe, not a URL)
export const PREFIX = "VltE2E"
export const FOLDER = "POUs"

/** One request per connection (mirrors the CLI's PipeClient): write `{op,body}\n`, drain frames, return the
 *  terminal result (progress frames ignored; an error frame throws). Re-resolves the pipe each call, so a bridge that
 *  restarted with a new pid is followed; a connect error drops the cached pipe so the next call re-discovers. */
function pipeCall(op: string, body?: unknown): Promise<any> {
	const pipe = resolvePipe()
	// Say what's actually wrong. Connecting to the bare prefix instead yields `ENOENT \\.\pipe\volt.bridge.codesys`,
	// which reads as a bridge bug when the truth is "no IDE is up yet" — the exact trap that made a cold baseline run
	// report 3 phantom failures.
	if (!livePipes().includes(pipe))
		throw new Error(
			`no live ${PIPE_PREFIX}* pipe — is the IDE running and its project loaded? ` +
				`(CODESYS: scripts/codesys-pipe.ps1 up · TwinCAT: scripts/twincat-instances.ps1 up, connector running)`,
		)
	return callOn(pipe, op, body)
}

/** One request against an EXPLICITLY NAMED pipe — the same wire as `pipeCall`, minus the resolution.
 *  <p>Split out for the cross-vendor parity suite, the one thing here that drives TWO bridges at once and so
 *  cannot use the single resolved pipe every other test shares. Extracting it beats a second copy of the
 *  framing: that suite's whole claim is that both vendors answer IDENTICALLY, which is worth nothing if it
 *  reaches them through a different client than the rest of the suite uses.</p> */
function callOn(pipe: string, op: string, body?: unknown): Promise<any> {
	return new Promise((resolve, reject) => {
		const sock = connect(`\\\\.\\pipe\\${pipe}`)
		let buf = ""
		let result: unknown
		sock.on("connect", () => sock.write(JSON.stringify({ op, body: body ?? undefined }) + "\n"))
		sock.on("data", (d: Buffer) => {
			buf += d.toString("utf8")
			let nl: number
			while ((nl = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, nl)
				buf = buf.slice(nl + 1)
				if (!line) continue
				const frame = JSON.parse(line)
				if ("result" in frame) result = frame.result
				else if ("error" in frame) { reject(new Error(`${frame.error.code}: ${frame.error.message}`)); sock.destroy(); return }
				// progress frames ignored
			}
		})
		sock.on("end", () => resolve(result))
		sock.on("error", (e) => { cachedPipe = undefined; reject(e) })
	})
}

/** A route path ("/fetch", "/refs?x") → the pipe op name ("fetch", "refs"). */
function opOf(path: string): string { return path.replace(/^\//, "").split("?")[0] }

// ── raw wire (named pipe) ──────────────────────────────────────────────────────
export async function get(path: string): Promise<any> { return pipeCall(opOf(path)) }
export async function post(path: string, body?: unknown): Promise<any> { return pipeCall(opOf(path), body) }

// ── typed op client (every op the bridge serves over the pipe) ────────────────
export const bridge = {
	health: (): Promise<any> => get("/health"),
	refs: (): Promise<any> => get("/refs"),
	fetch: (req: { knownItems?: Record<string, string>; onlyItems?: string[] } = {}): Promise<any> => post("/fetch", req),
	push: (req: { ops: unknown[]; expectedProjectVersion?: string }): Promise<any> => post("/push", req),
	build: (): Promise<any> => post("/build", {}),
	// The connection-lifecycle ops the CONNECTOR drives (the tray / the two frontends), not the CLI. `deselect`
	// is the tray's Disconnect: the bridge refuses sync until the next `select`, tearing nothing down.
	// Discovery folded into `health` — no separate `instances` op. Returns the FLAT connectable-projects array
	// (`health.projects`), each row self-describing: { vendor, version, project, status, dirty }. "Serving" is folded
	// into `status`: "idle" (detected, not served) | "healthy" | "degraded" (served).
	instances: (): Promise<any[]> => get("/health").then((h) => h.projects ?? []),
	connect: (req: { project?: string | null } = {}): Promise<any> => post("/connect", req),
	disconnect: (): Promise<any> => post("/disconnect"),
}

/** A bridge client bound to ONE named pipe, for the cross-vendor parity suite. Same ops as `bridge`, same wire;
 *  it just never asks which pipe is "the" pipe, because parity means talking to two at once.
 *
 *  <p>`livePipesFor` is how a suite finds the OTHER vendor. Both bridges publish `volt.bridge.<vendor>.<pid>`,
 *  so a run with CODESYS and TwinCAT open sees both, and a run with one open sees one — which is exactly the
 *  signal a parity suite needs to say "not both vendors are up" instead of failing obscurely.</p> */
export function livePipesFor(vendor: "codesys" | "twincat"): string[] {
	return readdirSync("\\\\.\\pipe\\").filter((n) => n.startsWith(`volt.bridge.${vendor}.`))
}

export function clientFor(pipe: string) {
	const call = (op: string, body?: unknown) => callOn(pipe, op, body)
	return {
		pipe,
		health: (): Promise<any> => call("health"),
		refs: (): Promise<any> => call("refs"),
		fetch: (req: { knownItems?: Record<string, string>; onlyItems?: string[] } = {}): Promise<any> => call("fetch", req),
		push: (req: { ops: unknown[]; expectedProjectVersion?: string }): Promise<any> => call("push", req),
		build: (): Promise<any> => call("build", {}),
		connect: (req: { project?: string | null } = {}): Promise<any> => call("connect", req),
	}
}
export type PipeClient = ReturnType<typeof clientFor>

/** The bridge's error code for an op, or null when it succeeded. The e2e client surfaces errors as
 *  `Error("CODE: message")` (see pipeCall), so the code is the prefix. */
export async function opErrorCode(run: () => Promise<unknown>): Promise<string | null> {
	try { await run(); return null } catch (e) { return String((e as Error).message).split(":")[0] }
}

/** The bridge's connection state, derived from the flat `health.projects` array the SAME way the connector does:
 *  serving is a NON-IDLE row (status folds serving in). No served row → "unavailable". There is no root
 *  `status`/`connected`/`platform` on the wire — those are C#-only computed helpers off the served row, so e2e
 *  derives them here too. */
export function healthStatus(h: any): "healthy" | "degraded" | "unavailable" {
	const served = (h?.projects ?? []).find((p: any) => p.status && p.status !== "idle")
	if (!served) return "unavailable"
	return served.status === "degraded" ? "degraded" : "healthy"
}

/** Ensure the bridge is SERVING a project before a suite runs. CODESYS serves its loaded project by default, but a
 *  TwinCAT XAE worker starts every project `idle` and must be told which one to serve — so this SELECTS the first
 *  detected project and waits for it to go healthy (retrying across an IDE that is still loading, or one whose pipe
 *  just changed pid). Vendor-agnostic: on CODESYS the select is a harmless re-confirm. Throws with a clear reason if
 *  nothing becomes healthy in time. */
/**
 * ONE sweep of leftover `VltE2E_*` items per process, before any test runs.
 *
 * `cleanup()` runs in `afterAll`/`afterEach` — which is exactly where it does NOT run when a test TIMES OUT or
 * the runner is interrupted. Whatever that run created stays in the project, and the next run starts against it.
 * That is a cascade, not a one-off: leftovers make more tests fail, more failures skip more cleanup, and the
 * failure count climbs run over run until someone restores the fixture by hand.
 *
 * It is a MEASURED cascade, twice. `unify-item-pipeline` recorded "the same reverted code gave 3, then 8, then 0
 * failures depending only on how used the project copy was"; on 2026-09-03 four runs gave 4, 1, 2 and 7, and a
 * run from a restored fixture gives 159/1 every time. The zero and the stable runs are the ones that followed a
 * restore.
 *
 * Sweeping here rather than in each file's `beforeAll` is deliberate: `requireHealthy` is the one call every
 * file already makes first (32 of 35), and a per-file hook is what we have — several files clean only AFTER
 * themselves, so a file running behind a timed-out one still started dirty. Once per process is enough, because
 * within a process the per-file hooks already hold.
 */
let swept = false
async function sweepOnce(): Promise<void> {
	if (swept) return
	swept = true
	try {
		const refs = await bridge.refs()
		const stale = Object.keys(refs.items ?? {}).filter((n) => n.startsWith(PREFIX))
		if (stale.length === 0) return
		console.warn(
			`[harness] ${stale.length} item(s) left by a previous run — sweeping before starting: ` +
				stale.slice(0, 8).join(", ") + (stale.length > 8 ? ` (+${stale.length - 8} more)` : ""),
		)
		await bridge.push({
			expectedProjectVersion: refs.projectVersion,
			ops: stale.map((n) => ({ op: "deleteItem", name: n, ifVersion: refs.items[n] })),
		})
	} catch {
		// A sweep is best-effort: the bridge may not be serving yet on the very first call, and failing here
		// would turn a hygiene measure into the thing that stops the suite running at all.
	}
}

export async function requireHealthy(timeoutMs = 60_000): Promise<void> {
	const t0 = Date.now()
	let lastProject: string | undefined
	while (Date.now() - t0 < timeoutMs) {
		const h = await bridge.health().catch(() => ({ projects: [] }))
		if (healthStatus(h) === "healthy") {
			await sweepOnce()
			return
		}
		lastProject = (h.projects ?? [])[0]?.project as string | undefined
		if (lastProject) await bridge.connect({ project: lastProject }).catch(() => {}) // TwinCAT idle → select it
		await new Promise((r) => setTimeout(r, 1500))
	}
	throw new Error(
		lastProject
			? `bridge never served '${lastProject}' (selected it but it stayed idle — is the IDE still loading, or is the worker crashing?)`
			: `no project detected on the bridge (open the IDE + its project; for TwinCAT run scripts/twincat-instances.ps1 up)`,
	)
}

// ── test-item identity + cleanup ──────────────────────────────────────────────
// The wire speaks FULL names everywhere (the same principle as /refs and /fetch). `id` is the bare IEC
// identifier used INSIDE source text ("FUNCTION_BLOCK VltE2E_x"); `fid` is the FULL wire/file name (IEC
// name + extension) used for every op and lookup. No bare↔full resolution anywhere.
export function id(s: string): string { return `${PREFIX}_${s}` }
/** The FULL wire name: the IEC name + KIND extension. A POU is named by kind — default `.fb` (function
 *  block); pass "prg"/"fun"/"itf"/"dut"/"gvl" for other kinds (every DUT is one "dut"). */
export function fid(s: string, ext = "fb"): string { return `${id(s)}.${ext}` }

export async function cleanup(): Promise<void> {
	const refs = await bridge.refs()
	if (!refs.items) return
	const ops = Object.keys(refs.items)
		.filter(n => n.startsWith(PREFIX))
		.map(n => ({ op: "deleteItem", name: n, ifVersion: refs.items[n] }))   // n is already the full wire name
	if (ops.length === 0) return
	const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops })
	if (!r.accepted) console.warn("cleanup:", JSON.stringify(r.conflicts).slice(0, 200))
}

// ── push helpers ──────────────────────────────────────────────────────────────
/** Push ops with a fresh expectedProjectVersion guard. */
export async function pushOps(ops: unknown[]): Promise<any> {
	const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops })
	if (!r.accepted) console.warn("push rejected:", JSON.stringify(r.conflicts || r).slice(0, 200))
	return r
}
// ── PLC-project folder prefix (vendor-neutral) ────────────────────────────────
// The wire folder is the FULL tree path from the project root, so it carries each vendor's structural spine:
// CODESYS "Device/Plc Logic/Application", TwinCAT "" (its walk starts at the PLC project). Tests never hardcode
// that spine — they derive it from the main program (which lives at the PLC-project root) and build paths under
// it, so the SAME assertion holds on either bridge.
let _plcRoot: string | null = null
export async function plcRoot(): Promise<string> {
	if (_plcRoot !== null) return _plcRoot
	const main = await mainProgram()
	if (main) return (_plcRoot = (await fetchItem(main)).folder ?? "")
	// No standard main program (a library project): probe by creating a throwaway at the root, reading its
	// resolved folder, then deleting it.
	const probe = fid("__plcroot_probe__")
	await pushOps([{ op: "set", name: probe, toFolder: "", sourceText: "FUNCTION_BLOCK X\nEND_FUNCTION_BLOCK", ifVersion: null }])
	const root = (await fetchItem(probe)).folder ?? ""
	await pushOps([{ op: "deleteItem", name: probe, ifVersion: (await bridge.refs()).items[probe] }])
	return (_plcRoot = root)
}
/** A full wire folder path under the PLC-project root: `plcFolder("POUs/Sub")` → e.g. "Device/Plc Logic/Application/POUs/Sub". */
export async function plcFolder(sub = ""): Promise<string> {
	const root = await plcRoot()
	return sub ? (root ? `${root}/${sub}` : sub) : root
}

/** Create a NEW item — `name` is the FULL wire name. `folder` is a FULL wire path (default: the `POUs` folder
 *  under the PLC-project root); pass `""` to place at the PLC-project root. */
export async function createItem(name: string, src: string, folder?: string): Promise<any> {
	const toFolder = folder === undefined ? await plcFolder(FOLDER) : folder
	const r = await pushOps([{ op: "set", name, toFolder, sourceText: src, ifVersion: null }])
	expect(r.accepted).toBe(true)
	return r
}
/** Update an existing item's content in place (no move) by its FULL wire name, guarded with its current version.
 *  Pass `folder` (a full wire path) only to MOVE it. */
export async function updateItem(name: string, src: string, folder?: string): Promise<any> {
	const v = (await bridge.refs()).items[name] ?? null
	const op: Record<string, unknown> = { op: "set", name, sourceText: src, ifVersion: v }
	if (folder !== undefined) op.toFolder = folder
	const r = await pushOps([op])
	expect(r.accepted).toBe(true)
	return r
}
/** Fetch an item by its FULL wire name. */
export async function fetchItem(name: string): Promise<any> {
	const f = await bridge.fetch({ knownItems: {}, onlyItems: [name] })
	const it = f.changed.find((i: any) => i.name === name)
	if (!it) throw new Error(`item '${name}' not in fetch`)
	return it
}
export async function fetchSource(name: string): Promise<string> { return (await fetchItem(name)).sourceText }

// ── main-program instantiation (required to compile FBs: an instance forces compilation) ──
let _plcPrgOriginal: string | null = null

// The project's main/entry program — the POU we add FB instances to so the compiler reaches them.
// CODESYS default-names it PLC_PRG; TwinCAT default-names it MAIN. Resolve it from /refs (a program is
// named `.prg`) instead of hardcoding, so the SAME suite runs against either vendor's
// default project. Cached after the first lookup.
let _mainProgram: string | null = null
async function mainProgram(): Promise<string | null> {
	if (_mainProgram) return _mainProgram
	const items = (await bridge.refs()).items ?? {}
	for (const cand of ["PLC_PRG.prg", "MAIN.prg"]) if (items[cand] !== undefined) { _mainProgram = cand; return cand }
	return null   // some projects (a library / PackML app) have no standard main program — callers tolerate it
}

/** Strip any test-prefixed instance declarations from the main program so it compiles cleanly. */
export async function fixPlcPrg(): Promise<void> {
	const PLC_PRG = await mainProgram()
	if (!PLC_PRG) return
	const item = await fetchItem(PLC_PRG).catch(() => null)
	if (!item || !item.sourceText.includes(PREFIX)) return
	const lines = item.sourceText.split("\n")
	const clean = lines.filter((l: string) => !l.includes(PREFIX))
	const newSrc = clean.join("\n")
	const r = await pushOps([{
		op: "set",
		name: PLC_PRG,
		toFolder: "",
		sourceText: newSrc,
		ifVersion: item.version,
	}])
	if (!r.accepted) console.warn("fixPlcPrg rejected:", JSON.stringify(r.conflicts || r).slice(0, 200))
}

export async function savePlcPrg(): Promise<void> {
	const PLC_PRG = await mainProgram()
	_plcPrgOriginal = PLC_PRG ? (await fetchItem(PLC_PRG)).sourceText : null
}

export async function restorePlcPrg(): Promise<void> {
	if (!_plcPrgOriginal) return
	const PLC_PRG = await mainProgram()
	if (!PLC_PRG) { _plcPrgOriginal = null; return }
	const current = await fetchItem(PLC_PRG)
	if (current.sourceText === _plcPrgOriginal) { _plcPrgOriginal = null; return }
	const r = await pushOps([{
		op: "set",
		name: PLC_PRG,
		toFolder: "",
		sourceText: _plcPrgOriginal,
		ifVersion: current.version,
	}])
	if (!r.accepted) console.warn("restorePlcPrg rejected:", JSON.stringify(r.conflicts || r).slice(0, 200))
	_plcPrgOriginal = null
}

/** Add an instance of a FB to the main program's VAR section so the compiler reaches it. */
export async function instantiateInPlcPrg(fbName: string): Promise<void> {
	const PLC_PRG = await mainProgram()
	if (!PLC_PRG) return   // no main program to instantiate into — CODESYS compiles every POU regardless
	const item = await fetchItem(PLC_PRG)
	const lines = item.sourceText.split("\n")
	const endVarIdx = lines.findIndex((l: string) => l.trim() === "END_VAR")
	if (endVarIdx === -1) throw new Error(`${PLC_PRG} has no END_VAR`)
	const varName = `inst_${fbName.replace(PREFIX + "_", "")}`
	// IDEMPOTENT. `ensureCompiles` is called twice by a test that builds before AND after an edit, and a
	// second instance declaration is itself a compile error ("a local variable named 'inst_x' is already
	// defined in 'PLC_PRG'") — which the old prefix-filtered assertion could not see and the real one does.
	if (lines.some((l: string) => l.includes(`${varName} :`))) return
	lines.splice(endVarIdx, 0, `\t${varName} : ${fbName};`)
	const r = await pushOps([{
		op: "set",
		name: PLC_PRG,
		toFolder: "",
		sourceText: lines.join("\n"),
		ifVersion: item.version,
	}])
	expect(r.accepted).toBe(true)
}

/** Verify the FB compiles with zero errors. On TC (skips unreferenced POUs) an instance in the main program
 *  forces compilation; on CODESYS (compiles every POU) the instantiate no-ops and the build still reaches it.
 *
 *  THIS ASSERTION USED TO BE VACUOUS, and ~10 "and it compiles" tests rode on it. It filtered the build's
 *  diagnostics by the test-POU prefix — `JSON.stringify(d).includes(PREFIX)` — and NEITHER vendor puts an item
 *  name in a diagnostic: `BridgeDiagnostic` carries severity/message/line/column and nothing else, CODESYS fills
 *  the message from the raw compiler text (`Identifier 'Done' not defined` names no POU), and TwinCAT parses
 *  `file(line,col) : error : text` and keeps only the text, discarding the file that carried the name. So the
 *  filter matched nothing, `ours` was empty, and `expect(0).toBe(0)` passed over exactly the errors each test
 *  existed to catch — including a jump that did not compile at all (DIALECT C13).
 *
 *  It asserts ZERO ERRORS in the whole project instead, which is both simpler and stronger. That is only honest
 *  because it was measured: with every test POU removed, CodesysTestProject and TwinCAT Project14 each build
 *  0 errors / 0 warnings. So any error here is the POU under test, or one an earlier test left behind — and
 *  failing loudly on the second is a feature. If a fixture ever legitimately carries an error, snapshot the
 *  diagnostics before the push and assert the set does not GROW (`labels.test.ts` does exactly that); do not
 *  reintroduce a filter that can silently match nothing. */
export async function ensureCompiles(fbName: string): Promise<void> {
	await instantiateInPlcPrg(fbName)
	const r = await bridge.build()
	const errors = (r.diagnostics ?? []).filter((d: any) => d.severity === "error")
	if (errors.length > 0) console.warn("build errors:", JSON.stringify(errors).slice(0, 500))
	expect(errors.length, `the build reported ${errors.length} error(s) — see above`).toBe(0)
}

// ── version snapshots + delta assertions (the hash-stability spine) ───────────
export type Snapshot = { project: string; structure: string; items: Record<string, string> }
export async function snapshot(): Promise<Snapshot> {
	const r = await bridge.refs()
	return { project: r.projectVersion, structure: r.structureVersion, items: r.items }
}

/** A snapshot item's version by its FULL wire name (e.g. "VltE2E_x.fb"). */
export function snapshotItem(s: Snapshot, name: string): string | undefined {
	return s.items[name]
}

export function snapshotHas(s: Snapshot, name: string): boolean {
	return s.items[name] !== undefined
}

/**
 * Assert how a single item (by its FULL wire name) and the two aggregate versions moved between snapshots.
 *   item: "new" | "change" | "same" | "gone"
 *   project / structure: true = must change, false = must stay identical
 */
export function assertDelta(
	before: Snapshot, after: Snapshot, name: string,
	exp: { item: "new" | "change" | "same" | "gone"; project: boolean; structure: boolean },
): void {
	switch (exp.item) {
		case "new": expect(before.items[name]).toBeUndefined(); expect(after.items[name]).toBeDefined(); break
		case "change": expect(after.items[name]).toBeDefined(); expect(after.items[name]).not.toBe(before.items[name]); break
		case "same": expect(after.items[name]).toBe(before.items[name]); break
		case "gone": expect(before.items[name]).toBeDefined(); expect(after.items[name]).toBeUndefined(); break
	}
	if (exp.project) expect(after.project).not.toBe(before.project)
	else expect(after.project).toBe(before.project)
	if (exp.structure) expect(after.structure).not.toBe(before.structure)
	else expect(after.structure).toBe(before.structure)
}

/**
 * The `NETWORK … END_NETWORK` region of a source — the diagram, isolated from the declaration.
 */
export function bodyOf(src: string): string {
	const i = src.indexOf("NETWORK ")
	const j = src.lastIndexOf("END_NETWORK")
	if (i < 0 || j < 0) throw new Error(`no NETWORK block in:
${src}`)
	return src.slice(i, j + "END_NETWORK".length)
}

// Everything in a network line that is grammar rather than the engineer's program.
const NETWORK_KEYWORDS = new Set([
	"NETWORK", "END_NETWORK", "FBD", "LD", "DISABLED", "LET", "NOT", "AND", "OR", "XOR", "MOD",
	"IF", "THEN", "ELSE", "END_IF", "JMP", "RETURN", "EXECUTE", "END_EXECUTE", "TRUE", "FALSE",
])

/**
 * Every operand the engineer wrote is still in the body the repo shows back.
 *
 * <p>Round-trip assertions in this suite compare a FETCH to a later FETCH. That is a FIXED-POINT check, and a
 * fixed point is exactly what every graphical data-loss bug in this repo turned out to be: the write dropped
 * something, the read handed back the reduced body, and pushing THAT back changed nothing. Only the FIRST
 * comparison — what was pushed against what came back — can see the loss.</p>
 *
 * <p>But that comparison cannot be byte equality, because a body is legitimately normalized on the way through,
 * and MEASURED to be (CODESYS, live): a single-use `LET` is inlined, a flat `a AND b AND c` comes back fully
 * parenthesised, two coils in one LD network come back as two networks, and a created FBD body is renumbered
 * from `NETWORK 0` to `NETWORK 1` because the vendor assigns its own network ids and Volt echoes them
 * (GraphReader.SplitNetworks documents this: "a lone FBD network can legitimately be NETWORK 1"). None of that
 * is loss — the same program runs — and the fetched form is then a stable fixed point.</p>
 *
 * <p>What survives every one of those rewrites is the SET OF OPERANDS. So that is what this asserts. It catches
 * the whole measured loss class — a dropped unconsumed block, a jump’s discarded condition spine, an FB
 * instance written with `typeName=""`, a flattened accessor — while staying blind to reformatting, which is the
 * IDE’s business. Names introduced by `LET` are excluded: inlining them away is the canonicalizer doing its
 * job.</p>
 */
export function expectNoOperandsLost(pushed: string, fetched: string): void {
	const idents = (s: string): string[] =>
		(s.match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? []).filter((w) => !NETWORK_KEYWORDS.has(w.toUpperCase()))

	const body = bodyOf(pushed)
	const bound = new Set((body.match(/\bLET\s+([A-Za-z_]\w*)/g) ?? []).map((m) => m.split(/\s+/)[1]))
	const want = [...new Set(idents(body))].filter((w) => !bound.has(w))
	const got = new Set(idents(bodyOf(fetched)))

	const lost = want.filter((w) => !got.has(w))
	expect(lost, `operands lost between push and fetch — pushed:
${body}

fetched:
${bodyOf(fetched)}`).toEqual([])
}

/** The `.library` extension, spelled once. */
const LIBRARY_EXT = ".library"

/**
 * Is this item a referenced-library artefact — a `.library` ref or one of the read-only element signatures
 * rendered beside it?
 *
 * DERIVED FROM THE PAYLOAD, never matched on a folder NAME. Three separate tests each hardcoded
 * `folder.includes("Library Manager")`, which is CODESYS's name for that node — TwinCAT calls it `References` —
 * so each of them silently answered "no libraries here" on the other vendor. That was invisible while TwinCAT
 * shipped no signatures at all; the moment it did, one gate measured nothing and another read all 230 signatures
 * as project items leaking out of a fetch.
 *
 * The rule is the LIBRARY-MANAGER NODE, found as the parent the `.library` refs share. Anything at or below it is
 * a library artefact — including the deliberate `(unresolved)` bucket, which holds elements whose owning library
 * matched no ref and which are still signatures rather than project items. Pass the `changed` list of a FULL
 * fetch (the one that carries the `.library` refs); a warm fetch has none and would answer "nothing is a
 * library", which is why callers derive the roots once and reuse them.
 */
export function libraryRoots(changed: readonly any[]): string[] {
	const libFolders = changed
		.filter((i) => String(i.name ?? "").toLowerCase().endsWith(LIBRARY_EXT))
		.map((i) => String(i.folder ?? ""))
	// The manager node is each library folder's parent.
	return [...new Set(libFolders.map((f) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : f)))].filter(
		(r) => r.length > 0,
	)
}

/** Whether a folder sits at or below one of {@link libraryRoots}. */
export function inLibrary(folder: string | undefined, roots: readonly string[]): boolean {
	const f = String(folder ?? "")
	return roots.some((r) => f === r || f.startsWith(r + "/"))
}
