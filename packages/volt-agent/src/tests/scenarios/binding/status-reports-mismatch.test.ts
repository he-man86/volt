/**
 * `volt status --json` reports project-binding mismatch in its output
 * but exits 0 — status is informational so the VS Code SCM view can
 * render a useful warning. (Pull/push/build refuse instead; see
 * mismatch-refuses-pull-push.test.ts.)
 */
import { afterEach, describe, expect, test } from "bun:test";

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
	initialized: boolean;
	incoming: { added: string[]; modified: string[]; removed: string[] };
	projectMismatch: null | {
		configuredAs: { platform: string; projectName: string; plcProjectName: string };
		bridgeReports: { platform: string; projectName: string; plcProjectName: string };
		diffFields: string[];
	};
}

describe("scenario: status emits projectMismatch when bridge identity diverges", () => {
	test("matched binding → projectMismatch is null", async () => {
		env = makeTestEnv(simple);

		const result = await runVerb(statusVerb, env, { json: true });
		expect(result.exitCode).toBe(0);
		const out = JSON.parse(result.stdout) as StatusJson;
		expect(out.projectMismatch).toBeNull();
	});

	test("renamed projectName → status exits 0 with projectMismatch populated", async () => {
		env = makeTestEnv({
			...simple,
			health: { projectName: "ScenarioProject_v2" },
		});

		const result = await runVerb(statusVerb, env, { json: true });
		expect(result.exitCode).toBe(0);
		const out = JSON.parse(result.stdout) as StatusJson;
		expect(out.projectMismatch).not.toBeNull();
		expect(out.projectMismatch?.configuredAs.projectName).toBe("ScenarioProject");
		expect(out.projectMismatch?.bridgeReports.projectName).toBe("ScenarioProject_v2");
		expect(out.projectMismatch?.diffFields).toEqual(["projectName"]);
	});

	test("multiple fields differ → diffFields lists them in declaration order", async () => {
		env = makeTestEnv({
			...simple,
			health: {
				projectName: "ScenarioProject_v2",
				plcProjectName: "ScenarioPlc_v2",
			},
		});

		const result = await runVerb(statusVerb, env, { json: true });
		const out = JSON.parse(result.stdout) as StatusJson;
		expect(out.projectMismatch?.diffFields).toEqual(["projectName", "plcProjectName"]);
	});

	test("status still computes incoming alongside the mismatch warning", async () => {
		env = makeTestEnv({
			...simple,
			health: { projectName: "ScenarioProject_v2" },
		});

		const result = await runVerb(statusVerb, env, { json: true });
		const out = JSON.parse(result.stdout) as StatusJson;
		// `simple` has 3 items; with no prior pull they all appear incoming.
		expect(out.incoming.added.length).toBeGreaterThan(0);
		expect(out.projectMismatch).not.toBeNull();
	});
});
