/**
 * THE PROJECT AS A TEST SUBJECT — naming, readiness, item CRUD and cleanup.
 *
 * <p>Everything here speaks FULL wire names. The wire is keyed by `name.kind` (`CM_Carrier.fb`) everywhere —
 * `refs`, `fetch`, every push op — so the suite does no bare↔full resolution anywhere. `id()` is the bare IEC
 * identifier that goes INSIDE source text; `fid()` is the full name every op and lookup uses.</p>
 */
import { expect } from "bun:test"
import { bridge, healthStatus } from "./bridge"

/** Every item this suite creates is named `VltE2E_*`, which is what makes an unattended sweep safe. */
export const PREFIX = "VltE2E"
/** The default sub-folder new items are created in, under the PLC-project root. */
export const FOLDER = "POUs"

export function id(s: string): string {
	return `${PREFIX}_${s}`
}

/** The FULL wire name: IEC name + KIND extension. A POU is named by kind — default `.fb`; pass
 *  `prg`/`fun`/`itf`/`dut`/`gvl` for others. Every DUT is the one wire kind `dut`; the four file extensions
 *  (`.struct`/`.enum`/`.union`/`.alias`) are a materialization concern the wire never sees. */
export function fid(s: string, ext = "fb"): string {
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
	if (project) console.log(`[e2e] serving project: ${project}`)
}

