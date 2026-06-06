/**
 * `volt pull --force` discards local workspace edits and refetches
 * everything from the bridge.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { pullVerb } from "../../../cli/pull.js";
import { readWorkspace } from "../../harness/assert-workspace.js";
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js";
import { runVerb } from "../../harness/run-verb.js";
import { simple } from "../../fixtures/projects/simple.js";

let env: TestEnv | undefined;
afterEach(() => {
	env?.cleanup();
	env = undefined;
});

describe("scenario: pull --force", () => {
	test("overwrites workspace edits the engineer didn't ask to keep", async () => {
		env = makeTestEnv(simple);
		await runVerb(pullVerb, env);

		// User edited a file locally â€” workspace is now dirty.
		const fbPath = join(env.workspace, "src/POUs/FB_Motor.st");
		writeFileSync(fbPath, "// local junk\n", "utf-8");

		// `volt pull` (without --force) would refuse on dirty.
		const refuse = await runVerb(pullVerb, env);
		expect(refuse.exitCode).toBe(2);
		expect(refuse.stderr).toMatch(/pull refused|workspace edit/i);

		// `volt pull --force` discards the edit and refetches.
		const forced = await runVerb(pullVerb, env, { force: true });
		expect(forced.exitCode).toBe(0);
		const restored = readWorkspace(env.workspace, "src/POUs/FB_Motor.st");
		expect(restored).toContain("FUNCTION_BLOCK FB_Motor");
		expect(restored).not.toContain("local junk");
	});
});
