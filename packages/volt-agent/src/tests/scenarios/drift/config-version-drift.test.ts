/**
 * Config-item versioning contract.
 *
 * Pre-2026-06-04 Beckhoff bug: the bridge returned `version = configKind`
 * (a constant string per kind) for every non-CRUD item. Two different
 * tasks shared the version "task"; edits to one task were invisible to
 * the next `/refs` walk because the version never moved. Silent data
 * loss potential.
 *
 * Post-fix: both bridges return SHA1 of the typed-extractor manifest
 * as the version. Content edits → hash change → agent detects drift.
 *
 * This test pins the agent's behavior against that honest contract:
 * when a config item's bridge-side content changes, the next `pull`
 * MUST pick up the new content. The TestBridge already hashes item
 * sourceText content-aware (its `computeVersions` runs SHA1 on the
 * stored item) so mutating sourceText changes its version — the
 * scenario then asserts the agent reacts correctly.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { pullVerb } from "../../../cli/pull.js";
import { readWorkspace } from "../../harness/assert-workspace.js";
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js";
import { runVerb } from "../../harness/run-verb.js";
import { withConfig } from "../../fixtures/projects/with-config.js";

let env: TestEnv | undefined;
afterEach(() => {
	env?.cleanup();
	env = undefined;
});

describe("scenario: config item version is content-aware", () => {
	test("editing a config item's content makes the next pull materialize the new content", async () => {
		env = makeTestEnv(withConfig);

		// First pull: bring everything in.
		const first = await runVerb(pullVerb, env);
		expect(first.exitCode).toBe(0);
		const taskPath = "Device/Plc Logic/Application/Task Configuration/MainTask.task";
		expect(readWorkspace(env.workspace, taskPath)).toContain("priority = 1");

		// Engineer edits the task in the IDE (we simulate by mutating
		// the bridge's stored item). Bridge's version-of-this-item now
		// reflects the new content because the extractor manifest
		// changed — the very contract Beckhoff used to violate.
		const task = env.bridge.items.get("MainTask");
		if (task === undefined) throw new Error("fixture invariant: MainTask must exist");
		task.sourceText = "kind = Cyclic\npriority = 9\ninterval = 50\npou = PLC_PRG\n";

		// Second pull: the agent should detect the change via the
		// changed version, fetch the new sourceText, and overwrite the
		// workspace file.
		const second = await runVerb(pullVerb, env);
		expect(second.exitCode).toBe(0);
		expect(readWorkspace(env.workspace, taskPath)).toContain("priority = 9");
	});

	test("no-op pull when nothing changed (version stable)", async () => {
		env = makeTestEnv(withConfig);
		await runVerb(pullVerb, env);
		const before = readWorkspace(
			env.workspace,
			"Device/Plc Logic/Application/Library Manager/IoStandard.library",
		);

		// Second pull WITHOUT any bridge-side change. Same versions →
		// agent should write nothing new. File content stays byte-stable.
		const second = await runVerb(pullVerb, env);
		expect(second.exitCode).toBe(0);
		const after = readWorkspace(
			env.workspace,
			"Device/Plc Logic/Application/Library Manager/IoStandard.library",
		);
		expect(after).toBe(before);
	});

	test("different config items produce different versions (no kind-string collisions)", async () => {
		env = makeTestEnv(withConfig);
		const refs = await env.bridge.getRefs();
		// Two tasks would have shared `version = "task"` under the old
		// constant-version policy. Today their versions are SHA1 of
		// distinct content, so they differ. We don't have two tasks in
		// the fixture, but we have two distinct kinds whose versions
		// must NOT collide as a degenerate-mode sanity check.
		const taskVer = refs.items["MainTask"];
		const libVer = refs.items["IoStandard"];
		expect(taskVer).toBeDefined();
		expect(libVer).toBeDefined();
		expect(taskVer).not.toBe("task");
		expect(libVer).not.toBe("library");
		expect(taskVer).not.toBe(libVer);
	});
});