let swept = false
async function sweepOnce(): Promise<void> {
	if (swept) return
	swept = true
	try {
		const refs = await bridge.refs()
		const stale = Object.keys(refs.items ?? {}).filter((n) => n.startsWith(PREFIX))
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
	const t0 = Date.now()
	let lastProject: string | undefined
	while (Date.now() - t0 < timeoutMs) {
		const h = await bridge.health().catch(() => ({ projects: [] }))
		if (healthStatus(h) === "healthy") {
			// SAY WHICH PROJECT, not just which pipe. `ide.ps1 up` opens TWO XAE windows and discovery takes the
			// first live pipe by name — i.e. by pid string order — so which project a run measures is not
			// something the run chooses, and the two are not interchangeable. It has cost real time twice: the
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

/** Push ops behind a fresh `expectedProjectVersion` guard, and hand back the receipt for the caller to assert on. */
export async function pushOps(ops: unknown[]): Promise<any> {
	const r = await bridge.push({ expectedProjectVersion: (await bridge.refs()).projectVersion, ops })
	if (!r.accepted) console.warn("push rejected:", JSON.stringify(r.conflicts || r).slice(0, 200))
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
		.filter((n) => n.startsWith(PREFIX))
		.map((n) => ({ op: "deleteItem", name: n, ifVersion: refs.items[n] }))
	if (ops.length === 0) return
	const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops })
	if (!r.accepted)
		throw new Error(`cleanup could not delete ${ops.length} item(s): ${JSON.stringify(r.conflicts).slice(0, 300)}`)
}

/**
 * Delete ONE item by full wire name, whether or not it exists.
 *
 * <p>Four files hand-rolled this — `create-shapes`, `unresolved-marker`, `comments` and `fanout` each carried a
 * private `clean()` with the same `items[name] ?? "UNREADABLE000000"` sentinel — because the harness offered only
 * a prefix-wide sweep. The sentinel is load-bearing: an item that was accepted but is NOT enumerable in `refs`
 * (the TwinCAT bug `items/child-roundtrip-parity` exists for) has no readable version, and a delete still has to
 * reach it. A delete of something already gone is an accepted no-op by contract, so this is safe to call blind.</p>
 */
export async function removeItem(name: string): Promise<void> {
	const refs = await bridge.refs()
	await bridge.push({
		expectedProjectVersion: refs.projectVersion,
		ops: [{ op: "deleteItem", name, ifVersion: (refs.items ?? {})[name] ?? "UNREADABLE000000" }],
	})
}

// ── the PLC-project spine, derived rather than hardcoded ──────────────────────

/**
 * The wire folder is the FULL tree path from the project root, so it carries each vendor's structural spine:
 * CODESYS `Device/Plc Logic/Application`, TwinCAT `""` (its walk starts at the PLC project). Tests never hardcode
 * that spine — they derive it from the main program, which lives at the PLC-project root, so the SAME assertion
 * holds on either bridge.
 */
let _plcRoot: string | null = null
async function plcRoot(): Promise<string> {
	if (_plcRoot !== null) return _plcRoot
	const main = await mainProgram()
	if (main) return (_plcRoot = (await fetchItem(main)).folder ?? "")
	// No standard main program (a library project): probe by creating a throwaway at the root, reading its
	// resolved folder, then deleting it.
	const probe = fid("__plcroot_probe__")
	await pushOps([{ op: "set", name: probe, toFolder: "", sourceText: "FUNCTION_BLOCK X\n(* @volt-implementation *)\nEND_FUNCTION_BLOCK", ifVersion: null }])
	const root = (await fetchItem(probe)).folder ?? ""
	await removeItem(probe)
	return (_plcRoot = root)
}

/** A full wire folder path under the PLC-project root: `plcFolder("POUs/Sub")` → e.g. `Device/Plc Logic/Application/POUs/Sub`. */
export async function plcFolder(sub = ""): Promise<string> {
	const root = await plcRoot()
	return sub ? (root ? `${root}/${sub}` : sub) : root
}

/**
 * The project's main/entry program — the POU that FB instances are added to so the compiler reaches them.
 * CODESYS default-names it `PLC_PRG`, TwinCAT `MAIN`; resolved from `refs` rather than hardcoded so the same
 * suite runs against either vendor's default project.
 */
let _mainProgram: string | null = null
export async function mainProgram(): Promise<string | null> {
	if (_mainProgram !== null) return _mainProgram || null
	const items = Object.keys((await bridge.refs()).items ?? {})
	const prgs = items.filter((n) => n.endsWith(".prg") && !n.startsWith(PREFIX))
	const preferred = prgs.find((n) => /^(PLC_PRG|MAIN)\./i.test(n)) ?? prgs[0] ?? ""
	_mainProgram = preferred
	return preferred || null
}

// ── item CRUD ─────────────────────────────────────────────────────────────────

/** Create a NEW item. `folder` is a FULL wire path (default: `POUs` under the PLC-project root); `""` places it
 *  at the PLC-project root. */
export async function createItem(name: string, src: string, folder?: string): Promise<any> {
	const toFolder = folder === undefined ? await plcFolder(FOLDER) : folder
	const r = await pushOps([{ op: "set", name, toFolder, sourceText: src, ifVersion: null }])
	expect(r.accepted, `create '${name}' refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
	return r
}

/** Update an item's content in place, guarded with its current version. Pass `folder` only to MOVE it. */
export async function updateItem(name: string, src: string, folder?: string): Promise<any> {
	const v = (await bridge.refs()).items[name] ?? null
	const op: Record<string, unknown> = { op: "set", name, sourceText: src, ifVersion: v }
	if (folder !== undefined) op.toFolder = folder
	const r = await pushOps([op])
	expect(r.accepted, `update '${name}' refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
	return r
}

/** Fetch one item by full wire name. Throws when it is absent — an item the test just created and cannot read
 *  back is a finding, not a `undefined` to branch on. */
export async function fetchItem(name: string): Promise<any> {
	const f = await bridge.fetch({ knownItems: {}, onlyItems: [name] })
	const it = f.changed.find((i: any) => i.name === name)
	if (!it) throw new Error(`item '${name}' not in fetch`)
	return it
}

export async function fetchSource(name: string): Promise<string> {
	return (await fetchItem(name)).sourceText
}

/** The current version of an item, or null when it is not enumerable. */
export async function versionOf(name: string): Promise<string | null> {
	return (await bridge.refs()).items?.[name] ?? null
}
