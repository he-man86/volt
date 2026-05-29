/**
 * Workspace-ops tests. Drive the bridge↔snapshot translation against
 * an in-process TestBridge. Covers:
 *   - Materialization: bridge sourceText → one workspace file per POU
 *   - Determinism: same bridge state → same commit SHA on re-sync
 *   - Removal: items deleted on the bridge disappear from the tree
 *   - Push translation: tree diff → bridge.pushBatch ops (pushItem /
 *     deleteItem / moveItem)
 *   - Drift rejection: stale state vs. bridge → applyPushToBridge fails
 *
 * Wire-shape v2: one workspace file = one item on the wire. The agent
 * sends the file's raw `sourceText`; the bridge splits + diffs
 * internally. Tests assert on the item-level op surface (pushItem,
 * deleteItem, moveItem).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { applyPushToBridge, syncFromBridge, workspaceMatchesBridge } from "./ops.js";
import { loadState, saveState } from "./snapshot.js";

/** Wrap a minimal FB sourceText that the splitter can parse. */
function fbSource(name: string, body: string = "", children: string = ""): string {
	const parts = [`FUNCTION_BLOCK ${name}`, "VAR", "END_VAR"];
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

	it("materializes a single top-level POU as one file", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", sourceText: fbSource("FB_A") },
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
		expect(content).toContain("END_FUNCTION_BLOCK");
	});

	it("preserves children embedded in the bridge's sourceText", async () => {
		const fullSrc = fbSource(
			"FB_X",
			"",
			"METHOD Execute : BOOL\nVAR\nEND_VAR\nExecute := TRUE;\nEND_METHOD\n\nPROPERTY Speed : REAL\nGET\nSpeed := 1.0;\nEND_GET\nEND_PROPERTY",
		);
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_X", folder: "POUs", sourceText: fullSrc },
			],
		});

		const commitSha = await syncFromBridge(repoPath, bridge);
		const tree = listTree(repoPath, commitSha);
		const paths = tree.map((e) => e.path).sort();

		// Only ONE file for the FB — no per-child files.
		expect(paths).toContain("POUs/FB_X.st");
		expect(paths.filter((p) => p.startsWith("POUs/FB_X"))).toEqual(["POUs/FB_X.st"]);

		const blob = tree.find((e) => e.path === "POUs/FB_X.st");
		const content = readBlob(repoPath, blob!.sha);
		expect(content).toContain("FUNCTION_BLOCK FB_X");
		expect(content).toContain("METHOD Execute : BOOL");
		expect(content).toContain("Execute := TRUE;");
		expect(content).toContain("PROPERTY Speed : REAL");
		expect(content).toContain("GET");
		expect(content).toContain("Speed := 1.0;");
	});

	it("routes by kind: GVL → .gvl, DUT → .dut, interface → .itf", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{
					name: "GVL_Globals",
					folder: "GVLs",
					sourceText: "{attribute 'qualified_only'}\nVAR_GLOBAL\n  gFoo : INT;\nEND_VAR\n",
				},
				{
					name: "DUT_State",
					folder: "DUTs",
					sourceText: "TYPE DUT_State :\nSTRUCT\n  x : INT;\nEND_STRUCT\nEND_TYPE\n",
				},
				{
					name: "I_Mover",
					folder: "Interfaces",
					sourceText: "INTERFACE I_Mover\nEND_INTERFACE\n",
				},
			],
		});

		const commitSha = await syncFromBridge(repoPath, bridge);
		const paths = listTree(repoPath, commitSha).map((e) => e.path);

		expect(paths).toContain("GVLs/GVL_Globals.gvl");
		expect(paths).toContain("DUTs/DUT_State.dut");
		expect(paths).toContain("Interfaces/I_Mover.itf");
		// GVL should be its own kind, not wrapped as a function block.
		const gvlBlob = listTree(repoPath, commitSha).find((e) => e.path === "GVLs/GVL_Globals.gvl")!;
		const gvlContent = readBlob(repoPath, gvlBlob.sha);
		expect(gvlContent).toContain("VAR_GLOBAL");
		expect(gvlContent).not.toContain("END_FUNCTION_BLOCK");
	});

	it("routes graphical POU bodies (FBD/LD/SFC/CFC) to their own extensions", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{
					name: "FB_Graph",
					kind: "function_block",
					folder: "POUs",
					sourceText: "FUNCTION_BLOCK FB_Graph\nVAR\nEND_VAR\n<graphical-body-placeholder>\nEND_FUNCTION_BLOCK\n",
					language: "FBD",
				},
			],
		});

		const commitSha = await syncFromBridge(repoPath, bridge);
		const paths = listTree(repoPath, commitSha).map((e) => e.path);

		expect(paths).toContain("POUs/FB_Graph.fbd");
		expect(paths).not.toContain("POUs/FB_Graph.st");
	});

	it("throws loudly when bridge returns a kind the materializer doesn't recognize", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{
					name: "MysteryItem",
					kind: "wormhole_block",
					folder: "POUs",
					sourceText: "FUNCTION_BLOCK MysteryItem\nEND_FUNCTION_BLOCK\n",
				},
			],
		});

		await expect(syncFromBridge(repoPath, bridge)).rejects.toThrow(/unknown kind "wormhole_block"/);
	});

	it("is deterministic: same bridge state → same commit SHA across separate sync calls", async () => {
		const makeBridge = () =>
			new TestBridge({
				initialItems: [{ name: "FB_X", folder: "POUs", sourceText: fbSource("FB_X") }],
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
			initialItems: [{ name: "FB_X", folder: "POUs", sourceText: fbSource("FB_X") }],
		});

		const first = await syncFromBridge(repoPath, bridge);
		const second = await syncFromBridge(repoPath, bridge);
		expect(second).toBe(first);
	});

	it("advances HEAD to a new commit when bridge state changes", async () => {
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_X", folder: "POUs", sourceText: fbSource("FB_X") }],
		});
		const firstSha = await syncFromBridge(repoPath, bridge);

		bridge.mutate("FB_X", {
			name: "FB_X",
			folder: "POUs",
			sourceText: fbSource("FB_X", "// edited"),
		});
		const secondSha = await syncFromBridge(repoPath, bridge);

		expect(secondSha).not.toBe(firstSha);
		const state = loadState(repoPath);
		expect(state?.commitSha).toBe(secondSha);
	});

	it("fullRebuild=true re-fetches every item even when projectVersion is unchanged", async () => {
		// Scenario: a previous --force push adopted bridge state into
		// state.items but the process died before re-materializing the
		// tree. state.projectVersion matches bridge.projectVersion, so the
		// default sync would short-circuit and leave the snapshot stale.
		// fullRebuild skips the short-circuit AND sends knownItems={} so
		// the bridge replays everything.
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", sourceText: fbSource("FB_A") },
				{ name: "FB_B", folder: "POUs", sourceText: fbSource("FB_B") },
			],
		});

		await syncFromBridge(repoPath, bridge);
		const baseline = loadState(repoPath)!;
		expect(baseline.items["FB_A"]).toBeDefined();
		expect(baseline.items["FB_B"]).toBeDefined();

		// Simulate the corruption: drop FB_B from state.items while
		// leaving projectVersion alone — the kind of half-written state
		// a crashed force-push reconcile would leave behind.
		const corrupted = { ...baseline.items };
		delete corrupted["FB_B"];
		saveState(repoPath, { ...baseline, items: corrupted });

		// Default sync sees matching projectVersion → no-op.
		await syncFromBridge(repoPath, bridge);
		expect(loadState(repoPath)!.items["FB_B"]).toBeUndefined();

		// fullRebuild forces the re-fetch.
		await syncFromBridge(repoPath, bridge, { fullRebuild: true });
		const restored = loadState(repoPath)!;
		expect(restored.items["FB_A"]).toBeDefined();
		expect(restored.items["FB_B"]).toBeDefined();
	});

	it("removes items deleted on the bridge from the tree", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", sourceText: fbSource("FB_A") },
				{ name: "FB_B", folder: "POUs", sourceText: fbSource("FB_B") },
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

	it("emits pushItem when an FB's body changes", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", sourceText: fbSource("FB_A") },
			],
		});
		const baseSha = await syncFromBridge(repoPath, bridge);

		const baseTree = listTree(repoPath, baseSha);
		const editedContent = fbSource("FB_A", "x := 1;  // AI edited");
		const editedBlob = writeBlob(repoPath, editedContent);
		const newEntries = baseTree.map((e) =>
			e.path === "POUs/FB_A.st"
				? { path: e.path, sha: editedBlob, mode: e.mode }
				: { path: e.path, sha: e.sha, mode: e.mode },
		);
		const newTreeSha = buildTree(repoPath, newEntries);
		const newCommitSha = createDeterministicCommit(repoPath, newTreeSha, baseSha, "AI body edit");

		const result = await applyPushToBridge(repoPath, bridge, newCommitSha);
		expect(result.accepted).toBe(true);
		const ops = bridge.pushCalls[0]?.ops ?? [];
		expect(ops).toHaveLength(1);
		expect(ops[0]?.op).toBe("pushItem");
		if (ops[0]?.op === "pushItem") {
			expect(ops[0].name).toBe("FB_A");
			expect(ops[0].sourceText).toContain("AI edited");
			expect(ops[0].ifVersion).not.toBeNull(); // existing item → update
		}
	});

	it("emits pushItem when a method is added to an existing FB", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", sourceText: fbSource("FB_A") },
			],
		});
		const baseSha = await syncFromBridge(repoPath, bridge);

		const baseTree = listTree(repoPath, baseSha);
		const withMethod = fbSource(
			"FB_A",
			"",
			"METHOD Reset : BOOL\nVAR\nEND_VAR\nReset := TRUE;\nEND_METHOD",
		);
		const editedBlob = writeBlob(repoPath, withMethod);
		const newEntries = baseTree.map((e) =>
			e.path === "POUs/FB_A.st"
				? { path: e.path, sha: editedBlob, mode: e.mode }
				: { path: e.path, sha: e.sha, mode: e.mode },
		);
		const newTreeSha = buildTree(repoPath, newEntries);
		const newCommitSha = createDeterministicCommit(repoPath, newTreeSha, baseSha, "AI add method");

		const result = await applyPushToBridge(repoPath, bridge, newCommitSha);
		expect(result.accepted).toBe(true);
		const ops = bridge.pushCalls[0]?.ops ?? [];
		// Wire shape v2: adding a child IS a content change to the FB,
		// so a single pushItem carries the full new sourceText including
		// the new METHOD block. The bridge re-splits and creates the child.
		expect(ops).toHaveLength(1);
		expect(ops[0]?.op).toBe("pushItem");
		if (ops[0]?.op === "pushItem") {
			expect(ops[0].name).toBe("FB_A");
			expect(ops[0].sourceText).toContain("METHOD Reset");
		}
	});

	it("emits moveItem when an FB's folder changes but content is identical", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", sourceText: fbSource("FB_A") },
			],
		});
		const baseSha = await syncFromBridge(repoPath, bridge);

		// Same blob, different folder — exact same SHA reused.
		const baseTree = listTree(repoPath, baseSha);
		const oldEntry = baseTree.find((e) => e.path === "POUs/FB_A.st")!;
		const newEntries = baseTree
			.filter((e) => e.path !== "POUs/FB_A.st")
			.map((e) => ({ path: e.path, sha: e.sha, mode: e.mode }))
			.concat({ path: "Modules/FB_A.st", sha: oldEntry.sha, mode: oldEntry.mode });
		const newTreeSha = buildTree(repoPath, newEntries);
		const newCommitSha = createDeterministicCommit(repoPath, newTreeSha, baseSha, "move FB_A");

		const result = await applyPushToBridge(repoPath, bridge, newCommitSha);
		expect(result.accepted).toBe(true);
		const ops = bridge.pushCalls[0]?.ops ?? [];
		expect(ops).toHaveLength(1);
		expect(ops[0]?.op).toBe("moveItem");
		if (ops[0]?.op === "moveItem") {
			expect(ops[0].name).toBe("FB_A");
			expect(ops[0].newFolder).toBe("Modules");
		}
	});

	it("emits deleteItem for FBs removed from the tree", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", sourceText: fbSource("FB_A") },
				{ name: "FB_B", folder: "POUs", sourceText: fbSource("FB_B") },
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
		expect(ops.some((o) => o.op === "deleteItem" && o.name === "FB_B")).toBe(true);
	});

	it("routes GVL with leading attribute pragma as a gvl-kind item", async () => {
		const bridge = new TestBridge({ initialItems: [] });
		const baseSha = await syncFromBridge(repoPath, bridge);

		const gvlSrc = "{attribute 'qualified_only'}\nVAR_GLOBAL\n\tgFoo : INT;\nEND_VAR\n";
		const gvlBlob = writeBlob(repoPath, gvlSrc);
		const newEntries = [
			...listTree(repoPath, baseSha).map((e) => ({ path: e.path, sha: e.sha, mode: e.mode })),
			{ path: "GVLs/GVL_LANG_pragma.gvl", sha: gvlBlob, mode: "100644" as const },
		];
		const newTreeSha = buildTree(repoPath, newEntries);
		const newCommitSha = createDeterministicCommit(repoPath, newTreeSha, baseSha, "GVL with pragma");

		const result = await applyPushToBridge(repoPath, bridge, newCommitSha);
		expect(result.accepted).toBe(true);
		const ops = bridge.pushCalls[0]?.ops ?? [];
		expect(ops).toHaveLength(1);
		expect(ops[0]?.op).toBe("pushItem");
		if (ops[0]?.op === "pushItem") {
			expect(ops[0].name).toBe("GVL_LANG_pragma");
			expect(ops[0].ifVersion).toBeNull(); // new item → create
			expect(ops[0].sourceText).toContain("VAR_GLOBAL");
		}
	});

	it("pushes a DUT (STRUCT) as a structure-kind item", async () => {
		const bridge = new TestBridge({ initialItems: [] });
		const baseSha = await syncFromBridge(repoPath, bridge);

		const dutSrc = "TYPE DUT_LANG_test :\nSTRUCT\n\tx : INT;\n\ty : INT;\nEND_STRUCT\nEND_TYPE\n";
		const dutBlob = writeBlob(repoPath, dutSrc);
		const newEntries = [
			...listTree(repoPath, baseSha).map((e) => ({ path: e.path, sha: e.sha, mode: e.mode })),
			{ path: "DUTs/DUT_LANG_test.dut", sha: dutBlob, mode: "100644" as const },
		];
		const newTreeSha = buildTree(repoPath, newEntries);
		const newCommitSha = createDeterministicCommit(repoPath, newTreeSha, baseSha, "add DUT");

		const result = await applyPushToBridge(repoPath, bridge, newCommitSha);
		expect(result.accepted).toBe(true);
		const ops = bridge.pushCalls[0]?.ops ?? [];
		expect(ops[0]?.op).toBe("pushItem");
		if (ops[0]?.op === "pushItem") {
			expect(ops[0].name).toBe("DUT_LANG_test");
			expect(ops[0].sourceText).toContain("STRUCT");
		}
	});

	it("hard-fails when two workspace files resolve to the same POU name", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "PLC_PRG", folder: "POUs", sourceText: "PROGRAM PLC_PRG\nVAR\nEND_VAR\nEND_PROGRAM\n" },
			],
		});
		const baseSha = await syncFromBridge(repoPath, bridge);

		const baseTree = listTree(repoPath, baseSha);
		const rootContent = "PROGRAM PLC_PRG\nVAR\nEND_VAR\n// added at root\nEND_PROGRAM\n";
		const rootBlob = writeBlob(repoPath, rootContent);
		const newEntries = [
			...baseTree.map((e) => ({ path: e.path, sha: e.sha, mode: e.mode })),
			{ path: "PLC_PRG.st", sha: rootBlob, mode: "100644" as const },
		];
		const newTreeSha = buildTree(repoPath, newEntries);
		const newCommitSha = createDeterministicCommit(repoPath, newTreeSha, baseSha, "ghost POU at root");

		await expect(applyPushToBridge(repoPath, bridge, newCommitSha)).rejects.toThrow(
			/duplicate POU name 'PLC_PRG'/,
		);
	});

	it("rejects when the bridge has drifted since our cached state", async () => {
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_A", folder: "POUs", sourceText: fbSource("FB_A") }],
		});
		const baseSha = await syncFromBridge(repoPath, bridge);

		// Engineer drifts the bridge without us syncing.
		bridge.mutate("FB_A", {
			name: "FB_A",
			folder: "POUs",
			sourceText: fbSource("FB_A", "// engineer"),
		});

		// Client push against the stale baseSha — different body.
		const baseTree = listTree(repoPath, baseSha);
		const editedContent = fbSource("FB_A", "// AI body");
		const editedBlob = writeBlob(repoPath, editedContent);
		const newEntries = baseTree.map((e) =>
			e.path === "POUs/FB_A.st"
				? { path: e.path, sha: editedBlob, mode: e.mode }
				: { path: e.path, sha: e.sha, mode: e.mode },
		);
		const newTreeSha = buildTree(repoPath, newEntries);
		const newCommitSha = createDeterministicCommit(repoPath, newTreeSha, baseSha, "client edit while drifted");

		const result = await applyPushToBridge(repoPath, bridge, newCommitSha);
		expect(result.accepted).toBe(false);
		if (!result.accepted) {
			// applyPushToBridge always sends expectedProjectVersion, so the
			// batch-level guard fires FIRST when the bridge has drifted —
			// the per-item ifVersion check never runs. Match that specific
			// path so a regression that swaps the rejection layer is loud.
			expect(result.reason).toMatch(/<project>.*project version mismatch/);
		}
	});

	it("persists new commitSha + items map after a successful push", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", sourceText: fbSource("FB_A") },
			],
		});
		const baseSha = await syncFromBridge(repoPath, bridge);

		const baseTree = listTree(repoPath, baseSha);
		const editedBlob = writeBlob(repoPath, fbSource("FB_A", "// persistence"));
		const newEntries = baseTree.map((e) =>
			e.path === "POUs/FB_A.st"
				? { path: e.path, sha: editedBlob, mode: e.mode }
				: { path: e.path, sha: e.sha, mode: e.mode },
		);
		const newTreeSha = buildTree(repoPath, newEntries);
		const newCommitSha = createDeterministicCommit(repoPath, newTreeSha, baseSha, "persistence test");

		const result = await applyPushToBridge(repoPath, bridge, newCommitSha);
		expect(result.accepted).toBe(true);

		// After accept, state.json should track:
		//   - the new commit SHA (so the next push diffs against this base)
		//   - the bridge's post-push projectVersion + items map
		const state = loadState(repoPath)!;
		const refs = await bridge.getRefs();
		expect(state.commitSha).toBe(newCommitSha);
		expect(state.projectVersion).toBe(refs.projectVersion);
		expect(state.items).toEqual(refs.items);
	});
});

