/**
 * THE PROJECT AS A TEST SUBJECT — naming, readiness, item CRUD and cleanup.
 *
 * <p>The wire keys an item by its PATH in the IDE's tree (`Device/Plc Logic/Application/POUs/CM_Carrier.pou`) —
 * `refs`, `fetch`, every push op (openspec `multi-application-tree`). `id()` is the bare IEC identifier that goes INSIDE
 * source text; `fid()` is the item's FILE name (`name.kind`). The helpers here take a file name or a path: a file name is
 * the one item `refs` holds under it (`pathIn` — two are refused by name), and a create places it in a folder. A test
 * that sends its own ops spells each item by path (`at`, `pathOf`, `pathIn`).</p>
 */
import { expect } from "bun:test"
import { bridge, healthStatus } from "./bridge"
import { appendFileSync } from "node:fs"
import { currentPipe, VENDOR } from "./pipe"
import { e2eReport, FixtureRefusal, ideLine, pipeBitness } from "./fixture-ide"
import { drivenApplication, fileOf, folderOf, inFolder, pathIn } from "./main-program"

export { fileOf, folderOf, inFolder, pathIn }

/** Every item this suite creates is named `VltE2E_*`, which is what makes an unattended sweep safe. */
export const PREFIX = "VltE2E"
/** The default sub-folder new items are created in, under the PLC-project root. */
export const FOLDER = "POUs"

export function id(s: string): string {
	return `${PREFIX}_${s}`
}

/** The FULL wire name: IEC name + KIND extension. A POU is `.pou` whatever its text says (the default); pass
 *  `itf`/`gvl`/`dut` for others. The name is the engine's, which is also the workspace file's name. */
export function fid(s: string, ext = "pou"): string {
	return `${id(s)}.${ext}`
}

// ── readiness ─────────────────────────────────────────────────────────────────

/**
 * ONE sweep of leftover `VltE2E_*` items per process, before any test runs.
 *
 * <p>Per-test cleanup runs in `afterEach`/`afterAll` — exactly where it does NOT run when a test TIMES OUT or the
 * runner is interrupted. Whatever that run created stays in the project and the next run starts against it. That
 * is a cascade, not a one-off: leftovers make more tests fail, more failures skip more cleanup, and the count
 * climbs run over run until someone restores the fixture by hand.</p>
 *
 * <p>It is a MEASURED cascade, twice. `unify-item-pipeline` recorded "the same reverted code gave 3, then 8, then
 * 0 failures depending only on how used the project copy was"; on 2026-09-03 four runs gave 4, 1, 2 and 7, while a
 * run from a restored fixture gives 159/1 every time.</p>
 */
/** The project the bridge is serving, printed ONCE — see the note in `requireHealthy`. */
let announced = false
function announceProject(health: any): void {
	if (announced) return
	announced = true
	const project = (health?.projects ?? []).find((p: any) => p?.project)?.project
	if (!project) return
	// WHICH IDE the run measured, not only which project (environment-dependency-audit 2.6): the dev machine runs the
	// same CODESYS version 64- and 32-bit, and a matrix cell is the platform version x bitness the run actually drove.
	const pipe = currentPipe()
	// The bitness is read from the IDE process's modules, which a non-elevated reader is DENIED for an IDE run as
	// administrator (gate 2c+3 review): that is named on the line and the run goes on — the line is a log. Only a run
	// that must REPORT what it drove (the matrix) refuses on it, in e2eReport.
	let bits: 32 | 64 | FixtureRefusal
	try { bits = pipeBitness(pipe, VENDOR) } catch (e) { if (!(e instanceof FixtureRefusal)) throw e; bits = e }
	console.log(`[e2e] serving project: ${project} — ${ideLine(health ?? {}, bits)} (${pipe})`)
	// The release matrix (scripts/release-matrix.ts) reads what each run drove from here, one JSON line per process.
	const report = process.env.VOLT_E2E_REPORT
	if (report) appendFileSync(report, JSON.stringify(e2eReport(VENDOR, project, pipe, health ?? {}, bits)) + "\n")
}

