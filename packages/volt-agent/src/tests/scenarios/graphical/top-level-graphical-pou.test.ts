/**
 * Scenario: a top-level POU whose body language is CFC. The bridge
 * has no transpile path for CFC, and Volt has no editor for it, so
 * the file MUST land as `<name>.cfc` (NOT silently demoted to `.st`)
 * and MUST be read-only.
 *
 * This is the regression test for the MMT case the user reported:
 * MMT is CFC in the IDE but used to materialize as `MMT.st`.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { pullVerb } from "../../../cli/pull.js";
import { pushVerb } from "../../../cli/push.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	readWorkspace,
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

const CFC_SOURCE_TEXT =
	"FUNCTION_BLOCK MMT\n" +
	"VAR_INPUT\n" +
	"\trun: BOOL;\n" +
	"END_VAR\n" +
	"VAR_OUTPUT\n" +
	"\tdone: BOOL;\n" +
	"END_VAR\n" +
	"END_FUNCTION_BLOCK\n";

describe("scenario: CFC function block lands as .cfc and is read-only", () => {
	test("file is materialized at <name>.cfc, not <name>.st", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "MMT",
					kind: "function_block",
					folder: "POUs",
					language: "CFC",
					sourceText: CFC_SOURCE_TEXT,
				},
			],
		});
		const result = await runVerb(pullVerb, env);
		expect(result.exitCode).toBe(0);
		expect(workspaceHasFile(env.workspace, "POUs/MMT.cfc")).toBe(true);
		// Critical: NOT under the ST extension.
		expect(workspaceHas(env.workspace, "POUs/MMT.st")).toBe(false);
		// Content is the bridge's sourceText verbatim — declaration only,
		// no fake transpile attempt for a language we can't transpile.
		expect(readWorkspace(env.workspace, "POUs/MMT.cfc")).toBe(CFC_SOURCE_TEXT);
	});

	test("editing the .cfc file is refused on push (read-only by default)", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "MMT",
					kind: "function_block",
					folder: "POUs",
					language: "CFC",
					sourceText: CFC_SOURCE_TEXT,
				},
			],
		});
		await runVerb(pullVerb, env);
		// Mutate the workspace file the way an editor would.
		writeFileSync(
			join(env.workspace, "POUs", "MMT.cfc"),
			CFC_SOURCE_TEXT + "(* engineer-typed edit *)\n",
		);
		const pushResult = await runVerb(pushVerb, env);
		// Non-zero exit and no push call landed at the bridge.
		expect(pushResult.exitCode).not.toBe(0);
		expect(env.bridge.pushCalls.length).toBe(0);
	});

	test("SFC top-level POU follows the same rule", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "Sequencer",
					kind: "program",
					folder: "POUs",
					language: "SFC",
					sourceText:
						"PROGRAM Sequencer\nVAR\n\tstep: INT;\nEND_VAR\nEND_PROGRAM\n",
				},
			],
		});
		const result = await runVerb(pullVerb, env);
		expect(result.exitCode).toBe(0);
		expect(workspaceHasFile(env.workspace, "POUs/Sequencer.sfc")).toBe(true);
		expect(workspaceHas(env.workspace, "POUs/Sequencer.st")).toBe(false);
	});
});
