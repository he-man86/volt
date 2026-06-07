/**
 * `volt pull --json` / `volt push --json` end-to-end output contract.
 *
 * The VS Code extension's `runCliMutating` (cli.ts) parses stdout line-
 * by-line and applies the `complete` event's `status` directly to
 * `VoltWorkspace.latestStatus`, skipping the slow `volt status --json`
 * walk that would otherwise fire 100ms later. This test pins both ends
 * of that wire contract: pull on a fresh workspace emits one and only
 * one `complete` event with the expected shape; the same on push.
 *
 * Drift here is silent — the extension would just fall back to the slow
 * status walk on the parse-miss path, no error to surface. Hence the
 * test runner needs to catch it before ship.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { pullVerb } from "../../../cli/pull.js";
import { pushVerb } from "../../../cli/push.js";
import { simple } from "../../fixtures/projects/simple.js";
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js";
import { runVerb } from "../../harness/run-verb.js";

let env: TestEnv | undefined;
afterEach(() => {
	env?.cleanup();
	env = undefined;
});

interface CompleteEvent {
	event: "complete";
	summary: string;
	status?: {
		initialized: boolean;
		incoming: { added: string[]; modified: string[]; removed: string[] };
		outgoing: { added: string[]; modified: string[]; removed: string[] };
		bridgeProjectVersion: string;
		snapshotProjectVersion: string;
		projectMismatch: unknown | null;
	};
}

/** Find the single `complete` event in NDJSON stdout. Asserts exactly
 *  one — a duplicate would mean the extension applies stale data on
 *  the second parse pass. */
function extractCompleteEvent(stdout: string): CompleteEvent {
	const completes: CompleteEvent[] = [];
	for (const line of stdout.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		try {
			const parsed = JSON.parse(trimmed) as { event?: string };
			if (parsed.event === "complete") completes.push(parsed as CompleteEvent);
		} catch {
			// non-JSON line (shouldn't happen in --json mode but be tolerant)
		}
	}
	expect(completes).toHaveLength(1);
	return completes[0]!;
}

describe("scenario: pull --json output contract", () => {
	test("emits one complete event with inc=0 / out=0 status on clean success", async () => {
		env = makeTestEnv(simple);
		const result = await runVerb(pullVerb, env, { json: true });
		expect(result.exitCode).toBe(0);

		const evt = extractCompleteEvent(result.stdout);
		expect(evt.event).toBe("complete");
		expect(typeof evt.summary).toBe("string");
		expect(evt.summary.length).toBeGreaterThan(0);

		// status MUST be present on a clean success — that's what lets
		// the extension skip the redundant `volt status` walk.
		expect(evt.status).toBeDefined();
		expect(evt.status!.initialized).toBe(true);
		expect(evt.status!.incoming.added).toEqual([]);
		expect(evt.status!.incoming.modified).toEqual([]);
		expect(evt.status!.incoming.removed).toEqual([]);
		expect(evt.status!.outgoing.added).toEqual([]);
		expect(evt.status!.outgoing.modified).toEqual([]);
		expect(evt.status!.outgoing.removed).toEqual([]);
		expect(evt.status!.projectMismatch).toBeNull();
		// snapshot and bridge agree on projectVersion post-pull.
		expect(evt.status!.snapshotProjectVersion).toBe(evt.status!.bridgeProjectVersion);
	});

	test("suppresses human-readable lines in --json mode (stdout is pure NDJSON)", async () => {
		env = makeTestEnv(simple);
		const result = await runVerb(pullVerb, env, { json: true });

		// Every non-empty stdout line MUST be valid JSON — the extension's
		// NDJSON parser treats anything else as a corrupted stream.
		const lines = result.stdout.split(/\r?\n/).filter((l) => l.length > 0);
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}

		// The legacy plaintext lines MUST NOT appear as their own lines —
		// the `pulled: ...` headline IS embedded inside the JSON summary
		// field, but it must NEVER appear as a bare top-level stdout line
		// (humans see those via the non-json path; JSON consumers parse
		// the structured summary).
		for (const line of lines) {
			expect(line.startsWith("pulled:")).toBe(false);
			expect(line.startsWith("already up to date")).toBe(false);
			expect(line.startsWith("  (")).toBe(false);
		}
	});

	test("default (no --json) keeps the legacy human-readable output", async () => {
		env = makeTestEnv(simple);
		const result = await runVerb(pullVerb, env);
		expect(result.exitCode).toBe(0);

		// Human-readable headline + breakdown are still there.
		expect(result.stdout).toContain("pulled:");

		// And NO NDJSON events leak into the non-json output — humans
		// shouldn't see `{"event":"complete",...}` in their terminal.
		expect(result.stdout).not.toContain('"event":"complete"');
	});
});

describe("scenario: push --json output contract", () => {
	test("clean no-op push still emits one complete event with status", async () => {
		env = makeTestEnv(simple);
		// First pull so workspace and snapshot are in sync.
		expect((await runVerb(pullVerb, env)).exitCode).toBe(0);
		// Now push with nothing outgoing. Verb takes the short path and
		// still emits the complete event for the extension's apply path.
		const result = await runVerb(pushVerb, env, { json: true });
		expect(result.exitCode).toBe(0);

		const evt = extractCompleteEvent(result.stdout);
		expect(evt.event).toBe("complete");
		expect(evt.status).toBeDefined();
		expect(evt.status!.outgoing.added).toEqual([]);
		expect(evt.status!.outgoing.modified).toEqual([]);
		expect(evt.status!.outgoing.removed).toEqual([]);
	});
});
