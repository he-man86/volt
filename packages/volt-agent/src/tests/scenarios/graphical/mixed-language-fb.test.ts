/**
 * Scenario: an ST function block that contains one graphical action.
 * The action is non-textual, so the bridge surfaces it via
 * `graphicalChildren` instead of folding a stub into the parent's
 * sourceText.
 *
 * Layout after the graphical-inlining change:
 *
 *     POUs/MFB_UN_Unit.st     (single flat file — parent + inlined graphical child)
 *
 * The graphical child is preceded by a `(* @volt-graphical: LANG *)`
 * marker comment so the push path can strip it before sending to the
 * bridge (which owns the graphical body via XML).
 *
 * Uses SFC for the child body to keep tests deterministic — SFC routes
 * through the shell path (declaration + "body in IDE" comment + END_KIND).
 */
import { afterEach, describe, expect, test } from "bun:test";

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pullVerb } from "../../../cli/pull.js";
import { pushVerb } from "../../../cli/push.js";
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

const PARENT_ST_SOURCE =
	"FUNCTION_BLOCK MFB_UN_Unit\n" +
	"VAR\n" +
	"\tstep: INT;\n" +
	"END_VAR\n" +
	"step := step + 1;\n" +
	"END_FUNCTION_BLOCK\n";

const SFC_BODY_XML =
	"<body>\n" +
	"  <SFC>\n" +
	'    <step localId="1" name="Start"/>\n' +
	"  </SFC>\n" +
	"</body>";

