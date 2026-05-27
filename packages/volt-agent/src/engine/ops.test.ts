/**
 * Workspace-ops tests. Drive the bridge↔snapshot translation against
 * an in-process TestBridge. Covers:
 *   - Materialization: bridge items → one assembled file per POU
 *   - Determinism: same bridge state → same commit SHA on re-sync
 *   - Removal: items deleted on the bridge disappear from the tree
 *   - Push translation: tree diff → bridge.pushBatch ops
 *   - Drift rejection: stale state vs. bridge → applyPushToBridge fails
 *
 * Workspace layout assertion: ONE FILE PER POU. Children (methods /
 * actions / properties) live in the SAME .st file as the parent POU,
 * as TOP-LEVEL SIBLING declarations after END_FUNCTION_BLOCK — the
 * format the @opencode-ai/volt-lsp-st parser already speaks. The bridge
 * wire shape is unchanged (still per-child ops).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestBridge } from "../bridge/test-bridge.js";
import {
	createDeterministicCommit,
	initBareRepo,
	listTree,
	readBlob,
	resolveRef,
	buildTree,
	writeBlob,
} from "./git-cmds.js";
import { applyPushToBridge, syncFromBridge } from "./ops.js";
import { loadState } from "./snapshot.js";

/**
 * Wrap a bare declaration into a full, parseable workspace file.
 *
 * The LSP parser expects top-level declarations: outer POU first
 * (FUNCTION_BLOCK … END_FUNCTION_BLOCK), then children (METHOD,
 * ACTION, PROPERTY) as siblings, NOT nested inside the FB body.
 */
function wrapFb(name: string, body: string = "", children: string = ""): string {
	const decl = `FUNCTION_BLOCK ${name}\nVAR END_VAR`;
	const parts = [decl];
	if (body.length > 0) parts.push("", body);
	parts.push("", "END_FUNCTION_BLOCK");
	if (children.length > 0) parts.push("", children);
	parts.push("");
	return parts.join("\n");
}

