/**
 * Coverage for the `BridgeClient` HTTP boundary — specifically the
 * `.parse()` validation layer added on top of every response. We spin
 * up a real `http.createServer` on an ephemeral port and configure the
 * per-test responder; this exercises the same `node:http` request path
 * the production client uses (no fetch mocks).
 *
 * What we lock in:
 *   - happy path round-trips cleanly
 *   - missing required fields  → BridgeError MALFORMED_RESPONSE w/ path
 *   - wrong-typed fields       → BridgeError MALFORMED_RESPONSE w/ path
 *   - extra unknown fields     → BridgeError MALFORMED_RESPONSE (.strict)
 *   - upstream error envelopes → BridgeError with the bridge's code
 *   - PushResponse discriminated union — accepted=true branch validated
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { BridgeClient, BridgeError } from "./client.js";

interface MockReply {
	status: number;
	body: unknown;
}

let server: Server;
let port: number;
let nextReply: MockReply;

beforeEach(async () => {
	nextReply = { status: 200, body: {} };
	server = createServer((_req, res) => {
		res.statusCode = nextReply.status;
		res.setHeader("content-type", "application/json");
		res.end(typeof nextReply.body === "string" ? nextReply.body : JSON.stringify(nextReply.body));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
	const addr = server.address() as AddressInfo;
	port = addr.port;
});

afterEach(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

function clientUnderTest(): BridgeClient {
	return new BridgeClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 1000 });
}

const VALID_HEALTH = {
	status: "healthy",
	platform: "beckhoff",
	connected: true,
	ideAlive: true,
	degraded: false,
	degradedReason: null,
	version: "1.0.0",
} as const;

describe("BridgeClient response validation", () => {
	test("happy path: valid /health is returned as-is", async () => {
		nextReply = { status: 200, body: VALID_HEALTH };
		const got = await clientUnderTest().getHealth();
		expect(got.status).toBe("healthy");
		expect(got.connected).toBe(true);
	});

	test("missing required field surfaces as MALFORMED_RESPONSE with field path", async () => {
		const { connected: _connected, ...broken } = VALID_HEALTH;
		nextReply = { status: 200, body: broken };
		let caught: unknown;
		try {
			await clientUnderTest().getHealth();
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(BridgeError);
		expect((caught as BridgeError).code).toBe("MALFORMED_RESPONSE");
		expect((caught as BridgeError).message).toContain("/health");
		expect((caught as BridgeError).message).toContain("connected");
	});

	test("wrong-typed field surfaces as MALFORMED_RESPONSE", async () => {
		nextReply = { status: 200, body: { ...VALID_HEALTH, connected: "yes" } };
		let caught: unknown;
		try {
			await clientUnderTest().getHealth();
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(BridgeError);
		expect((caught as BridgeError).code).toBe("MALFORMED_RESPONSE");
		expect((caught as BridgeError).message).toContain("connected");
	});

	test("unknown extra field is rejected by .strict() schemas", async () => {
		nextReply = { status: 200, body: { ...VALID_HEALTH, mysteryField: 42 } };
		let caught: unknown;
		try {
			await clientUnderTest().getHealth();
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(BridgeError);
		expect((caught as BridgeError).code).toBe("MALFORMED_RESPONSE");
	});

	test("upstream error envelope preserves the bridge's code", async () => {
		nextReply = {
			status: 409,
			body: { error: { code: "ALREADY_EXISTS", message: "item exists" } },
		};
		let caught: unknown;
		try {
			await clientUnderTest().getHealth();
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(BridgeError);
		expect((caught as BridgeError).code).toBe("ALREADY_EXISTS");
		expect((caught as BridgeError).status).toBe(409);
	});

	test("PushResponse discriminated union: accepted=true validates newProjectVersion", async () => {
		// Missing newProjectVersion on the accepted branch should fail —
		// the discriminator picks PushAcceptedSchema and required fields are checked.
		nextReply = { status: 200, body: { accepted: true, newItems: {} } };
		let caught: unknown;
		try {
			await clientUnderTest().pushBatch({ ops: [] });
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(BridgeError);
		expect((caught as BridgeError).code).toBe("MALFORMED_RESPONSE");
		expect((caught as BridgeError).message).toContain("newProjectVersion");
	});

	test("PushResponse discriminated union: valid accepted=true branch parses", async () => {
		nextReply = {
			status: 200,
			body: { accepted: true, newProjectVersion: "abc123", newItems: { FB_X: "v1" } },
		};
		const got = await clientUnderTest().pushBatch({ ops: [] });
		expect(got.accepted).toBe(true);
		if (got.accepted) {
			expect(got.newProjectVersion).toBe("abc123");
			expect(got.newItems["FB_X"]).toBe("v1");
		}
	});
});

// ─── empty-refs disconnect defense ────────────────────────────────────
//
// Locks in the volt-agent-side check that protects against any bridge
// (Beckhoff or CODESYS) that returns 200-OK + `{items: {}}` while its
// IDE is actually disconnected. Without this defense, `volt status`
// would interpret empty refs as "engineer deleted every POU" and
// surface a destructive "incoming delete" set.

describe("BridgeClient empty-refs disconnect defense", () => {
	let multiServer: Server;
	let multiPort: number;
	let refsBody: unknown = { items: {}, kinds: {}, projectVersion: "abc", structureVersion: "abc" };
	let healthBody: unknown = { ...VALID_HEALTH };

	beforeEach(async () => {
		multiServer = createServer((req, res) => {
			res.statusCode = 200;
			res.setHeader("content-type", "application/json");
			if (req.url === "/refs") {
				res.end(JSON.stringify(refsBody));
			} else if (req.url === "/health") {
				res.end(JSON.stringify(healthBody));
			} else {
				res.statusCode = 404;
				res.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
			}
		});
		await new Promise<void>((resolve) => multiServer.listen(0, "127.0.0.1", () => resolve()));
		const addr = multiServer.address() as AddressInfo;
		multiPort = addr.port;
	});

	afterEach(async () => {
		await new Promise<void>((resolve) => multiServer.close(() => resolve()));
	});

	function client(): BridgeClient {
		return new BridgeClient({ baseUrl: `http://127.0.0.1:${multiPort}`, timeoutMs: 1000 });
	}

	test("empty refs + /health.connected=false → throws PLC_DISCONNECTED", async () => {
		refsBody = { items: {}, kinds: {}, projectVersion: "empty", structureVersion: "empty" };
		healthBody = { ...VALID_HEALTH, connected: false, status: "unavailable", ideAlive: false };
		let caught: unknown;
		try {
			await client().getRefs();
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(BridgeError);
		expect((caught as BridgeError).code).toBe("PLC_DISCONNECTED");
	});

	test("empty refs + /health.connected=true → trusted (project is genuinely empty)", async () => {
		refsBody = { items: {}, kinds: {}, projectVersion: "fresh", structureVersion: "fresh" };
		healthBody = { ...VALID_HEALTH }; // connected: true
		const refs = await client().getRefs();
		expect(Object.keys(refs.items).length).toBe(0);
		expect(refs.projectVersion).toBe("fresh");
	});

	test("non-empty refs → /health is NOT consulted (no extra round trip)", async () => {
		// If the defense path runs when items is non-empty, this would
		// observe `connected: false` and throw — proving the gate fires
		// only on the empty case.
		refsBody = {
			items: { FB_X: "v1" },
			kinds: { FB_X: "function_block" },
			projectVersion: "v1",
			structureVersion: "v1",
		};
		healthBody = { ...VALID_HEALTH, connected: false }; // misleading on purpose
		const refs = await client().getRefs();
		expect(refs.items["FB_X"]).toBe("v1");
	});

	test("empty refs + /health that throws/times-out → trusts refs (fails open)", async () => {
		// If we can't reach /health, we can't disprove the bridge —
		// fall through and let downstream layers decide. Strict
		// gating would mean a degraded /health takes down /refs entirely.
		refsBody = { items: {}, kinds: {}, projectVersion: "empty", structureVersion: "empty" };
		// Respond malformed so HealthResponseSchema rejects → getHealth throws.
		healthBody = { not: "valid" };
		const refs = await client().getRefs();
		expect(Object.keys(refs.items).length).toBe(0);
	});
});
