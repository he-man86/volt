/**
 * Scenario: a top-level POU whose body language is CFC (or SFC).
 *
 * After the graphical-inlining change, ALL body languages resolve to
 * `.st`. Graphical POUs land as `.st` files with a
 * `(* @volt-graphical: LANG *)` marker at the top so the push path
 * knows to strip the generated body and only send the declaration.
 *
 * This is the regression test for the MMT case: MMT is CFC in the IDE
 * and must materialize as `MMT.st` (NOT `MMT.cfc`).
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

describe("scenario: CFC function block lands as .st with graphical marker", () => {
	test("file is materialized at <name>.st with (* @volt-graphical: CFC *) marker", async () => {
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
		expect(workspaceHasFile(env.workspace, "src/POUs/MMT.st")).toBe(true);
		// Critical: NOT under the old .cfc extension.
		expect(workspaceHas(env.workspace, "src/POUs/MMT.cfc")).toBe(false);
		const text = readWorkspace(env.workspace, "src/POUs/MMT.st");
		// Marker is first line.
		expect(text.startsWith("(* @volt-graphical: CFC *)")).toBe(true);
		// Declaration body follows the marker.
		expect(text).toContain("FUNCTION_BLOCK MMT");
		expect(text).toContain("run: BOOL");
	});

	test("push strips the graphical marker and sends only the declaration to bridge", async () => {
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

		// Engineer adds a new VAR to the declaration section.
		const stPath = join(env.workspace, "src", "POUs", "MMT.st");
		const original = readWorkspace(env.workspace, "src/POUs/MMT.st");
		writeFileSync(
			stPath,
			original.replace("run: BOOL;", "run: BOOL;\n\tspeed: REAL;"),
		);

		const pushResult = await runVerb(pushVerb, env);
		expect(pushResult.exitCode).toBe(0);

		// Bridge received the declaration WITHOUT the marker line.
		const sent = env.bridge.items.get("MMT")?.sourceText.replace(/\r\n/g, "\n");
		expect(sent).toBeDefined();
		expect(sent).toContain("FUNCTION_BLOCK MMT");
		expect(sent).toContain("speed: REAL;");
		expect(sent).not.toContain("@volt-graphical");
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
		expect(workspaceHasFile(env.workspace, "src/POUs/Sequencer.st")).toBe(true);
		expect(workspaceHas(env.workspace, "src/POUs/Sequencer.sfc")).toBe(false);
		const text = readWorkspace(env.workspace, "src/POUs/Sequencer.st");
		expect(text.startsWith("(* @volt-graphical: SFC *)")).toBe(true);
	});
});
