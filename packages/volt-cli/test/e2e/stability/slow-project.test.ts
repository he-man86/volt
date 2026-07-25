/**
 * READ-ONLY stability tier — most meaningful against a SLOW/large project (e.g. the committed
 * `Pro2193-94-95-96_COdesys.project`, where a single refs/fetch takes ~20s). It never writes, so it's safe to run
 * against any real fixture without mutating it, and it's idempotent.
 *
 * What "stable" means here, and what each assertion guards:
 *  - Hash stability: repeated `refs` on an UNCHANGING project return byte-identical projectVersion + structureVersion.
 *    Spurious churn there would bounce `volt status`/pull into false "the IDE changed" every poll.
 *  - Health never serializes behind a long op: while a slow `refs` holds the one IDE thread, `health` still answers
 *    fast and stays `healthy` (the honest-health cache) — a busy IDE must not read as a lost connection.
 *  - The heavy ops COMPLETE and agree: `fetch` returns the same item set `refs` listed; `build` returns a verdict;
 *    nothing throws, nothing flips the bridge to `degraded` across the whole run.
 *
 * Run against the large project (from packages/volt-cli), after `codesys-pipe.ps1 up -Project <the .project>`:
 *   VOLT_PIPE=volt.bridge.codesys.<pid> bun test test/e2e/stability --timeout 120000
 */
import { test, expect, beforeAll } from "bun:test"
import { bridge, healthStatus, BASE } from "../harness"

// Each heavy op can take ~20s on a large project; give the suite room (override with --timeout too).
const OP_TIMEOUT = 120_000

let baseline: { project: string; structure: string; count: number }

beforeAll(async () => {
	const r = await bridge.refs()
	baseline = { project: r.projectVersion, structure: r.structureVersion, count: Object.keys(r.items ?? {}).length }
	expect(baseline.count).toBeGreaterThan(0) // a real project has items — guards a mis-pointed pipe
}, OP_TIMEOUT)

test(`${BASE}: repeated refs on an unchanging project are hash-stable`, async () => {
	// Three refs back-to-back — an unchanged project must produce the SAME versions each time (no spurious churn).
	for (let i = 0; i < 3; i++) {
		const r = await bridge.refs()
		expect(r.projectVersion).toBe(baseline.project)
		expect(r.structureVersion).toBe(baseline.structure)
		expect(Object.keys(r.items ?? {}).length).toBe(baseline.count)
	}
}, OP_TIMEOUT)

test(`${BASE}: health stays healthy and fast while a long refs holds the IDE thread`, async () => {
	// Fire the slow refs WITHOUT awaiting, then poll health concurrently — it must answer well under any op time and
	// never report degraded (the in-flight op is a live link, served from cache off the IDE thread).
	const slow = bridge.refs()
	const latencies: number[] = []
	for (let i = 0; i < 5; i++) {
		const t0 = performance.now()
		const h = await bridge.health()
		latencies.push(performance.now() - t0)
		expect(healthStatus(h)).toBe("healthy")
		await Bun.sleep(300)
	}
	await slow // the long op still completes cleanly
	// No single health poll should have taken anywhere near an op's time — cap generously (the real number is ~ms).
	expect(Math.max(...latencies)).toBeLessThan(2000)
}, OP_TIMEOUT)

test(`${BASE}: a full fetch's index agrees with refs (and changed carries the library-signature fold)`, async () => {
	// The INDEX the two heavy read paths agree on is the `items` MAP — fetch.items must equal refs.items byte-for-byte
	// (same names, same versions). That is the sync-critical invariant: status/push key off this index.
	const refs = await bridge.refs()
	const fetched = await bridge.fetch({ knownItems: {} })
	const refNames = Object.keys(refs.items ?? {})
	const fetchItemNames = Object.keys(fetched.items ?? {})
	expect(fetchItemNames.length).toBe(refNames.length)
	for (const n of refNames) expect(fetched.items[n]).toBe(refs.items[n])

	// `changed[]` is the MATERIALIZATION payload, not the index — on a full fetch it additionally carries the
	// referenced-library element SIGNATURES (read-only LSP stubs, foldered under each library), which refs does not
	// index. So changed ⊇ items, and any surplus is a library-foldered signature — never an un-indexed project item.
	const changed = (fetched.changed ?? []) as any[]
	const indexNames = new Set(refNames)
	const surplusOutsideLibraries = changed.filter(i => !indexNames.has(i.name) && !(i.folder || "").includes("Library Manager"))
	expect(surplusOutsideLibraries).toEqual([]) // every non-indexed changed item is a library signature, nothing leaks
}, OP_TIMEOUT)

test(`${BASE}: build completes with a verdict and leaves the bridge healthy`, async () => {
	const r = await bridge.build()
	expect(Array.isArray(r.diagnostics)).toBe(true) // a verdict came back (errors, if any, are the project's own)
	expect(healthStatus(await bridge.health())).toBe("healthy") // the heavy op didn't drop/degrade the channel
}, OP_TIMEOUT)