let swept = false
async function sweepOnce(): Promise<void> {
	if (swept) return
	swept = true
	try {
		const refs = await bridge.refs()
		const stale = Object.keys(refs.items ?? {}).filter((n) => fileOf(n).startsWith(PREFIX))
		if (stale.length === 0) return
		console.warn(
			`[e2e] ${stale.length} item(s) left by a previous run — sweeping before starting: ` +
				stale.slice(0, 8).join(", ") +
				(stale.length > 8 ? ` (+${stale.length - 8} more)` : ""),
		)
		await bridge.push({
			expectedProjectVersion: refs.projectVersion,
			ops: stale.map((n) => ({ op: "deleteItem", name: n, ifVersion: refs.items[n] })),
		})
	} catch {
		// Best-effort: the bridge may not be serving on the very first call, and failing here would turn a hygiene
		// measure into the thing that stops the suite running at all.
	}
}

/**
 * Ensure the bridge is SERVING a project before a suite runs.
 *
 * <p>CODESYS serves its loaded project by default; a TwinCAT XAE worker starts every project `idle` and must be
 * told which to serve. So this selects the first detected project and waits for it to go healthy, retrying across
 * an IDE that is still loading or a pipe that just changed pid. Vendor-agnostic — on CODESYS the select is a
 * harmless re-confirm.</p>
 */
export async function requireHealthy(timeoutMs = 60_000): Promise<void> {
	// Resolve FIRST, outside the retry: a refusal ("no fixture IDE for instance X; refusing to touch …") is not a
	// still-loading IDE, and swallowing it into the loop below would turn it into a minute-long wait and a message
	// that names neither the instance nor the foreign pipes it refused.
	currentPipe()
	const t0 = Date.now()
	let lastProject: string | undefined
	while (Date.now() - t0 < timeoutMs) {
		const h = await bridge.health().catch(() => ({ projects: [] }))
		if (healthStatus(h) === "healthy") {
			// SAY WHICH PROJECT, not just which pipe. `ide.ps1 up` opens TWO XAE windows and the harness drives
			// the first of the instance's fixture pipes by name — i.e. by pid string order — so which project a run
			// measures is not something the run chooses, and the two are not interchangeable. It has cost real time twice: the
			// latency baselines were recorded on the smaller one and read 8x worse on the larger, and the two
			// disagree about where the PLC root is, so the default `POUs` folder resolved to `POUs/POUs` and
			// fifty-eight tests failed with a vendor path error that named neither cause.
			announceProject(h)
			await sweepOnce()
			return
		}
		lastProject = (h.projects ?? [])[0]?.project as string | undefined
		if (lastProject) await bridge.connect({ project: lastProject }).catch(() => {})
		await new Promise((r) => setTimeout(r, 1500))
	}
	throw new Error(
		lastProject
			? `bridge never served '${lastProject}' (selected it but it stayed idle — is the IDE still loading, or is the worker crashing?)`
			: `no project detected on the bridge (open the IDE + its project; for TwinCAT run scripts/ide.ps1 up -Vendor twincat)`,
	)
}

// ── pushing ───────────────────────────────────────────────────────────────────

/**
 * Did a push land IN FULL — every op of it in the IDE?
 *
 * <p>`accepted` alone does not say so (openspec `push-keeps-what-landed`): when the live IDE refuses an op after
 * earlier ops landed, the push stops there and answers `accepted: true` with the receipt PLUS one conflict per op
 * that did not land (the refused op with its code, each later op `NOT_ATTEMPTED`). A multi-op test that tells a
 * refusal by `accepted` alone reads such a push as "the vendor took it". A full push carries no `conflicts` (the
 * wire omits it), so absent or empty is "none".</p>
 */
export function landedInFull(r: { newProjectVersion?: string; conflicts?: readonly unknown[] }): boolean {
	return typeof r.newProjectVersion === "string" && (r.conflicts ?? []).length === 0
}

/** Did anything of a push land? `newProjectVersion` is present exactly then (openspec `wire-final-shape`). */
export function landed(r: { newProjectVersion?: string }): boolean {
	return typeof r.newProjectVersion === "string"
}

/** Push ops behind an `expectedProjectVersion` guard — the one a `refs` the caller just read answered, else a fresh
 *  one — and hand back the receipt for the caller to assert on. */
