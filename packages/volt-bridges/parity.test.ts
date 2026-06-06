/**
 * Cross-bridge parity test (TC ↔ CODESYS).
 *
 * Asserts that the seven contracts the agent depends on hold the SAME
 * way on both bridges. The point is not equal hashes (each vendor
 * computes its own projectVersion + item versions); the point is equal
 * BEHAVIOUR. If we add a contract on one side we have to add it on the
 * other, and this test catches the silent drift if we don't.
 *
 * Promoted from `scratch/bridge-parity.mjs`. The scratch script is
 * retained for one-off manual runs; this file is what CI / `bun test`
 * sees.
 *
 * Skipped when EITHER `VOLT_TC_PORT` or `VOLT_CODESYS_PORT` is unset
 * (CI without an IDE / single-vendor dev environment skips cleanly).
 * Set both to the running bridge ports — typically:
 *   VOLT_TC_PORT=8555 VOLT_CODESYS_PORT=8556 bun test parity
 *
 * What each contract guards (and why a silent regression would be
 * dangerous):
 *
 *   1. fetch.projectVersion deterministic
 *      → ensures two consecutive /fetch calls without any mutation
 *        return the same projectVersion. If they didn't, the agent's
 *        "expectedProjectVersion" would race itself.
 *   2. refs.projectVersion === fetch.projectVersion
 *      → ensures the cheap /refs probe agrees with the full /fetch on
 *        which version is current. This is the invariant the
 *        single-walker refactor enforces.
 *   3. refs shape (projectVersion + items + kinds)
 *      → wire-schema sanity: the agent will crash if any field is
 *        missing, but with a confusing error.
 *   4. fetch shape (projectVersion + changed + removed + items)
 *      → same, for /fetch.
 *   5. push rejects bad expectedProjectVersion with <project> conflict
 *      → the project-level guard the agent relies on for safe-by-
 *        default push.
 *   6. empty push accepted shape (newProjectVersion + newItems)
 *      → confirms a no-op push still returns the bridge's current
 *        view so the agent can save its receipt.
 *   7. post-push fetch matches push.newProjectVersion
 *      → THE invariant this session's structural refactor was about.
 *        If a bridge's /push computes its newProjectVersion via a
 *        different code path than /fetch's projectVersion, you get
 *        phantom drift on the next push. The shared walker is what
 *        makes this true; this test is what holds it true.
 */
import { describe, expect, it, beforeAll } from "bun:test";

const TC_PORT_RAW = process.env.VOLT_TC_PORT;
const CS_PORT_RAW = process.env.VOLT_CODESYS_PORT;
const TC_PORT = TC_PORT_RAW !== undefined ? Number.parseInt(TC_PORT_RAW, 10) : Number.NaN;
const CS_PORT = CS_PORT_RAW !== undefined ? Number.parseInt(CS_PORT_RAW, 10) : Number.NaN;
const LIVE = Number.isFinite(TC_PORT) && Number.isFinite(CS_PORT);

interface JsonResponse {
	status: number;
	body: any;
}

async function call(port: number, path: string, body?: unknown): Promise<JsonResponse> {
	// /refs and /health are GET (read-only). /fetch and /push are POST.
	// CODESYS strictly enforces method-on-route; TC also accepts POST
	// on /refs but we keep parity strict for the test.
	const isReadOnly = path === "/refs" || path === "/health";
	const r = await fetch(`http://127.0.0.1:${port}${path}`, {
		method: isReadOnly ? "GET" : "POST",
		headers: isReadOnly ? undefined : { "Content-Type": "application/json" },
		body: isReadOnly ? undefined : JSON.stringify(body ?? {}),
	});
	const txt = await r.text();
	let parsed: any;
	try {
		parsed = JSON.parse(txt);
	} catch {
		parsed = txt;
	}
	return { status: r.status, body: parsed };
}

async function isAlive(port: number): Promise<boolean> {
	try {
		const r = await fetch(`http://127.0.0.1:${port}/health`);
		if (!r.ok) return false;
		const j = (await r.json()) as { connected?: boolean };
		return j.connected === true;
	} catch {
		return false;
	}
}

