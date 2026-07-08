/** BridgeClient wire-version guard + offline detection. Uses a real loopback HTTP server so the actual
 *  node:http transport + schema validation run (MockBridge implements Remote directly and would bypass them). */
import { describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { BridgeClient, BridgeError, isBridgeOfflineError } from "./client.js";
import { WIRE_VERSION } from "./types.js";

function health(wireVersion?: number): Record<string, unknown> {
	return {
		status: "healthy",
		platform: "twincat",
		connected: true,
		ideAlive: true,
		degraded: false,
		version: "test",
		...(wireVersion !== undefined ? { wireVersion } : {}),
	};
}

/** Start a loopback server that answers `${METHOD} ${path}` from a route map. Returns the port + a closer. */
async function serve(routes: Record<string, unknown>): Promise<{ port: number; close: () => void }> {
	const server: Server = createServer((req, res) => {
		const body = routes[`${req.method} ${req.url}`];
		res.setHeader("content-type", "application/json");
		if (body === undefined) {
			res.statusCode = 404;
			res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "no route" } }));
			return;
		}
		res.end(JSON.stringify(body));
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const addr = server.address();
	const port = typeof addr === "object" && addr ? addr.port : 0;
	return { port, close: () => server.close() };
}

async function expectMismatch(p: Promise<unknown>): Promise<void> {
	try {
		await p;
	} catch (e) {
		if (e instanceof BridgeError && e.code === "PROTOCOL_MISMATCH") return;
		throw e;
	}
	throw new Error("expected PROTOCOL_MISMATCH, but the call resolved");
}

describe("BridgeClient wire-version guard", () => {
	test("getHealth resolves when wireVersion matches", async () => {
		const s = await serve({ "GET /health": health(WIRE_VERSION) });
		try {
			const c = new BridgeClient({ baseUrl: `http://127.0.0.1:${s.port}` });
			const h = await c.getHealth();
			expect(h.wireVersion).toBe(WIRE_VERSION);
		} finally {
			s.close();
		}
	});

	test("getHealth throws PROTOCOL_MISMATCH on a different wireVersion", async () => {
		const s = await serve({ "GET /health": health(WIRE_VERSION + 1) });
		try {
			const c = new BridgeClient({ baseUrl: `http://127.0.0.1:${s.port}` });
			await expectMismatch(c.getHealth());
		} finally {
			s.close();
		}
	});

	test("an absent wireVersion (a pre-guard bridge) is treated as a mismatch", async () => {
		const s = await serve({ "GET /health": health(undefined) });
		try {
			const c = new BridgeClient({ baseUrl: `http://127.0.0.1:${s.port}` });
			await expectMismatch(c.getHealth());
		} finally {
			s.close();
		}
	});

	test("getRefs refuses (preflight) before touching /refs when the wire version mismatches", async () => {
		const s = await serve({
			"GET /health": health(WIRE_VERSION + 1),
			"GET /refs": { projectVersion: "x", structureVersion: "y", items: {}, folders: {} },
		});
		try {
			const c = new BridgeClient({ baseUrl: `http://127.0.0.1:${s.port}` });
			await expectMismatch(c.getRefs());
		} finally {
			s.close();
		}
	});
});

/** A server that answers GET /health with a buffered body and POST /fetch with an NDJSON stream of frames. */
async function serveStream(healthObj: Record<string, unknown>, fetchFrames: unknown[]): Promise<{ port: number; close: () => void }> {
	const server: Server = createServer((req, res) => {
		if (req.url === "/health") {
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify(healthObj));
			return;
		}
		if (req.url === "/fetch") {
			res.setHeader("content-type", "application/x-ndjson");
			for (const f of fetchFrames) res.write(JSON.stringify(f) + "\n");
			res.end();
			return;
		}
		res.statusCode = 404;
		res.end("{}");
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const addr = server.address();
	const port = typeof addr === "object" && addr ? addr.port : 0;
	return { port, close: () => server.close() };
}

const FETCH_RESULT = { projectVersion: "p", structureVersion: "s", changed: [], removed: [], items: {} };

describe("BridgeClient streamed fetch (onProgress)", () => {
	test("forwards progress frames then returns the terminal result", async () => {
		const s = await serveStream(health(WIRE_VERSION), [
			{ progress: { operation: "fetch", done: 25, total: 60 } },
			{ progress: { operation: "fetch", done: 60, total: 60 } },
			{ result: FETCH_RESULT },
		]);
		try {
			const c = new BridgeClient({ baseUrl: `http://127.0.0.1:${s.port}` });
			const seen: number[] = [];
			const res = await c.fetchChanges({ knownItems: {} }, (p) => seen.push(p.done));
			expect(seen).toEqual([25, 60]);
			expect(res.changed).toEqual([]);
		} finally {
			s.close();
		}
	});

	test("throws a BridgeError on a terminal error frame", async () => {
		const s = await serveStream(health(WIRE_VERSION), [
			{ progress: { operation: "fetch", done: 10, total: 60 } },
			{ error: { code: "PLC_DEGRADED", message: "IDE busy" } },
		]);
		try {
			const c = new BridgeClient({ baseUrl: `http://127.0.0.1:${s.port}` });
			let caught: unknown;
			await c.fetchChanges({ knownItems: {} }, () => {}).catch((e) => (caught = e));
			expect(caught).toBeInstanceOf(BridgeError);
			expect((caught as BridgeError).code).toBe("PLC_DEGRADED");
		} finally {
			s.close();
		}
	});
});

describe("isBridgeOfflineError keys on err.code", () => {
	test("true for socket-level codes", () => {
		for (const code of ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET"]) {
			const e = new Error("boom") as NodeJS.ErrnoException;
			e.code = code;
			expect(isBridgeOfflineError(e)).toBe(true);
		}
	});

	test("false for a BridgeError — the bridge answered", () => {
		expect(isBridgeOfflineError(new BridgeError("HTTP_500", "boom", 500))).toBe(false);
	});

	test("false for a plain error with no code", () => {
		expect(isBridgeOfflineError(new Error("mystery"))).toBe(false);
	});
});