describe("scenario: ST parent FB with an SFC child action (shell path)", () => {
	test("parent and SFC child are inlined into a single flat .st file", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "MFB_UN_Unit",
					kind: "function_block",
					folder: "POUs",
					language: "ST",
					sourceText: PARENT_ST_SOURCE,
					graphicalChildren: [
						{
							name: "P10_CyclicMotion",
							kind: "action",
							language: "SFC",
							declaration: "ACTION P10_CyclicMotion",
							implementationXml: SFC_BODY_XML,
						},
					],
				},
			],
		});
		const result = await runVerb(pullVerb, env);
		expect(result.exitCode).toBe(0);

		// Single flat .st file — no nested folder.
		expect(workspaceHasFile(env.workspace, "src/POUs/MFB_UN_Unit.st")).toBe(true);
		// Old nested paths must NOT exist.
		expect(workspaceHas(env.workspace, "src/POUs/MFB_UN_Unit/MFB_UN_Unit.st")).toBe(false);
		expect(workspaceHas(env.workspace, "src/POUs/MFB_UN_Unit/P10_CyclicMotion.sfc")).toBe(false);

		const text = readWorkspace(env.workspace, "src/POUs/MFB_UN_Unit.st");
		// Parent ST body is present.
		expect(text).toContain("FUNCTION_BLOCK MFB_UN_Unit");
		expect(text).toContain("step := step + 1;");
		// Graphical child is inlined with the marker.
		expect(text).toContain("(* @volt-graphical: SFC *)");
		expect(text).toContain("ACTION P10_CyclicMotion");
		expect(text).toContain("body authored in IDE");
		expect(text).toContain("END_ACTION");
	});

	test("push strips the graphical section and sends only the ST body to bridge", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "MFB_UN_Unit",
					kind: "function_block",
					folder: "POUs",
					language: "ST",
					sourceText: PARENT_ST_SOURCE,
					graphicalChildren: [
						{
							name: "P10_CyclicMotion",
							kind: "action",
							language: "SFC",
							declaration: "ACTION P10_CyclicMotion",
							implementationXml: SFC_BODY_XML,
						},
					],
				},
			],
		});
		await runVerb(pullVerb, env);

		// Make a textual edit to the ST parent portion.
		const stPath = join(env.workspace, "src", "POUs", "MFB_UN_Unit.st");
		const original = readWorkspace(env.workspace, "src/POUs/MFB_UN_Unit.st");
		writeFileSync(
			stPath,
			original.replace("step := step + 1;", "step := step + 2;"),
		);

		const pushResult = await runVerb(pushVerb, env);
		expect(pushResult.exitCode).toBe(0);

		// Bridge received only the ST body — graphical section stripped.
		const sent = env.bridge.items.get("MFB_UN_Unit")?.sourceText.replace(/\r\n/g, "\n");
		expect(sent).toBeDefined();
		expect(sent).toContain("FUNCTION_BLOCK MFB_UN_Unit");
		expect(sent).toContain("step := step + 2;");
		// No graphical marker in what the bridge received.
		expect(sent).not.toContain("@volt-graphical");
		expect(sent).not.toContain("ACTION P10_CyclicMotion");
	});

	test("removing the graphical child leaves only the ST body in the .st file", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "MFB_UN_Unit",
					kind: "function_block",
					folder: "POUs",
					language: "ST",
					sourceText: PARENT_ST_SOURCE,
					graphicalChildren: [
						{
							name: "P10_CyclicMotion",
							kind: "action",
							language: "SFC",
							declaration: "ACTION P10_CyclicMotion",
							implementationXml: SFC_BODY_XML,
						},
					],
				},
			],
		});
		await runVerb(pullVerb, env);
		expect(readWorkspace(env.workspace, "src/POUs/MFB_UN_Unit.st")).toContain(
			"(* @volt-graphical: SFC *)",
		);

		// Engineer removed the action in the IDE; bridge re-emits without graphicalChildren.
		const stored = env.bridge.items.get("MFB_UN_Unit")!;
		stored.graphicalChildren = undefined;
		const second = await runVerb(pullVerb, env);
		expect(second.exitCode).toBe(0);

		const text = readWorkspace(env.workspace, "src/POUs/MFB_UN_Unit.st");
		// Graphical section gone, ST parent still there.
		expect(text).not.toContain("(* @volt-graphical: SFC *)");
		expect(text).not.toContain("ACTION P10_CyclicMotion");
		expect(text).toContain("FUNCTION_BLOCK MFB_UN_Unit");
		// File is still flat.
		expect(workspaceHasFile(env.workspace, "src/POUs/MFB_UN_Unit.st")).toBe(true);
		expect(workspaceHas(env.workspace, "src/POUs/MFB_UN_Unit/MFB_UN_Unit.st")).toBe(false);
	});

	test("adding a graphical child appends it inline to the existing .st file", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "MFB_UN_Unit",
					kind: "function_block",
					folder: "POUs",
					language: "ST",
					sourceText: PARENT_ST_SOURCE,
					// No graphical children initially.
				},
			],
		});
		await runVerb(pullVerb, env);
		// Initial layout — just the ST body, no marker.
		expect(readWorkspace(env.workspace, "src/POUs/MFB_UN_Unit.st")).toBe(PARENT_ST_SOURCE);

		// Engineer adds a graphical action in the IDE.
		const stored = env.bridge.items.get("MFB_UN_Unit")!;
		stored.graphicalChildren = [
			{
				name: "P10_CyclicMotion",
				kind: "action",
				language: "SFC",
				declaration: "ACTION P10_CyclicMotion",
				implementationXml: SFC_BODY_XML,
			},
		];

		await runVerb(pullVerb, env);
		// Same flat path, now includes inlined graphical child.
		expect(workspaceHasFile(env.workspace, "src/POUs/MFB_UN_Unit.st")).toBe(true);
		const text = readWorkspace(env.workspace, "src/POUs/MFB_UN_Unit.st");
		expect(text).toContain("(* @volt-graphical: SFC *)");
		expect(text).toContain("ACTION P10_CyclicMotion");
		// No separate sibling file.
		expect(workspaceHas(env.workspace, "src/POUs/MFB_UN_Unit/P10_CyclicMotion.sfc")).toBe(false);
	});
});
