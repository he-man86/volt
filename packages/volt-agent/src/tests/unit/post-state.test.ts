/**
 * Wire-shape tests for the post-state payload pull/push emit on
 * `--json` clean success.
 *
 * Why these tests exist: the VS Code extension's `runCliMutating`
 * parses one specific JSON line out of stdout and applies it directly
 * to `VoltWorkspace.latestStatus`. Adding a field to `StatusJson` on the
 * extension side without matching here would surface as silently-wrong
 * SCM tree state — no error, no log line, the tree just shows stale
 * data. These tests pin the contract so a future renaming or field
 * removal trips the test runner instead of production.
 */
import { describe, expect, test } from "bun:test";

import { buildSyncedPostState, emitCompleteEvent, type PostState } from "../../cli/_post-state.js";

describe("buildSyncedPostState shape", () => {
	test("emits every field the extension's StatusJson interface declares", () => {
		const s = buildSyncedPostState("abc123");
		// Pin every field name + type. Adding a field to StatusJson on
		// the extension side without adding it here surfaces as a stale
		// post-pull tree — this test catches that drift before ship.
		const expectedKeys: Array<keyof PostState> = [
			"initialized",
			"merging",
			"incoming",
			"outgoing",
			"pathByName",
			"snapshotProjectVersion",
			"bridgeProjectVersion",
			"ideDrifted",
			"workspaceDirty",
			"driftLikelySelfCaused",
			"nextAction",
			"summary",
			"projectMismatch",
		];
		expect(Object.keys(s).sort()).toEqual([...expectedKeys].sort());
	});

	test("clean-success values: in-sync, no changes either direction", () => {
		const s = buildSyncedPostState("v42");
		expect(s.initialized).toBe(true);
		expect(s.merging).toBeNull();
		expect(s.incoming).toEqual({ added: [], modified: [], removed: [], moved: [] });
		expect(s.outgoing).toEqual({ added: [], modified: [], removed: [], moved: [] });
		expect(s.pathByName).toEqual({});
		expect(s.snapshotProjectVersion).toBe("v42");
		expect(s.bridgeProjectVersion).toBe("v42");
		expect(s.ideDrifted).toBe(false);
		expect(s.workspaceDirty).toBe(false);
		expect(s.driftLikelySelfCaused).toBe(false);
		expect(s.nextAction).toBeNull();
		expect(s.projectMismatch).toBeNull();
		expect(typeof s.summary).toBe("string");
	});
});

describe("emitCompleteEvent NDJSON output", () => {
	test("writes ONE valid JSON line containing the expected fields", () => {
		const captured = captureStdout(() => {
			emitCompleteEvent({
				status: buildSyncedPostState("v1"),
				summary: "pulled: 5 file(s)",
			});
		});
		// One line, terminated by a single \n — the VS Code parser
		// splits on /\r?\n/ and expects each line to be standalone.
		expect(captured.endsWith("\n")).toBe(true);
		const lines = captured.split("\n").filter((l) => l.length > 0);
		expect(lines).toHaveLength(1);

		const parsed = JSON.parse(lines[0]!);
		expect(parsed.event).toBe("complete");
		expect(parsed.summary).toBe("pulled: 5 file(s)");
		expect(parsed.status).toBeDefined();
		expect(parsed.status.bridgeProjectVersion).toBe("v1");
	});

	test("omits `status` field when not provided (partial-success path)", () => {
		// When pull skipped items, we emit summary only — the extension
		// reads `summary` for the toast but falls back to a full status
		// walk to discover the remaining incoming items. The status
		// field must be ABSENT (not null) so the parser's typeof-object
		// guard branches into the fallback path.
		const captured = captureStdout(() => {
			emitCompleteEvent({ summary: "pulled — 3 items skipped" });
		});
		const parsed = JSON.parse(captured.trim());
		expect(parsed.event).toBe("complete");
		expect(parsed.summary).toBe("pulled — 3 items skipped");
		expect("status" in parsed).toBe(false);
	});
});

/** Capture stdout writes inside `fn` and return them as a single string.
 *  Restores the original `process.stdout.write` even on throw so a
 *  failing test doesn't poison the runner's output. */
function captureStdout(fn: () => void): string {
	const chunks: string[] = [];
	const orig = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string | Uint8Array): boolean => {
		chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
		return true;
	}) as typeof process.stdout.write;
	try {
		fn();
	} finally {
		process.stdout.write = orig;
	}
	return chunks.join("");
}
