/**
 * Move detection — bidirectional drift scenarios.
 *
 * Foundation principle (mirrors git's design): per-item version =
 * SHA1(content + location + structure). An item's identity is its
 * stable `name`; the folder is content. A MOVE = same name, new
 * folder → version bump → existing drift machinery handles it. No
 * `/move` verb on the wire, no rename heuristics, no similarity
 * matching — we have explicit names so we don't need them.
 *
 * Both directions covered:
 *   - IDE → workspace: bridge re-emits an item with a new folder;
 *     pull moves the workspace file.
 *   - Workspace → IDE: engineer drags an `.st` file to a new folder;
 *     push emits a `moveItem` op the bridge applies.
 *
 * TestBridge already includes folder in its per-item hash
 * (`hashItem` in `bridge/test-bridge.ts`) so these scenarios work
 * without any real-bridge change — they pin the AGENT side of the
 * contract. The CODESYS and Beckhoff bridges' `compute_item_version`
 * / `ComputeItemVersion` also include folder now (see
 * `codesys_connection.py:compute_item_version` and
 * `BeckhoffConnection.cs:ComputeItemVersion`); the live full-cycle
 * test confirms parity there.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
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

const FB_SOURCE =
	"FUNCTION_BLOCK FB_Motor\n" +
	"VAR\n\tspeed: REAL;\n\trunning: BOOL;\nEND_VAR\n" +
	"speed := 0;\n" +
	"END_FUNCTION_BLOCK\n";

describe("scenario: IDE moves a POU → next pull mirrors the move into the workspace", () => {
	test("simple folder change → file appears at new path, old path swept", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Motor",
					kind: "function_block",
					folder: "POUs/Motors",
					language: "ST",
					sourceText: FB_SOURCE,
				},
			],
		});
		await runVerb(pullVerb, env);
		expect(workspaceHasFile(env.workspace, "POUs/Motors/FB_Motor.st")).toBe(true);

		// Engineer moves FB_Motor from POUs/Motors → POUs/Archived in
		// the IDE. Bridge re-emits with the new folder. Folder
		// participates in the version hash so the version bumps —
		// agent's drift detection refetches and the materializer
		// writes at the new path.
		env.bridge.items.get("FB_Motor")!.folder = "POUs/Archived";

		const second = await runVerb(pullVerb, env);
		expect(second.exitCode).toBe(0);
		expect(workspaceHasFile(env.workspace, "POUs/Archived/FB_Motor.st")).toBe(true);
		// Old path swept by the retired-files cleanup.
		expect(workspaceHas(env.workspace, "POUs/Motors/FB_Motor.st")).toBe(false);
	});

	test("move + content edit happen together → single pull captures both", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Motor",
					kind: "function_block",
					folder: "POUs/Motors",
					language: "ST",
					sourceText: FB_SOURCE,
				},
			],
		});
		await runVerb(pullVerb, env);
		expect(readWorkspace(env.workspace, "POUs/Motors/FB_Motor.st")).toContain("speed := 0;");

		// Engineer moves AND edits in the IDE session.
		const stored = env.bridge.items.get("FB_Motor")!;
		stored.folder = "POUs/Archived";
		stored.sourceText = FB_SOURCE.replace("speed := 0;", "speed := 42;");

		await runVerb(pullVerb, env);
		expect(workspaceHasFile(env.workspace, "POUs/Archived/FB_Motor.st")).toBe(true);
		expect(readWorkspace(env.workspace, "POUs/Archived/FB_Motor.st")).toContain("speed := 42;");
		expect(workspaceHas(env.workspace, "POUs/Motors/FB_Motor.st")).toBe(false);
	});

	test("move to root folder (empty string) → file lands at workspace top", async () => {
		env = makeTestEnv({
			items: [
				{
					name: "FB_Motor",
					kind: "function_block",
					folder: "POUs/Motors",
					language: "ST",
					sourceText: FB_SOURCE,
				},
			],
		});
		await runVerb(pullVerb, env);

		env.bridge.items.get("FB_Motor")!.folder = "";

		await runVerb(pullVerb, env);
		expect(workspaceHasFile(env.workspace, "FB_Motor.st")).toBe(true);
		expect(workspaceHas(env.workspace, "POUs/Motors/FB_Motor.st")).toBe(false);
	});

	test("moving a folder-worth of items (rename a parent folder in IDE) → every item migrates", async () => {
		env = makeTestEnv({
			items: [
				{ name: "FB_A", kind: "function_block", folder: "POUs/Motors", language: "ST", sourceText: FB_SOURCE.replace("FB_Motor", "FB_A") },
				{ name: "FB_B", kind: "function_block", folder: "POUs/Motors", language: "ST", sourceText: FB_SOURCE.replace("FB_Motor", "FB_B") },
				{ name: "FB_C", kind: "function_block", folder: "POUs/Motors", language: "ST", sourceText: FB_SOURCE.replace("FB_Motor", "FB_C") },
			],
		});
		await runVerb(pullVerb, env);
		expect(workspaceHasFile(env.workspace, "POUs/Motors/FB_A.st")).toBe(true);
		expect(workspaceHasFile(env.workspace, "POUs/Motors/FB_B.st")).toBe(true);
		expect(workspaceHasFile(env.workspace, "POUs/Motors/FB_C.st")).toBe(true);

		// Engineer renames the parent folder POUs/Motors → POUs/Drives.
		// IDE-level this is one operation; the bridge re-emits all
		// three items with the new folder. Each item's version bumps
		// (folder is in the hash) and all three refetch in one batch.
		for (const name of ["FB_A", "FB_B", "FB_C"]) {
			env.bridge.items.get(name)!.folder = "POUs/Drives";
		}

		const second = await runVerb(pullVerb, env);
		expect(second.exitCode).toBe(0);
		expect(workspaceHasFile(env.workspace, "POUs/Drives/FB_A.st")).toBe(true);
		expect(workspaceHasFile(env.workspace, "POUs/Drives/FB_B.st")).toBe(true);
		expect(workspaceHasFile(env.workspace, "POUs/Drives/FB_C.st")).toBe(true);
		expect(workspaceHas(env.workspace, "POUs/Motors/FB_A.st")).toBe(false);
		expect(workspaceHas(env.workspace, "POUs/Motors/FB_B.st")).toBe(false);
		expect(workspaceHas(env.workspace, "POUs/Motors/FB_C.st")).toBe(false);
	});

	test("no-op pull after a move: workspace stays byte-stable", async () => {
		env = makeTestEnv({
			items: [
				{ name: "FB_Motor", kind: "function_block", folder: "POUs/Motors", language: "ST", sourceText: FB_SOURCE },
			],
		});
		await runVerb(pullVerb, env);

		env.bridge.items.get("FB_Motor")!.folder = "POUs/Archived";
		await runVerb(pullVerb, env);
		const afterMove = readWorkspace(env.workspace, "POUs/Archived/FB_Motor.st");

		// Second back-to-back pull with no further changes — workspace
		// must NOT churn. The new version is already in state.items.
		const noop = await runVerb(pullVerb, env);
		expect(noop.exitCode).toBe(0);
		expect(readWorkspace(env.workspace, "POUs/Archived/FB_Motor.st")).toBe(afterMove);
	});
});

describe("scenario: workspace move → push relocates the IDE item", () => {
	test("engineer drags FB.st to a new folder → push emits moveItem op", async () => {
		env = makeTestEnv({
			items: [
				{ name: "FB_Motor", kind: "function_block", folder: "POUs/Motors", language: "ST", sourceText: FB_SOURCE },
			],
		});
		await runVerb(pullVerb, env);
		const oldPath = join(env.workspace, "POUs", "Motors", "FB_Motor.st");
		const newPath = join(env.workspace, "POUs", "Archived", "FB_Motor.st");

		// Engineer drags the file in their editor. Same content, new
		// location. Push diff should classify this as folder-only
		// change → moveItem op (not pushItem) so the bridge avoids a
		// content rewrite.
		mkdirSync(dirname(newPath), { recursive: true });
		renameSync(oldPath, newPath);

		const result = await runVerb(pushVerb, env);
		expect(result.exitCode).toBe(0);
		expect(env.bridge.pushCalls.length).toBe(1);
		const ops = env.bridge.pushCalls[0]!.ops;
		// One moveItem op, nothing else (no pushItem, no delete, no
		// rename — those would mean the diff misclassified).
		expect(ops.length).toBe(1);
		expect(ops[0]!.op).toBe("moveItem");
		expect((ops[0]! as { name: string }).name).toBe("FB_Motor");
		expect((ops[0]! as { newFolder: string }).newFolder).toBe("POUs/Archived");

		// Bridge applied the move: the item now lives at the new folder.
		expect(env.bridge.items.get("FB_Motor")?.folder).toBe("POUs/Archived");
	});

	test("engineer moves AND edits content → push emits one pushItem carrying both", async () => {
		env = makeTestEnv({
			items: [
				{ name: "FB_Motor", kind: "function_block", folder: "POUs/Motors", language: "ST", sourceText: FB_SOURCE },
			],
		});
		await runVerb(pullVerb, env);
		const oldPath = join(env.workspace, "POUs", "Motors", "FB_Motor.st");
		const newPath = join(env.workspace, "POUs", "Archived", "FB_Motor.st");

		// Move + edit in one workspace session.
		mkdirSync(dirname(newPath), { recursive: true });
		renameSync(oldPath, newPath);
		writeFileSync(newPath, FB_SOURCE.replace("speed := 0;", "speed := 99;"));

		const result = await runVerb(pushVerb, env);
		expect(result.exitCode).toBe(0);
		const ops = env.bridge.pushCalls[0]!.ops;
		expect(ops.length).toBe(1);
		expect(ops[0]!.op).toBe("pushItem"); // carries both folder + new sourceText
		const pushOp = ops[0]! as { name: string; folder?: string; sourceText: string };
		expect(pushOp.name).toBe("FB_Motor");
		expect(pushOp.folder).toBe("POUs/Archived");
		expect(pushOp.sourceText).toContain("speed := 99;");

		// Bridge applied both: new folder + new content.
		const stored = env.bridge.items.get("FB_Motor")!;
		expect(stored.folder).toBe("POUs/Archived");
		expect(stored.sourceText).toContain("speed := 99;");
	});
});

describe("scenario: round-trip — IDE-move → pull → push is idempotent", () => {
	test("after IDE-move and pull, an empty push produces no ops", async () => {
		env = makeTestEnv({
			items: [
				{ name: "FB_Motor", kind: "function_block", folder: "POUs/Motors", language: "ST", sourceText: FB_SOURCE },
			],
		});
		await runVerb(pullVerb, env);

		env.bridge.items.get("FB_Motor")!.folder = "POUs/Archived";
		await runVerb(pullVerb, env);

		// State synced. No workspace edits. Push should be a no-op —
		// not a phantom moveItem back to the old folder.
		const pushCallsBefore = env.bridge.pushCalls.length;
		const result = await runVerb(pushVerb, env);
		expect(result.exitCode).toBe(0);
		// Either zero new push calls (clean status → no batch sent)
		// or one empty batch — both are no-ops on the bridge.
		const newCalls = env.bridge.pushCalls.slice(pushCallsBefore);
		for (const call of newCalls) {
			expect(call.ops.length).toBe(0);
		}
	});
});
