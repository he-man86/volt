/**
 * The tray's **Disconnect**, against a LIVE bridge. `deselect` must refuse every sync op until the next `select`
 * while tearing NOTHING down — on CODESYS the in-proc host stays loaded inside the running IDE (the
 * `start_volt_codesys.py` activation survives), on TwinCAT the worker keeps its COM attach.
 *
 * Why this needs a live bridge at all: `test/Volt.Cli.Connector.Tests/DisconnectLifecycleTests.cs` already proves
 * the GATE over real pipes with a faked IDE (and does it in CI, in milliseconds). What it cannot prove is the part
 * that only a real driver can answer — that a real IDE session survives a deselect/reselect cycle **unchanged**:
 * same process serving, same project, byte-identical version hashes, no reload, no lost edits. That is what this
 * file tests, and it is vendor-neutral: a pass on one bridge and a fail on the other is a real parity bug.
 *
 * SAFETY: every test restores service, and `afterAll` re-selects unconditionally — a crashed run must never leave
 * the engineer's bridge gated. `resume()` is idempotent, so it is safe to call when already serving.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, requireHealthy, snapshot, opErrorCode, cleanup, createItem, fetchSource, fid, BASE } from "../harness"

const DISCONNECTED = "PLC_DISCONNECTED"

/** Put the bridge back in service. Idempotent: a `select` on an already-serving bridge is a no-op rebind. */
async function resume(): Promise<void> {
	await bridge.select()
}

/** Is the bridge serving sync right now? (What `volt push` would find.) */
async function serving(): Promise<boolean> {
	return (await opErrorCode(() => bridge.refs())) === null
}

