/**
 * WIRE LATENCY — a floor under the bridge, so a performance regression fails as a performance regression.
 *
 * <p>The house rule is that a timeout is a bug, not a budget: when a test starts timing out, the answer is to
 * root-cause it, never to raise the ceiling. That rule had nothing to enforce it. A change that made `refs` ten
 * times slower would not fail any test — it would make the whole suite slower, and the first visible symptom
 * would be an unrelated test timing out somewhere else, which is exactly the signal the rule says to distrust.
 * This test makes the bridge's own cost the thing that fails.</p>
 *
 * <h3>Measured baselines (2026-08-26, both live IDEs, medians of 9)</h3>
 * <pre>
 *                        CODESYS   TwinCAT
 *   health                   1 ms      1 ms
 *   refs (whole project)    27 ms     34 ms
 *   fetch 1 item            28 ms     35 ms
 *   fetch ALL               82 ms     35 ms      (CODESYS: 27 project items + 566 library signatures)
 * </pre>
 *
 * <p><b>The ceilings are ~10× those numbers, deliberately.</b> This is a smoke alarm, not a stopwatch: it should
 * catch "someone made refs do a full project walk per item" and stay silent through ordinary variance on a busy
 * developer machine. A tight bound here would flake, get muted, and then catch nothing — the exact failure mode
 * the DIALECT citation check was designed around. If a real regression lands, the fix is the regression.</p>
 *
 * <p><b>What this does NOT cover, and why it would be measuring the wrong thing:</b> the CLI. `volt status` takes
 * ~490 ms against both vendors, and almost none of it is the bridge — `volt status --local`, which never opens
 * the pipe, costs 447 ms of that, and `volt --version` alone is 37 ms. The rest is git subprocesses at 25–37 ms
 * each. So a CLI-level ceiling would mostly be asserting how fast `git.exe` starts on this machine, and would
 * move with the git version rather than with anything in this repo.</p>
 */
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, requireHealthy, BASE } from "../harness"

setDefaultTimeout(60000)

/** Median of `n` timed runs, after one warm-up. The median — not the mean — because a single scheduler hiccup
 *  on a developer machine skews a mean badly and is exactly the noise this must not fire on. */
async function medianMs(fn: () => Promise<unknown>, n = 7): Promise<number> {
	await fn()
	const s: number[] = []
	for (let i = 0; i < n; i++) {
		const t0 = performance.now()
		await fn()
		s.push(performance.now() - t0)
	}
	return s.sort((x, y) => x - y)[Math.floor(n / 2)]
}

describe(`stability / wire latency (${BASE})`, () => {
	let itemCount = 0
	let firstItem = ""

	beforeAll(async () => {
		await requireHealthy()
		const r = await bridge.refs()
		const names = Object.keys(r.items)
		itemCount = names.length
		firstItem = names[0]
	})

	it("health is effectively free — it is polled on a timer by the connector", async () => {
		// The connector probes this continuously while the tray is open. Anything that made it do real work
		// would burn CPU forever in the background, where nobody is watching a test clock.
		const ms = await medianMs(() => bridge.health(), 9)
		console.log(`      health: ${ms.toFixed(0)} ms (baseline ~1 ms)`)
		expect(ms).toBeLessThan(150)
	})

	it("refs stays cheap — every status, pull and push begins with one", async () => {
		const ms = await medianMs(() => bridge.refs())
		console.log(`      refs: ${ms.toFixed(0)} ms for ${itemCount} items (baseline 27–34 ms)`)
		expect(ms).toBeLessThan(500)
	})

	it("fetching ONE item does not cost a whole-project fetch", async () => {
		// The property that matters more than the absolute number: `onlyItems` must be a real narrowing. If a
		// single-item fetch ever costs what a full one does, `volt pull` of one changed file silently became
		// O(project), and on a large project that is the difference between a second and a minute.
		const one = await medianMs(() => bridge.fetch({ knownItems: {}, onlyItems: [firstItem] }))
		const all = await medianMs(() => bridge.fetch({ knownItems: {} }), 3)
		console.log(`      fetch 1: ${one.toFixed(0)} ms · fetch all: ${all.toFixed(0)} ms (${itemCount} items)`)
		expect(one).toBeLessThan(500)
		// Only meaningful when the project is big enough for the two to differ at all; the TwinCAT fixture has
		// 7 items, where one item IS most of the project and the ratio says nothing.
		if (itemCount >= 20) expect(one).toBeLessThan(all)
	})

	it("a no-op push is not more expensive than a read", async () => {
		// Pushing zero ops still runs the precondition path — version check, project resolve. It is the floor
		// under every write, and it should be a read's worth of work, not a write's.
		const refs = await bridge.refs()
		const ms = await medianMs(() => bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [] }), 5)
		console.log(`      empty push: ${ms.toFixed(0)} ms`)
		expect(ms).toBeLessThan(500)
	})
})