export async function pushOps(ops: unknown[], projectVersion?: string): Promise<any> {
	const r = await bridge.push({ expectedProjectVersion: projectVersion ?? (await bridge.refs()).projectVersion, ops })
	if (!landedInFull(r))
		console.warn(landed(r) ? "push landed in part:" : "push rejected:", JSON.stringify(r.conflicts || r).slice(0, 200))
	return r
}

// ── cleanup ───────────────────────────────────────────────────────────────────

/**
 * Delete every `VltE2E_*` item. THROWS if the delete was refused.
 *
 * <p>It used to `console.warn` and return, so a cleanup that silently failed left the project dirty and the test
 * still went green — feeding the very cascade `sweepOnce` documents. A failed cleanup poisons every test after it,
 * so it is a failure, and the run should say so at the point it happened rather than three files later.</p>
 */
export async function cleanup(): Promise<void> {
	const refs = await bridge.refs()
	if (!refs.items) return
	const ops = Object.keys(refs.items)
		.filter((n) => fileOf(n).startsWith(PREFIX))
		.map((n) => ({ op: "deleteItem", name: n, ifVersion: refs.items[n] }))
	if (ops.length === 0) return
	const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops })
	if (!landedInFull(r))
		throw new Error(`cleanup could not delete ${ops.length} item(s): ${JSON.stringify(r.conflicts).slice(0, 300)}`)
}

/**
 * Delete ONE item — by path, or by its file name — whether or not it exists.
 *
 * <p>A listed item is deleted at its version. An item that is held but NOT enumerable in `refs` (the TwinCAT bug
 * `items/child-roundtrip-parity` exists for) has no readable version, so its delete quotes none — at the path
 * `refs.unreadable` names it by (`<folder>/<name>.<kind>`). An item that is neither listed nor unreadable is gone
 * already: nothing is sent.</p>
 */
export async function removeItem(name: string): Promise<void> {
	const refs = await bridge.refs()
	const items = refs.items ?? {}
	const listed = pathIn(items, name, refs.applications)
	const unreadable: string[] = (refs.unreadable ?? [])
		.map((u: { name: string }) => u.name)
		.filter((u: string) => (name.includes("/") ? u === name : fileOf(u) === fileOf(name)))
	if (listed === undefined && unreadable.length > 1)
		throw new Error(`'${name}' is unreadable under ${unreadable.length} folders (${unreadable.join(", ")}) — name one by its path`)
	const path = listed ?? (unreadable.length === 1 ? unreadable[0] : undefined)
	if (path === undefined) return
	await bridge.push({
		expectedProjectVersion: refs.projectVersion,
		ops: [{ op: "deleteItem", name: path, ifVersion: items[path] }],
	})
}

// ── the PLC-project spine, derived rather than hardcoded ──────────────────────

/**
 * The wire folder is the FULL tree path from the project root, so it carries each vendor's structural spine:
 * CODESYS `Device/Plc Logic/Application`, TwinCAT `<system>/PLC/<plc project>`. Tests never hardcode that spine — they
 * derive it from the main program, which lives at the PLC-project root, so the SAME assertion holds on either bridge.
 * A project with no main program (a library project) is rooted at its one application.
 */
let _plcRoot: string | null = null
async function plcRoot(): Promise<string> {
	if (_plcRoot !== null) return _plcRoot
	const main = await mainProgram()
	return (_plcRoot = main ? folderOf(main) : await applicationRoot())
}

/** The root of the application the suite drives (`drivenApplication`: the first the served project states):
 *  CODESYS's `Device/Plc Logic/Application`, TwinCAT's PLC project. Where a move starts that must stay in its
 *  application. Every CodesysTestProject fixture also carries a second device; `multi-application` covers it. A project
 *  stating none is refused by name. */
export async function applicationRoot(): Promise<string> {
	const driven = drivenApplication(await applications())
	if (driven === null) throw new Error("the served project states no application — this suite drives one")
	return driven
}

/**
 * The project's own ROOT, for a top-level create: CODESYS's tree root (the POU pool, `""`), TwinCAT's PLC project (its
 * tree root holds system projects, where no POU can be created).
 */
export async function projectRoot(): Promise<string> {
	return VENDOR === "codesys" ? "" : await applicationRoot()
}

