/**
 * Push verb's drift-detection decision logic. Driven against the
 * in-memory `TestBridge` simulator so we can deterministically
 * reproduce edge cases that depend on bridge state.
 *
 * Anchor case (the bug this whole test file exists for): the bridge
 * bumps its `projectVersion` for a NON-content reason (TC's dirty-bit
 * flips after a save, structural changes that don't touch any item).
 * Per "trust authoritative data", the items map is the truth — a bare
 * projectVersion bump with no item changes must NOT refuse the push.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestBridge } from "../bridge/test-bridge.js";
import { initBareRepo } from "../engine/git-cmds.js";
import { syncFromBridge } from "../engine/ops.js";
import { listTree, readBlob } from "../engine/git-cmds.js";
import {
	ensureSnapshotRepo,
	writeTreeToWorkspace,
} from "../engine/snapshot.js";
import { saveConfig } from "../engine/config.js";
import { type VerbContext } from "./_shared.js";
import { pushVerb } from "./push.js";

function fbSource(name: string, body: string = "(* body *)"): string {
	return [
		`FUNCTION_BLOCK ${name}`,
		"VAR",
		"END_VAR",
		"",
		body,
		"",
		"END_FUNCTION_BLOCK",
		"",
	].join("\n");
}

/** Set up a tmp workspace with .volt/ snapshot + config bound to a TestBridge. */
async function setupWorkspace(bridge: TestBridge): Promise<{ workspace: string; cleanup: () => void }> {
	const root = mkdtempSync(join(tmpdir(), "volt-push-drift-"));
	const snapshotPath = join(root, ".volt", "snapshot");
	ensureSnapshotRepo(snapshotPath);
	saveConfig(root, { schemaVersion: 1, bridge: { port: 0 }, project: { platform: "beckhoff", projectName: "test", plcProjectName: "test" } });
	// Pull bridge state into workspace.
	const commit = await syncFromBridge(snapshotPath, bridge);
	const entries = listTree(snapshotPath, commit);
	writeTreeToWorkspace(
		root,
		entries.map((e) => ({ path: e.path, content: readBlob(snapshotPath, e.sha) })),
	);
	return {
		workspace: root,
		cleanup: () => {
			try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
		},
	};
}

function ctx(workspace: string, bridge: TestBridge, flags: Record<string, string | boolean> = {}): VerbContext {
	return { workspace, port: 0, bridge: bridge as unknown as VerbContext["bridge"], flags };
}

describe("push verb — drift decision", () => {
	let bridge: TestBridge;
	let workspace: string;
	let cleanup: () => void;

	beforeEach(async () => {
		bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", sourceText: fbSource("FB_A") },
				{ name: "FB_B", folder: "POUs", sourceText: fbSource("FB_B") },
			],
		});
		({ workspace, cleanup } = await setupWorkspace(bridge));
	});

	afterEach(() => {
		cleanup();
	});

	it("accepts push when bridge.projectVersion bumped but items unchanged (the anchor bug)", async () => {
		// Edit FB_A in the workspace.
		writeFileSync(join(workspace, "POUs/FB_A.st"), fbSource("FB_A", "(* edited *)"));

		// Simulate TC's "dirty-bit flip" / non-content save: the bridge
		// bumps projectVersion but no item versions change. This is the
		// scenario that used to trigger spurious "drift detected — run
		// volt pull" refusals.
		bridge.projectVersionOverride = "phantom-bump-no-items-changed";

		const exitCode = await pushVerb(ctx(workspace, bridge));
		expect(exitCode).toBe(0);
		// Push went through — assert FB_A reached the bridge.
		const updated = bridge.items.get("FB_A");
		expect(updated?.sourceText).toContain("edited");
	});

	it("still refuses push on REAL drift (item content changed on the bridge)", async () => {
		// Edit FB_A locally.
		writeFileSync(join(workspace, "POUs/FB_A.st"), fbSource("FB_A", "(* my edit *)"));

		// Bridge: simulate engineer touching FB_B via the IDE.
		const fbB = bridge.items.get("FB_B")!;
		fbB.sourceText = fbSource("FB_B", "(* engineer edit *)");
		// Don't set the override — let projectVersion follow items naturally.

		const exitCode = await pushVerb(ctx(workspace, bridge));
		// Real drift: bridge has actual item changes we don't know about.
		// Push must refuse so the user can pull + merge before pushing.
		expect(exitCode).toBe(2);
	});

	it("force-with-lease bypasses phantom-bump drift the same way as real drift", async () => {
		writeFileSync(join(workspace, "POUs/FB_A.st"), fbSource("FB_A", "(* edited *)"));
		bridge.projectVersionOverride = "phantom-bump-no-items-changed";

		// --force-with-lease against the phantom version: should succeed.
		const exitCode = await pushVerb(
			ctx(workspace, bridge, { "force-with-lease": "phantom-bump-no-items-changed" }),
		);
		expect(exitCode).toBe(0);
	});

	it("adopts the new projectVersion silently so next push expects it", async () => {
		writeFileSync(join(workspace, "POUs/FB_A.st"), fbSource("FB_A", "(* edited *)"));
		bridge.projectVersionOverride = "phantom-bump-no-items-changed";

		const firstExitCode = await pushVerb(ctx(workspace, bridge));
		expect(firstExitCode).toBe(0);

		// Clear the override so the next bridge read uses real
		// items-hash-derived projectVersion (TC's phantom-save settled).
		bridge.projectVersionOverride = null;

		// Edit FB_A again, push again. Should still succeed — no
		// stale-projectVersion refusal because push adopted the bridge's
		// version on the first call.
		writeFileSync(join(workspace, "POUs/FB_A.st"), fbSource("FB_A", "(* edited v2 *)"));
		const secondExitCode = await pushVerb(ctx(workspace, bridge));
		expect(secondExitCode).toBe(0);
	});
});
