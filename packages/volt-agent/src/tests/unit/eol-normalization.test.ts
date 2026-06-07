/**
 * Regression test: CRLF↔LF asymmetry between detectWorkspaceDirty and
 * computeOutgoing.
 *
 * Both predicates compare workspace files to the snapshot's HEAD tree.
 * `detectWorkspaceDirty` normalizes CRLF→LF before hashing, so a file
 * saved with Windows line endings (or briefly held with CRLF by OneDrive
 * while pull's LF writes settle to disk) shows as clean. Before 1.20.1
 * `computeOutgoing` did NOT normalize — same file would silently appear
 * in its `modified` list. Status thus reported "0 dirty, N outgoing" —
 * a contradiction that surfaced as a phantom `out=N` in the VS Code SCM
 * tree right after a pull, until OneDrive's sync engine settled.
 *
 * This test pulls a clean fixture, rewrites every materialized source
 * file's bytes with CRLF endings (content otherwise byte-identical to
 * the snapshot blob after normalization), then asserts BOTH predicates
 * report no change.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { pullVerb } from "../../cli/pull.js";
import { workspacePaths } from "../../engine/config.js";
import {
	computeOutgoing,
	detectWorkspaceDirty,
	loadState,
} from "../../engine/snapshot.js";
import { simple } from "../fixtures/projects/simple.js";
import { makeTestEnv, type TestEnv } from "../harness/make-test-env.js";
import { listWorkspace } from "../harness/assert-workspace.js";
import { runVerb } from "../harness/run-verb.js";

let env: TestEnv | undefined;
afterEach(() => {
	env?.cleanup();
	env = undefined;
});

describe("EOL normalization parity (detectWorkspaceDirty ↔ computeOutgoing)", () => {
	test("a workspace file rewritten with CRLF endings is NOT reported as outgoing", async () => {
		env = makeTestEnv(simple);
		expect((await runVerb(pullVerb, env)).exitCode).toBe(0);

		// Re-write every materialized source file's bytes with CRLF
		// endings. Content stays semantically identical — only the
		// per-line terminator changes. This mirrors what happens on
		// Windows when a text editor or OneDrive briefly rewrites a
		// pulled file with the platform's native line endings.
		const sourcePaths = listWorkspace(env.workspace).filter((p) =>
			/\.(st|gvl|struct|enum|union|alias|itf|fbd|ld|sfc|cfc)$/.test(p),
		);
		expect(sourcePaths.length).toBeGreaterThan(0);
		for (const rel of sourcePaths) {
			const abs = join(env.workspace, rel);
			const lf = readFileSync(abs, "utf-8");
			// Replace bare LF with CRLF (skip already-CRLF lines so the
			// substitution stays idempotent on Windows checkouts).
			const crlf = lf.replace(/(?<!\r)\n/g, "\r\n");
			writeFileSync(abs, crlf, "utf-8");
		}

		const paths = workspacePaths(env.workspace);
		const state = loadState(paths.snapshotPath);
		expect(state).toBeDefined();

		// Both predicates MUST agree: post-pull, nothing differs from
		// HEAD even when the workspace bytes carry CRLF.
		const dirty = detectWorkspaceDirty(paths.snapshotPath, env.workspace, state!.commitSha);
		expect(dirty).toEqual([]);

		const outgoing = computeOutgoing(paths.snapshotPath, env.workspace, state!.commitSha);
		expect(outgoing.added).toEqual([]);
		expect(outgoing.modified).toEqual([]);
		expect(outgoing.removed).toEqual([]);
		expect(outgoing.moved).toEqual([]);
	});

	test("a REAL content change is still surfaced (not silently swallowed by normalization)", async () => {
		env = makeTestEnv(simple);
		expect((await runVerb(pullVerb, env)).exitCode).toBe(0);

		// Modify FB_Motor's body — actual content change, not just EOL.
		const fbPath = join(env.workspace, "src/POUs/FB_Motor.st");
		writeFileSync(
			fbPath,
			readFileSync(fbPath, "utf-8") + "\n// edited by test\n",
			"utf-8",
		);

		const paths = workspacePaths(env.workspace);
		const state = loadState(paths.snapshotPath)!;

		// Both predicates MUST also agree on real changes — the
		// normalization fix doesn't accidentally hide them.
		const dirty = detectWorkspaceDirty(paths.snapshotPath, env.workspace, state.commitSha);
		expect(dirty).toContain("POUs/FB_Motor.st");

		const outgoing = computeOutgoing(paths.snapshotPath, env.workspace, state.commitSha);
		expect(outgoing.modified).toContain("FB_Motor");
	});
});
