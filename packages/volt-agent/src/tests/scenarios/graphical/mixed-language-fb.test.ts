/**
 * Scenario: an ST function block that contains one graphical action.
 * The action is non-textual, so the bridge surfaces it via
 * `graphicalChildren` instead of folding an empty `ACTION ... /
 * END_ACTION` stub into the parent's sourceText.
 *
 * Layout when a POU has graphical children:
 *
 *     POUs/MFB_UN_Unit/MFB_UN_Unit.st     (parent Ã¢â‚¬â€ nested in own folder)
 *     POUs/MFB_UN_Unit/P10_CyclicMotion.sfc  (graphical child Ã¢â‚¬â€ read-only sibling)
 *
 * Regression test for the original Lenze MFB_UN_Unit case
 * (P10_CyclicMotion was an FBD action under an ST FB).
 *
 * Uses SFC for the child body to keep tests deterministic Ã¢â‚¬â€ SFC routes
 * through the shell path (declaration + "body in IDE" comment + END_KIND).
 * FBD/LD children go through the same transpiler as top-level FBD POUs;
 * that path is covered by `mixed-language-fb-transpile.test.ts` (next door)
 * with a real FBD fixture.
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
	test("parent nests into its own folder; SFC child is a sibling read-only file", async () => {
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

		// Parent: nested into its own namespace folder.
		expect(workspaceHasFile(env.workspace, "src/POUs/MFB_UN_Unit/MFB_UN_Unit.st")).toBe(true);
		// Old non-nested location must NOT exist.
		expect(workspaceHas(env.workspace, "src/POUs/MFB_UN_Unit.st")).toBe(false);
		const parentText = readWorkspace(env.workspace, "src/POUs/MFB_UN_Unit/MFB_UN_Unit.st");
		expect(parentText).toBe(PARENT_ST_SOURCE);
		// NO empty ACTION stub for the graphical child Ã¢â‚¬â€ that would
		// silently mask the IDE's real body if pushed back.
		expect(parentText).not.toContain("ACTION P10_CyclicMotion");

		// Graphical child: sibling .sfc file under the same folder.
		expect(
			workspaceHasFile(env.workspace, "src/POUs/MFB_UN_Unit/P10_CyclicMotion.sfc"),
		).toBe(true);
		const childText = readWorkspace(
			env.workspace,
			"src/POUs/MFB_UN_Unit/P10_CyclicMotion.sfc",
		);
		expect(childText).toContain("ACTION P10_CyclicMotion");
		expect(childText).toContain("body authored in IDE");
		expect(childText).toContain("END_ACTION");
	});

	test("the graphical child is read-only Ã¢â‚¬â€ push refuses any edit", async () => {
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
		writeFileSync(
			join(env.workspace, "src", "POUs", "MFB_UN_Unit", "P10_CyclicMotion.sfc"),
			"corrupted by engineer\n",
		);
		const pushResult = await runVerb(pushVerb, env);
		expect(pushResult.exitCode).not.toBe(0);
		expect(env.bridge.pushCalls.length).toBe(0);
	});

	test("removing the graphical child cleans up the sibling file AND the parent moves back to its non-nested layout", async () => {
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
		expect(workspaceHasFile(env.workspace, "src/POUs/MFB_UN_Unit/MFB_UN_Unit.st")).toBe(true);

		// Engineer removed the action in the IDE; bridge re-emits the
		// parent with no graphicalChildren.
		const stored = env.bridge.items.get("MFB_UN_Unit")!;
		stored.graphicalChildren = undefined;
		const second = await runVerb(pullVerb, env);
		expect(second.exitCode).toBe(0);

		// Sibling file gone.
		expect(workspaceHas(env.workspace, "src/POUs/MFB_UN_Unit/P10_CyclicMotion.sfc")).toBe(false);
		// Parent moved back to the non-nested layout because no
		// graphical children means no namespace folder is needed.
		expect(workspaceHasFile(env.workspace, "src/POUs/MFB_UN_Unit.st")).toBe(true);
		expect(workspaceHas(env.workspace, "src/POUs/MFB_UN_Unit/MFB_UN_Unit.st")).toBe(false);
	});

	test("adding a graphical child moves the parent INTO its namespace folder", async () => {
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
		// Initial layout Ã¢â‚¬â€ non-nested.
		expect(workspaceHasFile(env.workspace, "src/POUs/MFB_UN_Unit.st")).toBe(true);
		expect(workspaceHas(env.workspace, "src/POUs/MFB_UN_Unit/MFB_UN_Unit.st")).toBe(false);

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
		// Parent now lives inside its own folder, alongside the child.
		expect(workspaceHasFile(env.workspace, "src/POUs/MFB_UN_Unit/MFB_UN_Unit.st")).toBe(true);
		expect(workspaceHasFile(env.workspace, "src/POUs/MFB_UN_Unit/P10_CyclicMotion.sfc")).toBe(true);
		// Old top-level location swept.
		expect(workspaceHas(env.workspace, "src/POUs/MFB_UN_Unit.st")).toBe(false);
	});
});
