/**
 * Hard-refusal on project-binding mismatch.
 *
 * `volt pull`, `volt push`, and `volt build` all hit `/health` early
 * and refuse with exit 2 when the bridge reports a different project
 * identity than `.volt/config.json` recorded. Protects against the
 * "engineer flipped to the wrong project in the IDE" footgun.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { build as buildVerb } from "../../../cli/build.js";
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

describe("scenario: project-binding mismatch refuses mutating verbs", () => {
	test("pull refuses with exit 2 when bridge reports a different projectName", async () => {
		// `makeTestEnv` writes config with `ScenarioProject/ScenarioPlc`.
		// Override the test bridge's health to report a renamed project
		// so the binding check fails on next pull.
		env = makeTestEnv({
			...simple,
			health: { projectName: "ScenarioProject_v2" },
		});

		const result = await runVerb(pullVerb, env);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("project-binding mismatch");
		expect(result.stderr).toContain("ScenarioProject");
		expect(result.stderr).toContain("ScenarioProject_v2");
		expect(result.stderr).toContain("volt init --force");
	});

	test("push refuses with exit 2 when bridge reports a different plcProjectName", async () => {
		env = makeTestEnv({
			...simple,
			health: { plcProjectName: "ScenarioPlc_renamed" },
		});

		const result = await runVerb(pushVerb, env);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("project-binding mismatch");
		expect(result.stderr).toContain("volt init --force");
	});

	test("build refuses with exit 2 when bridge reports a different platform", async () => {
		// Start with matched binding (default beckhoff), then mutate the
		// bridge's `/health` AFTER init — mirrors the real failure mode
		// where the engineer flips IDE focus mid-session. Setting
		// `health.platform` at makeTestEnv time would also flip the
		// saved config's platform, masking the mismatch.
		env = makeTestEnv(simple);
		env.bridge.mutateHealth({ platform: "codesys" });

		const result = await runVerb(buildVerb, env);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("project-binding mismatch");
		expect(result.stderr).toContain("beckhoff");
		expect(result.stderr).toContain("codesys");
	});

	test("pull succeeds when the bridge identity matches the saved binding", async () => {
		env = makeTestEnv(simple);
		const result = await runVerb(pullVerb, env);
		expect(result.exitCode).toBe(0);
	});
});
