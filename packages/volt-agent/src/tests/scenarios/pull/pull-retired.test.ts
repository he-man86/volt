/**
 * When the bridge no longer reports an item the workspace had,
 * pull should remove the corresponding file. Empty parent dirs
 * left behind should be swept.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { pullVerb } from "../../../cli/pull.js";
import {
	listWorkspace,
	workspaceHasFile,
} from "../../harness/assert-workspace.js";
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js";
import { runVerb } from "../../harness/run-verb.js";
import { simple } from "../../fixtures/projects/simple.js";

let env: TestEnv | undefined;
afterEach(() => {
	env?.cleanup();
	env = undefined;
});

describe("scenario: pull removes retired items", () => {
	test("an item the bridge deletes disappears from workspace on next pull", async () => {
		env = makeTestEnv(simple);
		await runVerb(pullVerb, env);
		expect(workspaceHasFile(env.workspace, "src/POUs/Types/DUT_MotorState.struct")).toBe(true);

		// Engineer deleted the DUT in CODESYS Ã¢â‚¬â€ bridge no longer
		// reports it.
		env.bridge.items.delete("DUT_MotorState");

		const result = await runVerb(pullVerb, env);
		expect(result.exitCode).toBe(0);
		expect(workspaceHasFile(env.workspace, "src/POUs/Types/DUT_MotorState.struct")).toBe(false);
		// Other items still present.
		expect(workspaceHasFile(env.workspace, "src/POUs/FB_Motor.st")).toBe(true);
		expect(workspaceHasFile(env.workspace, "src/POUs/GVL_Config.gvl")).toBe(true);
	});

	test("emptied parent dirs get swept", async () => {
		env = makeTestEnv(simple);
		await runVerb(pullVerb, env);
		// Remove the only thing under POUs/Types/.
		env.bridge.items.delete("DUT_MotorState");
		await runVerb(pullVerb, env);
		// The empty Types/ folder should be swept by the post-pull
		// dir-cleanup pass.
		const files = listWorkspace(env.workspace);
		expect(files.some((f) => f.startsWith("src/POUs/Types/"))).toBe(false);
	});
});
