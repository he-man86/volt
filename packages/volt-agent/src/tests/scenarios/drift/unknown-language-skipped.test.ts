/**
 * Scenario: bridge sends a POU it couldn't classify (language ===
 * "UNKNOWN"). The pull must NOT crash and must NOT silently demote
 * the POU to `.st`. Instead, the materializer throws, the sync loop
 * catches per-item, the verb completes with exit 0, and the user is
 * told which item was skipped + why.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { pullVerb } from "../../../cli/pull.js";
import {
	listWorkspace,
	workspaceHas,
	workspaceHasFile,
} from "../../harness/assert-workspace.js";
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js";
import { runVerb } from "../../harness/run-verb.js";

let env: TestEnv | undefined;
afterEach(() => {
	env?.cleanup();
	env = undefined;
});

describe("scenario: bridge sends UNKNOWN body language", () => {
	test("pull completes; UNKNOWN POU is skipped + reported; other items still land", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "WeirdPOU",
					kind: "function_block",
					folder: "POUs",
					language: "UNKNOWN",
					sourceText: "FUNCTION_BLOCK WeirdPOU\nEND_FUNCTION_BLOCK\n",
				},
				{
					name: "GoodPOU",
					kind: "function_block",
					folder: "POUs",
					language: "ST",
					sourceText:
						"FUNCTION_BLOCK GoodPOU\n" +
						"VAR\n\tx: BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK\n",
				},
			],
		});
		const result = await runVerb(pullVerb, env);
		// Pull succeeds — one bad item doesn't poison the rest.
		expect(result.exitCode).toBe(0);
		// Good POU materialized.
		expect(workspaceHasFile(env.workspace, "POUs/GoodPOU.st")).toBe(true);
		// Weird POU NOT materialized — not as .st, not anywhere.
		expect(workspaceHas(env.workspace, "POUs/WeirdPOU.st")).toBe(false);
		expect(workspaceHas(env.workspace, "POUs/WeirdPOU.cfc")).toBe(false);
		expect(
			listWorkspace(env.workspace).some((p) => p.includes("WeirdPOU")),
		).toBe(false);
		// User-facing report mentions the skipped item.
		expect(result.stdout).toContain("WeirdPOU");
		expect(result.stdout.toLowerCase()).toContain("skipped");
	});
});