describe("syncFromBridge", () => {
	let tmp: string;
	let repoPath: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "volt-sync-"));
		repoPath = join(tmp, "test.git");
		initBareRepo(repoPath);
	});
	afterEach(() => {
		try {
			rmSync(tmp, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it("materializes a single top-level POU as one wrapped file", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", declaration: "FUNCTION_BLOCK FB_A\nVAR END_VAR" },
			],
		});

		const commitSha = await syncFromBridge(repoPath, bridge);

		expect(resolveRef(repoPath, "refs/heads/main")).toBe(commitSha);
		const tree = listTree(repoPath, commitSha);
		const paths = tree.map((e) => e.path).sort();
		expect(paths).toContain("POUs/FB_A.st");
		expect(paths).toContain(".gitattributes");

		const blob = tree.find((e) => e.path === "POUs/FB_A.st");
		expect(blob).toBeDefined();
		const content = readBlob(repoPath, blob!.sha);
		expect(content).toContain("FUNCTION_BLOCK FB_A");
		// The wrapper is added by the materializer.
		expect(content).toContain("END_FUNCTION_BLOCK");
	});

	it("inlines children + property accessors into ONE file per FB", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{
					name: "FB_X",
					folder: "POUs",
					declaration: "FUNCTION_BLOCK FB_X\nVAR END_VAR",
					children: [
						{ name: "Execute", declaration: "METHOD Execute : BOOL\nVAR END_VAR", implementation: "Execute := TRUE;" },
						{ name: "Speed", declaration: "PROPERTY Speed : REAL", getterCode: "Speed := 1.0;" },
					],
				},
			],
		});

		const commitSha = await syncFromBridge(repoPath, bridge);
		const tree = listTree(repoPath, commitSha);
		const paths = tree.map((e) => e.path).sort();

		// Only ONE file for the FB — no separate child files.
		expect(paths).toContain("POUs/FB_X.st");
		expect(paths.filter((p) => p.startsWith("POUs/FB_X"))).toEqual(["POUs/FB_X.st"]);

		// The file contains the wrapper, the method, and the property accessor.
		const blob = tree.find((e) => e.path === "POUs/FB_X.st");
		const content = readBlob(repoPath, blob!.sha);
		expect(content).toContain("FUNCTION_BLOCK FB_X");
		expect(content).toContain("METHOD Execute : BOOL");
		expect(content).toContain("Execute := TRUE;");
		expect(content).toContain("END_METHOD");
		expect(content).toContain("PROPERTY Speed : REAL");
		expect(content).toContain("GET");
		expect(content).toContain("Speed := 1.0;");
		expect(content).toContain("END_GET");
		expect(content).toContain("END_PROPERTY");
		expect(content).toContain("END_FUNCTION_BLOCK");
	});

	it("is deterministic: same bridge state → same commit SHA across separate sync calls", async () => {
		const makeBridge = () =>
			new TestBridge({
				initialItems: [{ name: "FB_X", folder: "POUs", declaration: "FUNCTION_BLOCK FB_X\nVAR END_VAR" }],
			});

		const repoA = join(tmp, "a.git");
		const repoB = join(tmp, "b.git");
		initBareRepo(repoA);
		initBareRepo(repoB);

		const shaA = await syncFromBridge(repoA, makeBridge());
		const shaB = await syncFromBridge(repoB, makeBridge());

		expect(shaA).toBe(shaB);
	});

	it("is idempotent: re-syncing unchanged bridge returns the same commit", async () => {
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_X", folder: "POUs", declaration: "FUNCTION_BLOCK FB_X\nVAR END_VAR" }],
		});

		const first = await syncFromBridge(repoPath, bridge);
		const second = await syncFromBridge(repoPath, bridge);
		expect(second).toBe(first);
	});

	it("advances HEAD to a new commit when bridge state changes", async () => {
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_X", folder: "POUs", declaration: "FUNCTION_BLOCK FB_X\nVAR END_VAR" }],
		});
		const firstSha = await syncFromBridge(repoPath, bridge);

		bridge.mutate("FB_X", {
			name: "FB_X",
			folder: "POUs",
			declaration: "FUNCTION_BLOCK FB_X\n// edited\nVAR END_VAR",
		});
		const secondSha = await syncFromBridge(repoPath, bridge);

		expect(secondSha).not.toBe(firstSha);
		const state = loadState(repoPath);
		expect(state?.commitSha).toBe(secondSha);
	});

	it("removes items deleted on the bridge from the tree", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", declaration: "FUNCTION_BLOCK FB_A\nVAR END_VAR" },
				{ name: "FB_B", folder: "POUs", declaration: "FUNCTION_BLOCK FB_B\nVAR END_VAR" },
			],
		});
		const firstSha = await syncFromBridge(repoPath, bridge);
		expect(listTree(repoPath, firstSha).some((e) => e.path === "POUs/FB_B.st")).toBe(true);

		bridge.mutate("FB_B", undefined);
		const secondSha = await syncFromBridge(repoPath, bridge);
		expect(listTree(repoPath, secondSha).some((e) => e.path === "POUs/FB_B.st")).toBe(false);
		expect(listTree(repoPath, secondSha).some((e) => e.path === "POUs/FB_A.st")).toBe(true);
	});
});

