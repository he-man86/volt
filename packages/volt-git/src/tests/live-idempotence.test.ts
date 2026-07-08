/**
 * LIVE round-trip idempotence + losslessness — the same invariants as `idempotence.test.ts`, but against a REAL
 * CODESYS/TwinCAT bridge, so it exercises the bridge's materialize/apply where actual data-loss lives (the
 * empty-body-clear incident: an emptied body that was never cleared). A HashMap mock cannot catch that; only a
 * live IDE can. Skips cleanly when no COMPATIBLE bridge is reachable (the `suite` gate is wire-version aware —
 * a stale bridge build skips with a hint rather than failing). Every item is namespaced `VltIdem_*` and purged
 * on entry/exit — the suite NEVER touches the project's real items.
 *
 * Run with a bridge on VOLT_TC_PORT (default 8556 = CODESYS; 8555 = TwinCAT).
 */
import { afterAll, beforeAll, expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BridgeClient } from "../bridge/client.js";
import { init } from "../init.js";
import { push } from "../sync/push.js";
import { commit as commitWs, freshWorkspace, PORT, purge, refs, suite } from "./live-harness.js";

setDefaultTimeout(60_000);

const PREFIX = "VltIdem";
let bridge: BridgeClient;
let ws: string;
let cleanup: () => void;

const wsPath = (rel: string): string => join(ws, "src", rel);
const writeWs = (rel: string, content: string): void => {
	mkdirSync(dirname(wsPath(rel)), { recursive: true });
	writeFileSync(wsPath(rel), content);
};
const commit = (m: string): void => commitWs(ws, m);
const srcRelOf = async (name: string): Promise<string> => {
	const f = (await refs()).folders[name];
	return f ? `${f}/${name}` : name;
};
const fb = (name: string, body: string): string => `FUNCTION_BLOCK ${name}\nVAR\n\tn : INT;\nEND_VAR\n${body}END_FUNCTION_BLOCK\n`;

/** Materialize the whole IDE into a throwaway workspace and read one file back — the bridge's own view. */
async function freshRead(rel: string): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), "voltg-idem-live-"));
	try {
		const r = await init(dir, new BridgeClient({ port: PORT }));
		expect(r.kind).toBe("ok");
		return readFileSync(join(dir, "src", rel), "utf8");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

suite("live round-trip idempotence", () => {
	beforeAll(async () => {
		const h = await freshWorkspace(PREFIX);
		bridge = h.bridge;
		ws = h.ws;
		cleanup = h.cleanup;
	});
	afterAll(async () => {
		await purge(PREFIX);
		cleanup?.();
	});

	it("after init, a push with no edits is a NO-OP (idempotent)", async () => {
		const r = await push(ws, bridge);
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") expect(r.items).toEqual([]);
	});

	it("an emptied body is CLEARED, not silently retained (the empty-body-clear property)", async () => {
		const name = `${PREFIX}_Empty.fb`;
		writeWs(name, fb(`${PREFIX}_Empty`, "n := n + 1;\n"));
		commit("create with body");
		expect((await push(ws, bridge)).kind).toBe("ok");

		writeWs(name, fb(`${PREFIX}_Empty`, "")); // empty the implementation
		commit("empty the body");
		expect((await push(ws, bridge)).kind).toBe("ok");

		const rel = await srcRelOf(name);
		const materialized = await freshRead(rel);
		expect(materialized).not.toContain("n := n + 1;"); // the old body must NOT survive the clear
	});

	it("the bridge's own output round-trips without spurious drift (push → fresh pull → push = no-op)", async () => {
		const name = `${PREFIX}_Stable.fb`;
		writeWs(name, fb(`${PREFIX}_Stable`, "n := n + 2;\n"));
		commit("create stable");
		expect((await push(ws, bridge)).kind).toBe("ok");

		// A fresh workspace pulls the bridge's canonical bytes; pushing from it must be a no-op (the bridge
		// already matches what it just gave us — no spurious "changed" from materialize↔fetch asymmetry).
		const dir = mkdtempSync(join(tmpdir(), "voltg-idem-stable-"));
		try {
			const b2 = new BridgeClient({ port: PORT });
			expect((await init(dir, b2)).kind).toBe("ok");
			const r = await push(dir, b2);
			expect(r.kind).toBe("ok");
			if (r.kind === "ok") expect(r.items).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