describe("workspaceMatchesBridge", () => {
	let tmp: string;
	let workspaceRoot: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "volt-wsmatch-"));
		workspaceRoot = join(tmp, "ws");
		mkdirSync(workspaceRoot, { recursive: true });
	});
	afterEach(() => {
		try {
			rmSync(tmp, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it("returns true when every bridge item materializes to the workspace verbatim", async () => {
		const src = fbSource("FB_A");
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_A", folder: "POUs", sourceText: src }],
		});
		mkdirSync(join(workspaceRoot, "POUs"), { recursive: true });
		writeFileSync(join(workspaceRoot, "POUs", "FB_A.st"), src);

		expect(await workspaceMatchesBridge(workspaceRoot, bridge)).toBe(true);
	});

	it("returns false when workspace has a tracked item with different content", async () => {
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_A", folder: "POUs", sourceText: fbSource("FB_A") }],
		});
		mkdirSync(join(workspaceRoot, "POUs"), { recursive: true });
		writeFileSync(join(workspaceRoot, "POUs", "FB_A.st"), fbSource("FB_A", "// drifted"));

		expect(await workspaceMatchesBridge(workspaceRoot, bridge)).toBe(false);
	});

	it("returns false when workspace is missing an item the bridge has", async () => {
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_A", folder: "POUs", sourceText: fbSource("FB_A") }],
		});
		// workspace empty
		expect(await workspaceMatchesBridge(workspaceRoot, bridge)).toBe(false);
	});

	it("returns false when workspace has an extra POU the bridge doesn't", async () => {
		const bridge = new TestBridge({ initialItems: [] });
		mkdirSync(join(workspaceRoot, "POUs"), { recursive: true });
		writeFileSync(join(workspaceRoot, "POUs", "FB_Extra.st"), fbSource("FB_Extra"));

		expect(await workspaceMatchesBridge(workspaceRoot, bridge)).toBe(false);
	});

	it("treats line-ending differences as a match (\\r\\n ⇄ \\n)", async () => {
		// The agent writes workspace files with whatever EOL the editor
		// chose (often CRLF on Windows). materializeItem normalizes to LF
		// for snapshot blobs; workspaceMatchesBridge should compare on the
		// normalized form so a CRLF workspace file is still considered
		// a match.
		const src = fbSource("FB_A");
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_A", folder: "POUs", sourceText: src }],
		});
		mkdirSync(join(workspaceRoot, "POUs"), { recursive: true });
		writeFileSync(join(workspaceRoot, "POUs", "FB_A.st"), src.replace(/\n/g, "\r\n"));

		expect(await workspaceMatchesBridge(workspaceRoot, bridge)).toBe(true);
	});
});
