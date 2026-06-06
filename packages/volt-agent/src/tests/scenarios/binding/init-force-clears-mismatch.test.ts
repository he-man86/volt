/**
 * `volt init --force` is the documented recovery for a project-binding
 * mismatch. The user clicks "Accept new project name" in the VS Code
 * SCM tree (or runs the CLI directly); the workspace's `.volt/config.json`
 * picks up the bridge's current identity AND the snapshot history
 * survives — engineers don't lose `volt log` / `volt show` history.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { init as initVerb } from "../../../cli/init.js";
import { pullVerb } from "../../../cli/pull.js";
import { status as statusVerb } from "../../../cli/status.js";
import { simple } from "../../fixtures/projects/simple.js";
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js";
import { runVerb } from "../../harness/run-verb.js";

let env: TestEnv | undefined;
afterEach(() => {
	env?.cleanup();
	env = undefined;
});

interface StatusJson {
	projectMismatch: null | { diffFields: string[] };
}

describe("scenario: init --force accepts the new binding and preserves snapshot history", () => {
	test("force-init updates config to the bridge's current identity", async () => {
		env = makeTestEnv({
			...simple,
			health: { projectName: "ScenarioProject_v2" },
		});

		// Sanity: pre-force, status flags the mismatch.
		const pre = JSON.parse(
			(await runVerb(statusVerb, env, { json: true })).stdout,
		) as StatusJson;
		expect(pre.projectMismatch).not.toBeNull();

		// Engineer accepts the new name.
		const initResult = await runVerb(initVerb, env, { force: true });
		expect(initResult.exitCode).toBe(0);

		// Config now mirrors the bridge.
		const cfg = JSON.parse(
			readFileSync(join(env.workspace, ".volt", "config.json"), "utf-8"),
		) as { project: { projectName: string } };
		expect(cfg.project.projectName).toBe("ScenarioProject_v2");

		// Post-force, status no longer reports a mismatch.
		const post = JSON.parse(
			(await runVerb(statusVerb, env, { json: true })).stdout,
		) as StatusJson;
		expect(post.projectMismatch).toBeNull();
	});

	test("snapshot history survives the rebind — prior pull's state is preserved", async () => {
		env = makeTestEnv(simple);

		// First pull: materializes items and writes state.json.
		await runVerb(pullVerb, env);
		const statePath = join(env.workspace, ".volt", "snapshot", "state.json");
		const stateBefore = readFileSync(statePath, "utf-8");

		// Engineer renames the project in the IDE.
		env.bridge.mutateHealth({ projectName: "ScenarioProject_v2" });

		// `volt init --force` to accept the rename.
		const initResult = await runVerb(initVerb, env, { force: true });
		expect(initResult.exitCode).toBe(0);

		// state.json is unchanged — full snapshot history (commits +
		// recorded item versions) survives the rebind.
		const stateAfter = readFileSync(statePath, "utf-8");
		expect(stateAfter).toBe(stateBefore);
	});
});