describe(`lifecycle / disconnect cycle (${BASE})`, () => {
	setDefaultTimeout(120_000) // a full build + TC COM calls are slow

	beforeAll(async () => {
		await requireHealthy()
		// Fail loudly rather than silently skipping: a bridge without `deselect` is an OLD build, and a green run
		// against it would be a lie. (This is the exact trap the stale-bundled-bridge snapshot fell into before.)
		const code = await opErrorCode(() => bridge.deselect())
		if (code !== null) throw new Error(`this bridge has no 'deselect' op (${code}) — rebuild it before running this suite`)
		await resume()
	})

	afterEach(resume) // never leave the next test (or the engineer) staring at a gated bridge
	afterAll(async () => { await resume(); await cleanup() })

	it("deselect refuses every sync op with PLC_DISCONNECTED; select resumes them", async () => {
		expect(await serving()).toBe(true)
		await bridge.deselect()

		// Every op that touches the project — the whole CLI surface (`status`/`pull`/`push`/`build`).
		expect(await opErrorCode(() => bridge.refs())).toBe(DISCONNECTED)
		expect(await opErrorCode(() => bridge.fetch({ knownItems: {} }))).toBe(DISCONNECTED)
		expect(await opErrorCode(() => bridge.push({ ops: [] }))).toBe(DISCONNECTED)
		expect(await opErrorCode(() => bridge.build())).toBe(DISCONNECTED)

		await resume()
		expect(await serving()).toBe(true)
	})

	it("while disconnected the bridge still answers health + instances — the only way back", async () => {
		await bridge.deselect()

		// health must keep answering, and must say DISCONNECTED — every frontend polls this to render its state,
		// and a health that threw (or still claimed 'connected') would leave the UI lying or blank.
		const h = await bridge.health()
		expect(h.connected).toBe(false)
		expect(h.status).toBe("unavailable")

		// instances must keep listing the project: it is what the connector offers as "Connect to", so gating it
		// would strand the user in the tray with nothing to click.
		const inst = await bridge.instances()
		expect(Array.isArray(inst.instances)).toBe(true)
		expect(inst.instances.length).toBeGreaterThan(0)
	})

	it("the IDE session survives untouched — same project, byte-identical versions after a reconnect", async () => {
		// THE live-bridge claim: nothing is torn down. If deselect dropped the IDE handle (or the host reloaded
		// the project), the version hashes would move even though no source changed.
		const before = await snapshot()
		const healthBefore = await bridge.health()

		await bridge.deselect()
		await resume()

		const after = await snapshot()
		const healthAfter = await bridge.health()
		expect(after.project).toBe(before.project)       // no churn: the project version is content-derived
		expect(after.structure).toBe(before.structure)
		expect(after.items).toEqual(before.items)        // every item, same hash
		expect(healthAfter.projectName).toBe(healthBefore.projectName)
		expect(healthAfter.ideVersion).toBe(healthBefore.ideVersion) // the SAME IDE session, not a re-attach
	})

	it("a refused push writes NOTHING — the gate runs before the IDE is touched", async () => {
		// The dangerous failure mode: a push that is refused *halfway* would leave the IDE half-updated. The gate
		// is at dispatch, before any project access, so the item must simply not exist.
		const name = fid("disc_nowrite")
		await bridge.deselect()

		const code = await opErrorCode(() =>
			bridge.push({ ops: [{ op: "set", name, toFolder: "", sourceText: "FUNCTION_BLOCK X\nEND_FUNCTION_BLOCK", ifVersion: null }] }),
		)
		expect(code).toBe(DISCONNECTED)

		await resume()
		expect((await bridge.refs()).items[name]).toBeUndefined()
	})

	it("work done before disconnecting survives it — no lost edits", async () => {
		// An engineer disconnects after a session's work. The gate must not roll anything back.
		const name = fid("disc_survives")
		const src = "FUNCTION_BLOCK VltE2E_disc_survives\nVAR\n\tkeep : INT := 42;\nEND_VAR\nEND_FUNCTION_BLOCK"
		await createItem(name, src, "")
		const versionBefore = (await bridge.refs()).items[name]

		await bridge.deselect()
		await resume()

		expect((await bridge.refs()).items[name]).toBe(versionBefore)
		expect(await fetchSource(name)).toContain("keep : INT := 42")
	})

	it("deselect and select are both idempotent", async () => {
		await bridge.deselect()
		await bridge.deselect() // a second Disconnect on an already-disconnected bridge
		expect(await serving()).toBe(false)

		await resume()
		await resume() // a second Connect on an already-connected bridge is a no-op rebind
		expect(await serving()).toBe(true)
	})

	it("an op in flight when Disconnect lands still completes — the gate stops the NEXT op, not the current one", async () => {
		// Disconnecting mid-write must never leave the IDE half-updated, so `deselect` deliberately does not abort
		// (nor wait for) a running op: it isn't wrapped in Busy() and touches no IDE state.
		const build = bridge.build({ buildType: "full" }) // the slowest op the bridge has
		await bridge.deselect() // lands while the build holds the IDE thread

		const buildResult = await build
		expect(buildResult).toBeDefined() // completed, not refused mid-flight
		expect(buildResult.diagnostics).toBeDefined()

		expect(await serving()).toBe(false) // ...and the NEXT op is refused
	})

	it("health and the sync ops never disagree about being connected", async () => {
		// The invariant every frontend depends on: what health REPORTS and what the CLI can DO are the same
		// answer. They're read over separate connections, so a split here means the UI lies in one direction or
		// the other ("connected" but every push refused, or "disconnected" while pushes land).
		for (const step of ["serving", "deselected", "resumed"] as const) {
			if (step === "deselected") await bridge.deselect()
			if (step === "resumed") await resume()
			const reportsConnected = (await bridge.health()).connected
			expect(reportsConnected).toBe(await serving())
		}
	})

	it("a concurrent reader sees the gate too — it is bridge-wide, not per connection", async () => {
		// Each op is its own pipe connection. The flag lives on the HOST, so a second client (another VS Code
		// window, the desktop app, a terminal) must be refused as well — otherwise "disconnected" would only
		// apply to whoever clicked it.
		await bridge.deselect()
		const codes = await Promise.all([
			opErrorCode(() => bridge.refs()),
			opErrorCode(() => bridge.refs()),
			opErrorCode(() => bridge.fetch({ knownItems: {} })),
		])
		expect(codes).toEqual([DISCONNECTED, DISCONNECTED, DISCONNECTED])
	})
})