describe("applyPushToBridge", () => {
	let tmp: string;
	let repoPath: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "volt-push-"));
		repoPath = join(tmp, "test.git");
		initBareRepo(repoPath);
	});
	afterEach(() => {
		try {
			rmSync(tmp, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it("emits updatePou when only the FB's body changed", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", declaration: "FUNCTION_BLOCK FB_A\nVAR END_VAR" },
			],
		});
		const baseSha = await syncFromBridge(repoPath, bridge);

		// Client commit with an edited body.
		const baseTree = listTree(repoPath, baseSha);
		const editedContent = wrapFb("FB_A", "x := 1;  // AI edited");
		const editedBlob = writeBlob(repoPath, editedContent);
		const newEntries = baseTree.map((e) =>
			e.path === "POUs/FB_A.st" ? { path: e.path, sha: editedBlob, mode: e.mode } : { path: e.path, sha: e.sha, mode: e.mode },
		);
		const newTreeSha = buildTree(repoPath, newEntries);
		const newCommitSha = createDeterministicCommit(repoPath, newTreeSha, baseSha, "AI body edit");

		const result = await applyPushToBridge(repoPath, bridge, newCommitSha);
		expect(result.accepted).toBe(true);
		const ops = bridge.pushCalls[0]?.ops ?? [];
		expect(ops).toHaveLength(1);
		expect(ops[0]?.op).toBe("updatePou");
		if (ops[0]?.op === "updatePou") {
			expect(ops[0].name).toBe("FB_A");
			expect(ops[0].implementation).toContain("AI edited");
		}
	});

	it("emits createChild when a method is added to an existing FB", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", declaration: "FUNCTION_BLOCK FB_A\nVAR END_VAR" },
			],
		});
		const baseSha = await syncFromBridge(repoPath, bridge);

		const baseTree = listTree(repoPath, baseSha);
		const withMethod = wrapFb(
			"FB_A",
			"",
			["METHOD Reset : BOOL", "VAR END_VAR", "Reset := TRUE;", "END_METHOD"].join("\n"),
		);
		const editedBlob = writeBlob(repoPath, withMethod);
		const newEntries = baseTree.map((e) =>
			e.path === "POUs/FB_A.st" ? { path: e.path, sha: editedBlob, mode: e.mode } : { path: e.path, sha: e.sha, mode: e.mode },
		);
		const newTreeSha = buildTree(repoPath, newEntries);
		const newCommitSha = createDeterministicCommit(repoPath, newTreeSha, baseSha, "AI add method");

		const result = await applyPushToBridge(repoPath, bridge, newCommitSha);
		expect(result.accepted).toBe(true);
		const ops = bridge.pushCalls[0]?.ops ?? [];
		expect(ops.some((o) => o.op === "createChild" && o.parent === "FB_A" && o.name === "Reset")).toBe(true);
	});

	it("emits deletePou for FBs removed from the tree", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", declaration: "FUNCTION_BLOCK FB_A\nVAR END_VAR" },
				{ name: "FB_B", folder: "POUs", declaration: "FUNCTION_BLOCK FB_B\nVAR END_VAR" },
			],
		});
		const baseSha = await syncFromBridge(repoPath, bridge);

		const baseTree = listTree(repoPath, baseSha);
		const newEntries = baseTree
			.filter((e) => e.path !== "POUs/FB_B.st")
			.map((e) => ({ path: e.path, sha: e.sha, mode: e.mode }));
		const newTreeSha = buildTree(repoPath, newEntries);
		const newCommitSha = createDeterministicCommit(repoPath, newTreeSha, baseSha, "delete FB_B");

		const result = await applyPushToBridge(repoPath, bridge, newCommitSha);
		expect(result.accepted).toBe(true);
		const ops = bridge.pushCalls[0]?.ops ?? [];
		expect(ops.some((o) => o.op === "deletePou" && o.name === "FB_B")).toBe(true);
	});

	it("rejects when the bridge has drifted since our cached state", async () => {
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_A", folder: "POUs", declaration: "FUNCTION_BLOCK FB_A\nVAR END_VAR" }],
		});
		const baseSha = await syncFromBridge(repoPath, bridge);

		// Engineer drifts the bridge without us syncing.
		bridge.mutate("FB_A", {
			name: "FB_A",
			folder: "POUs",
			declaration: "FUNCTION_BLOCK FB_A\n// engineer\nVAR END_VAR",
		});

		// Client push against the stale baseSha — different body.
		const baseTree = listTree(repoPath, baseSha);
		const editedContent = wrapFb("FB_A", "// AI body");
		const editedBlob = writeBlob(repoPath, editedContent);
		const newEntries = baseTree.map((e) =>
			e.path === "POUs/FB_A.st" ? { path: e.path, sha: editedBlob, mode: e.mode } : { path: e.path, sha: e.sha, mode: e.mode },
		);
		const newTreeSha = buildTree(repoPath, newEntries);
		const newCommitSha = createDeterministicCommit(repoPath, newTreeSha, baseSha, "client edit while drifted");

		const result = await applyPushToBridge(repoPath, bridge, newCommitSha);
		expect(result.accepted).toBe(false);
		if (!result.accepted) {
			expect(result.reason).toMatch(/project-level drift|version mismatch|item changed/i);
		}
	});
});