/** An item's version in a `refs` answer — by path, or by its file name (`pathIn`) — or undefined when it holds none. */
export function itemIn(refs: { items?: Record<string, string>; applications?: readonly string[] }, name: string): string | undefined {
	const items = refs.items ?? {}
	const path = pathIn(items, name, refs.applications)
	return path === undefined ? undefined : items[path]
}

/** Where an upsert of `file` lands: the path `items` holds it under, or — not there yet — the project's own root. */
export async function existingOrAtRoot(items: Record<string, unknown>, file: string): Promise<string> {
	return pathIn(items, file) ?? inFolder(await projectRoot(), file)
}

/** The path of `file` in `folder` — the default folder (`POUs` under the PLC-project root) when none is given. */
export async function at(file: string, folder?: string): Promise<string> {
	return inFolder(folder === undefined ? await plcFolder(FOLDER) : folder, fileOf(file))
}

/** The applications the served project states, read once: a suite never adds or removes one. */
let _applications: string[] | undefined
export async function applications(): Promise<string[]> {
	return (_applications ??= (await bridge.refs()).applications ?? [])
}

/** The path `refs` holds `name` under (a path, or a file name — `pathIn`). Throws when it holds none. */
export async function pathOf(name: string): Promise<string> {
	const refs = await bridge.refs()
	const path = pathIn(refs.items ?? {}, name, refs.applications)
	if (path === undefined) throw new Error(`'${name}' is not in refs`)
	return path
}

/** A full wire folder path under the PLC-project root: `plcFolder("POUs/Sub")` → e.g. `Device/Plc Logic/Application/POUs/Sub`. */
export async function plcFolder(sub = ""): Promise<string> {
	const root = await plcRoot()
	if (!sub) return root
	if (!root) return sub
	// NEVER DOUBLE A SEGMENT THE ROOT ALREADY ENDS WITH.
	//
	// `plcRoot` is the MAIN program's own folder, and in a project whose main program lives in `POUs` the root
	// IS `POUs` — so the default `plcFolder(FOLDER)` asked for `POUs/POUs`, a folder no fixture has. TwinCAT
	// answered `CreateChild failed: Could not find a part of the path ...\POUs\POUs\X.TcPOU`, which names
	// neither the doubling nor the harness.
	//
	// It passed for months on LITTER. Per-test cleanup deletes ITEMS and leaves FOLDERS (D34), so the first run
	// against a project created `POUs/POUs` on its way to failing, and every run after it found the folder
	// already there and passed. A fresh `ide.ps1 up` is what exposes it — which is exactly the shape of bug
	// that reads as "the IDE is flaky": it appears only after the one action that makes everything else clean.
	//
	// Asking for "the POUs folder under the PLC root" when the root IS POUs means that folder, not one inside
	// it, so this is the answer rather than a workaround for one.
	// MERGE THE OVERLAP: the longest suffix of the root that is also a prefix of `sub`. `POUs` + `POUs` is
	// `POUs`, and `POUs` + `POUs/Sub` is `POUs/Sub` — the callers that ask for a nested folder spell the whole
	// path from the PLC project, and a project whose main program already lives in `POUs` would otherwise get
	// `POUs/POUs/Sub`. An exact-match check was not enough for those.
	const rootParts = root.split("/").filter(Boolean)
	const subParts = sub.split("/").filter(Boolean)
	let overlap = Math.min(rootParts.length, subParts.length)
	while (overlap > 0 && !rootParts.slice(-overlap).every((p, i) => p === subParts[i])) overlap--
	return [...rootParts, ...subParts.slice(overlap)].join("/")
}

/**
 * The project's main/entry program — its PATH — the POU that FB instances are added to so the compiler reaches them.
 * CODESYS default-names it `PLC_PRG`, TwinCAT `MAIN`; found in `refs` by file name rather than hardcoded so the same
 * suite runs against either vendor's default project. In a project of several applications it is the driven one's
 * (`drivenApplication`); two left there are refused by name.
 */
