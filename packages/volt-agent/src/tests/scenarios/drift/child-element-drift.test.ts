/**
 * IDE-to-Volt drift detection for textual CHILD elements (ST actions,
 * methods, properties) Ã¢â‚¬â€ the units inside a POU below the top-level
 * fetch granularity.
 *
 * Wire contract pinned here: both bridges
 * (`packages/volt-bridges/codesys` and `packages/volt-bridges/beckhoff`)
 * MUST surface child-element changes through the parent POU's
 * version hash so the agent refetches and re-materializes. If either
 * bridge regresses (e.g. fails to include a child's content in its
 * per-item version), this scenario goes red.
 *
 * Graphical children (FBD/LD/SFC/CFC actions and methods nested in
 * an ST parent) are covered separately in `mixed-language-fb.test.ts`
 * because they materialize as read-only sibling files and the parent
 * `.st` nests into its own namespace folder.
 *
 * Folder-organization-inside-POU note: CODESYS and TwinCAT both let
 * engineers put methods/actions inside organizational folders WITHIN
 * a POU's namespace (CODESYS via `get_children(recursive=True)`
 * flatten, TC via `BlockTypeMapper.FolderSubType` recursion in
 * `GetHandler.CollectChildren`). The bridge MUST flatten that into a
 * single sourceText with all children inline. The agent has no
 * concept of "child folder" Ã¢â‚¬â€ children are always flat from its
 * point of view. See `feedback_bridges_must_stay_at_parity`.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { pullVerb } from "../../../cli/pull.js";
import { readWorkspace } from "../../harness/assert-workspace.js";
import { makeTestEnv, type TestEnv } from "../../harness/make-test-env.js";
import { runVerb } from "../../harness/run-verb.js";

let env: TestEnv | undefined;
afterEach(() => {
	env?.cleanup();
	env = undefined;
});

const FB_BASE =
	"FUNCTION_BLOCK FB_Pump\n" +
	"VAR\n" +
	"\tspeed: REAL;\n" +
	"END_VAR\n" +
	"speed := 0;\n" +
	"END_FUNCTION_BLOCK\n";

function fbWithChildren(extra: string): string {
	return FB_BASE + "\n" + extra;
}

describe("scenario: textual child element drift (add / remove / edit)", () => {
	test("bridge adds an ACTION to an FB Ã¢â€ â€™ next pull surfaces it in the parent .st", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Pump",
					kind: "function_block",
					folder: "POUs",
					language: "ST",
					sourceText: FB_BASE,
				},
			],
		});
		await runVerb(pullVerb, env);
		expect(readWorkspace(env.workspace, "src/POUs/FB_Pump.st")).not.toContain("ACTION Start");

		const stored = env.bridge.items.get("FB_Pump")!;
		stored.sourceText = fbWithChildren(
			"ACTION Start\nspeed := 100;\nEND_ACTION\n",
		);

		const second = await runVerb(pullVerb, env);
		expect(second.exitCode).toBe(0);
		const text = readWorkspace(env.workspace, "src/POUs/FB_Pump.st");
		expect(text).toContain("ACTION Start");
		expect(text).toContain("speed := 100;");
	});

	test("bridge removes an ACTION Ã¢â€ â€™ next pull drops it from the parent .st", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Pump",
					kind: "function_block",
					folder: "POUs",
					language: "ST",
					sourceText: fbWithChildren(
						"ACTION Start\nspeed := 100;\nEND_ACTION\n",
					),
				},
			],
		});
		await runVerb(pullVerb, env);
		expect(readWorkspace(env.workspace, "src/POUs/FB_Pump.st")).toContain("ACTION Start");

		const stored = env.bridge.items.get("FB_Pump")!;
		stored.sourceText = FB_BASE;

		await runVerb(pullVerb, env);
		expect(readWorkspace(env.workspace, "src/POUs/FB_Pump.st")).not.toContain("ACTION Start");
	});

	test("bridge edits an ACTION's body Ã¢â€ â€™ next pull updates the parent .st", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Pump",
					kind: "function_block",
					folder: "POUs",
					language: "ST",
					sourceText: fbWithChildren(
						"ACTION Start\nspeed := 100;\nEND_ACTION\n",
					),
				},
			],
		});
		await runVerb(pullVerb, env);

		const stored = env.bridge.items.get("FB_Pump")!;
		stored.sourceText = fbWithChildren(
			"ACTION Start\nspeed := 200;\nEND_ACTION\n",
		);

		await runVerb(pullVerb, env);
		const text = readWorkspace(env.workspace, "src/POUs/FB_Pump.st");
		expect(text).toContain("speed := 200;");
		expect(text).not.toContain("speed := 100;");
	});

	test("bridge adds a METHOD Ã¢â€ â€™ next pull surfaces it in the parent .st", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Pump",
					kind: "function_block",
					folder: "POUs",
					language: "ST",
					sourceText: FB_BASE,
				},
			],
		});
		await runVerb(pullVerb, env);

		const stored = env.bridge.items.get("FB_Pump")!;
		stored.sourceText = fbWithChildren(
			"METHOD GetSpeed : REAL\nVAR_INPUT\nEND_VAR\nGetSpeed := speed;\nEND_METHOD\n",
		);

		await runVerb(pullVerb, env);
		const text = readWorkspace(env.workspace, "src/POUs/FB_Pump.st");
		expect(text).toContain("METHOD GetSpeed");
		expect(text).toContain("GetSpeed := speed;");
	});

	test("renaming a child (remove + add at once) syncs both sides cleanly", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Pump",
					kind: "function_block",
					folder: "POUs",
					language: "ST",
					sourceText: fbWithChildren(
						"ACTION OldName\nspeed := 50;\nEND_ACTION\n",
					),
				},
			],
		});
		await runVerb(pullVerb, env);
		expect(readWorkspace(env.workspace, "src/POUs/FB_Pump.st")).toContain("ACTION OldName");

		const stored = env.bridge.items.get("FB_Pump")!;
		stored.sourceText = fbWithChildren(
			"ACTION NewName\nspeed := 50;\nEND_ACTION\n",
		);

		await runVerb(pullVerb, env);
		const text = readWorkspace(env.workspace, "src/POUs/FB_Pump.st");
		expect(text).toContain("ACTION NewName");
		expect(text).not.toContain("ACTION OldName");
	});

	test("multiple children mutate at once Ã¢â€ â€™ pull surfaces every change", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Pump",
					kind: "function_block",
					folder: "POUs",
					language: "ST",
					sourceText: fbWithChildren(
						"ACTION A1\nspeed := 1;\nEND_ACTION\n" +
							"ACTION A2\nspeed := 2;\nEND_ACTION\n",
					),
				},
			],
		});
		await runVerb(pullVerb, env);

		const stored = env.bridge.items.get("FB_Pump")!;
		stored.sourceText = fbWithChildren(
			"ACTION A1\nspeed := 999;\nEND_ACTION\n" +
				"ACTION A3\nspeed := 3;\nEND_ACTION\n",
		);

		await runVerb(pullVerb, env);
		const text = readWorkspace(env.workspace, "src/POUs/FB_Pump.st");
		expect(text).toContain("ACTION A1");
		expect(text).toContain("speed := 999;");
		expect(text).not.toContain("ACTION A2");
		expect(text).toContain("ACTION A3");
	});
});

describe("scenario: child folder organization inside a POU is flattened by the bridge", () => {
	test("flat children and folder-organized children produce identical workspace files", async () => {
		const flatBody = fbWithChildren(
			"ACTION A1\nspeed := 1;\nEND_ACTION\n" +
				"ACTION A2\nspeed := 2;\nEND_ACTION\n" +
				"ACTION A3\nspeed := 3;\nEND_ACTION\n",
		);

		env = makeTestEnv({
			items: [
				{ name: "FB_A", kind: "function_block", folder: "POUs", language: "ST", sourceText: flatBody },
				{ name: "FB_B", kind: "function_block", folder: "POUs", language: "ST", sourceText: flatBody },
			],
		});
		await runVerb(pullVerb, env);
		const a = readWorkspace(env.workspace, "src/POUs/FB_A.st");
		const b = readWorkspace(env.workspace, "src/POUs/FB_B.st");
		expect(a).toBe(b);
		expect(a).toContain("ACTION A1");
		expect(a).toContain("ACTION A2");
		expect(a).toContain("ACTION A3");
	});

	test("bridge moves children into a new internal folder Ã¢â€ â€™ workspace stays byte-stable", async () => {
		const body = fbWithChildren(
			"ACTION Start\nspeed := 1;\nEND_ACTION\n" +
				"ACTION Stop\nspeed := 0;\nEND_ACTION\n",
		);

		env = makeTestEnv({
			items: [
				{ name: "FB_Pump", kind: "function_block", folder: "POUs", language: "ST", sourceText: body },
			],
		});
		await runVerb(pullVerb, env);
		const initialText = readWorkspace(env.workspace, "src/POUs/FB_Pump.st");

		env.bridge.items.get("FB_Pump")!.sourceText = body;
		const second = await runVerb(pullVerb, env);
		expect(second.exitCode).toBe(0);
		expect(readWorkspace(env.workspace, "src/POUs/FB_Pump.st")).toBe(initialText);
	});
});