interface BridgeFixture {
	id: "TC" | "CODESYS";
	port: number;
}

const BRIDGES: BridgeFixture[] = [
	{ id: "TC", port: TC_PORT },
	{ id: "CODESYS", port: CS_PORT },
];

describe.skipIf(!LIVE)("cross-bridge parity (TC vs CODESYS)", () => {
	beforeAll(async () => {
		// Both bridges must be alive and connected to an IDE project
		// before the parity tests run. Failing here gives a much
		// better error than a confused 500 from a half-open bridge.
		for (const b of BRIDGES) {
			const alive = await isAlive(b.port);
			if (!alive) {
				throw new Error(
					`${b.id} bridge unreachable or IDE not connected on :${b.port} — open the IDE project before running the parity test`,
				);
			}
		}
	});

	// One identical assertion runs against both bridges. Bun's test
	// reporter lists each as `${name} [TC]` / `[CODESYS]` so a regression
	// on one side is visible immediately.
	for (const bridge of BRIDGES) {
		describe(`[${bridge.id}]`, () => {
			it("fetch.projectVersion is deterministic across repeated calls", async () => {
				const f1 = await call(bridge.port, "/fetch", { knownItems: {} });
				const f2 = await call(bridge.port, "/fetch", { knownItems: {} });
				expect(f1.body.projectVersion).toBe(f2.body.projectVersion);
			});

			it("refs.projectVersion equals fetch.projectVersion", async () => {
				const refs = await call(bridge.port, "/refs");
				const fetched = await call(bridge.port, "/fetch", { knownItems: {} });
				expect(refs.body.projectVersion).toBe(fetched.body.projectVersion);
				// Same item count — single-walker invariant.
				expect(Object.keys(refs.body.items).length).toBe(
					Object.keys(fetched.body.items).length,
				);
			});

			it("refs response carries projectVersion + items + kinds", async () => {
				const r = await call(bridge.port, "/refs");
				expect(typeof r.body.projectVersion).toBe("string");
				expect(typeof r.body.items).toBe("object");
				expect(typeof r.body.kinds).toBe("object");
			});

			it("fetch response carries projectVersion + changed + removed + items", async () => {
				const f = await call(bridge.port, "/fetch", { knownItems: {} });
				expect(typeof f.body.projectVersion).toBe("string");
				expect(Array.isArray(f.body.changed)).toBe(true);
				expect(Array.isArray(f.body.removed)).toBe(true);
				expect(typeof f.body.items).toBe("object");
			});

			it("push rejects bad expectedProjectVersion with <project> conflict", async () => {
				const bad = await call(bridge.port, "/push", {
					expectedProjectVersion: "deadbeefdeadbeef",
					ops: [],
				});
				expect(bad.body.accepted).toBe(false);
				expect(Array.isArray(bad.body.conflicts)).toBe(true);
				expect(
					bad.body.conflicts.some((c: { name: string }) => c.name === "<project>"),
				).toBe(true);
			});

			it("empty push (correct expected) returns newProjectVersion + newItems", async () => {
				const f = await call(bridge.port, "/fetch", { knownItems: {} });
				const noop = await call(bridge.port, "/push", {
					expectedProjectVersion: f.body.projectVersion,
					ops: [],
				});
				expect(noop.body.accepted).toBe(true);
				expect(typeof noop.body.newProjectVersion).toBe("string");
				expect(typeof noop.body.newItems).toBe("object");
			});

			it("post-push fetch.projectVersion matches push.newProjectVersion", async () => {
				// THE structural invariant — single walker, multiple
				// projections. A regression here means push and fetch
				// disagree on what 'current' is, which surfaces in
				// production as phantom drift on the next push.
				const f1 = await call(bridge.port, "/fetch", { knownItems: {} });
				const noop = await call(bridge.port, "/push", {
					expectedProjectVersion: f1.body.projectVersion,
					ops: [],
				});
				const f2 = await call(bridge.port, "/fetch", { knownItems: {} });
				expect(noop.body.accepted).toBe(true);
				expect(f2.body.projectVersion).toBe(noop.body.newProjectVersion);
			});
		});
	}
});