let _mainProgram: string | null = null
export async function mainProgram(): Promise<string | null> {
	if (_mainProgram !== null) return _mainProgram || null
	const refs = await bridge.refs()
	// Every POU is `X.pou` (push-without-header-check 5.Q), so the entry program is found by its vendor default name.
	const all = Object.keys(refs.items ?? {}).filter((n) => /^(PLC_PRG|MAIN)\.pou$/i.test(fileOf(n)))
	const driven = drivenApplication(refs.applications)
	const found = all.length > 1 && driven !== null ? all.filter((n) => n.startsWith(`${driven}/`)) : all
	if (found.length > 1 || (all.length > 1 && found.length === 0))
		throw new Error(`the project holds ${all.length} main programs (${all.join(", ")}) — none is the one main program of its first application`)
	_mainProgram = found[0] ?? ""
	return _mainProgram || null
}

// ── item CRUD ─────────────────────────────────────────────────────────────────

/** Create a NEW item: `name` is a path, or a file name placed in `folder` (a FULL wire path; default `POUs` under the
 *  PLC-project root; `projectRoot()` is the project's own root). Answers the push receipt. */
export async function createItem(name: string, src: string, folder?: string): Promise<any> {
	const path = folder === undefined && name.includes("/") ? name : await at(name, folder)
	const r = await pushOps([{ op: "set", name: path, sourceText: src, ifVersion: null }])
	expect(landed(r), `create '${path}' refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
	return r
}

/** Update an item's content in place, guarded with its current version. Pass `folder` only to MOVE it there. */
export async function updateItem(name: string, src: string, folder?: string): Promise<any> {
	const refs = await bridge.refs()
	const path = pathIn(refs.items ?? {}, name, refs.applications)
	if (path === undefined) throw new Error(`update '${name}': not in refs`)
	const op: Record<string, unknown> = { op: "set", name: path, sourceText: src, ifVersion: refs.items[path] }
	if (folder !== undefined) op.to = inFolder(folder, fileOf(path))
	const r = await pushOps([op], refs.projectVersion)
	expect(landed(r), `update '${path}' refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
	return r
}

/** Fetch one item — by path, or by its file name. Throws when it is absent: an item the test just created and cannot
 *  read back is a finding, not an `undefined` to branch on. The answer carries `folder`, its path's folder. */
export async function fetchItem(name: string): Promise<any> {
	// `refs` first, for a path too: an item `fetch` serves and `refs` leaves out is one the CLI reads as deleted, and this
	// is the check every create-then-read in the suite makes of it (volt-cli-rework 3.1b review).
	const path = await pathOf(name)
	const f = await bridge.fetch({ knownItems: {}, onlyItems: [path] })
	const it = f.changed.find((i: any) => i.name === path)
	if (!it) throw new Error(`item '${path}' not in fetch`)
	return { ...it, folder: folderOf(path) }
}

/**
 * Read one item a `refs` ALREADY NAMED (the main program, found in `refs` by `mainProgram`) with `fetch` alone, for the
 * harness's setup and restore reads. The answer's own `items` must still list it, and its `projectVersion` — the
 * same walk's lease — guards a write that follows at once. Not for a create-then-read: `fetchItem` keeps its `refs`
 * check for those (volt-cli-rework 3.1b). Each call saves the `refs` a `fetchItem` plus a version-less `pushOps` cost.
 */
export async function fetchKnown(path: string): Promise<{ item: any; projectVersion: string }> {
	const f = await bridge.fetch({ knownItems: {}, onlyItems: [path] })
	if (!(path in (f.items ?? {}))) throw new Error(`'${path}' is not in the items its own fetch answered`)
	const it = f.changed.find((i: any) => i.name === path)
	if (!it) throw new Error(`item '${path}' not in fetch`)
	if (typeof f.projectVersion !== "string" || f.projectVersion === "") throw new Error(`fetch of '${path}' answered no projectVersion`)
	return { item: { ...it, folder: folderOf(path) }, projectVersion: f.projectVersion }
}

export async function fetchSource(name: string): Promise<string> {
	return (await fetchItem(name)).sourceText
}

/** The current version of an item — by path, or by its file name — or null when it is not enumerable. */
export async function versionOf(name: string): Promise<string | null> {
	const refs = await bridge.refs()
	const items = refs.items ?? {}
	const path = pathIn(items, name, refs.applications)
	return path === undefined ? null : items[path]
}
