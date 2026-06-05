/**
 * Pushing edits to config files (.library, .task, .device, …) is
 * refused by default — those kinds are `r` (read-only) per the
 * registry. The engineer owns them in the IDE; the agent can read
 * them for context but never writes them back.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { pullVerb } from "../../../cli/pull.js";
import { pushVerb } from "../../../cli/push.js";
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js";
import { runVerb } from "../../harness/run-verb.js";
import { withConfig } from "../../fixtures/projects/with-config.js";

let env: TestEnv | undefined;
afterEach(() => {
	env?.cleanup();
	env = undefined;
});

describe("scenario: push refuses read-only extensions", () => {
	test("editing a .library file blocks push with a clear refusal", async () => {
		env = makeTestEnv(withConfig);
		await runVerb(pullVerb, env);

		// Engineer-style edit on a read-only config file.
		writeFileSync(
			join(
				env.workspace,
				"Device/Plc Logic/Application/Library Manager/IoStandard.library",
			),
			"resolution = TampedVersion\n",
			"utf-8",
		);

		const before = env.bridge.items.get("IoStandard")?.sourceText;
		const result = await runVerb(pushVerb, env);
		expect(result.exitCode).toBe(2);
		// Bridge state unchanged — push didn't go through.
		const after = env.bridge.items.get("IoStandard")?.sourceText;
		expect(after).toBe(before);
		// Helpful error tells the user how to override if they really want.
		expect(result.stderr).toContain(".library");
		expect(result.stderr).toContain("extensionAccess");
	});

	test("editing a .device file blocks push", async () => {
		env = makeTestEnv(withConfig);
		await runVerb(pullVerb, env);
		writeFileSync(
			join(env.workspace, "Device.device"),
			"device-id = MUTATED\n",
			"utf-8",
		);
		const result = await runVerb(pushVerb, env);
		expect(result.exitCode).toBe(2);
	});
});
