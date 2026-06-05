/**
 * Push edits to source files. Verifies the round-trip:
 *   1. pull (so the workspace + snapshot agree on baseline)
 *   2. edit a .st file in the workspace
 *   3. push — bridge receives a pushItem op with the new text
 */
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { pullVerb } from "../../../cli/pull.js";
import { pushVerb } from "../../../cli/push.js";
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js";
import { runVerb } from "../../harness/run-verb.js";
import { simple } from "../../fixtures/projects/simple.js";

let env: TestEnv | undefined;
afterEach(() => {
	env?.cleanup();
	env = undefined;
});

describe("scenario: push source-file edits", () => {
	test("an edited .st file lands on the bridge", async () => {
		env = makeTestEnv(simple);
		await runVerb(pullVerb, env);

		const fbPath = join(env.workspace, "POUs/FB_Motor.st");
		const updatedBody =
			"FUNCTION_BLOCK FB_Motor\n" +
			"VAR_INPUT\n" +
			"\trun: BOOL;\n" +
			"\tspeed: REAL;\n" + // ← new field
			"END_VAR\n" +
			"VAR_OUTPUT\n" +
			"\trunning: BOOL;\n" +
			"END_VAR\n" +
			"\nrunning := run;\n\n" +
			"END_FUNCTION_BLOCK\n";
		writeFileSync(fbPath, updatedBody, "utf-8");

		const result = await runVerb(pushVerb, env);
		expect(result.exitCode).toBe(0);

		// The bridge received the new text. Real bridges receive
		// CRLF-normalized text (per the wire convention); the agent
		// denormalizes LF → CRLF before sending. Strip the CRs for
		// comparison so the assertion stays focused on content.
		const item = env.bridge.items.get("FB_Motor");
		expect(item?.sourceText.replace(/\r\n/g, "\n")).toBe(updatedBody);
	});

	test("a push that touches nothing exits cleanly without sending an op", async () => {
		env = makeTestEnv(simple);
		await runVerb(pullVerb, env);
		env.bridge.pushCalls = [];

		const result = await runVerb(pushVerb, env);
		expect(result.exitCode).toBe(0);
		expect(env.bridge.pushCalls).toEqual([]);
		expect(result.stdout).toContain("nothing to push");
	});
});
