/**
 * Merge engine tests against the in-memory TestBridge simulator.
 *
 * The simulator is good enough for everything that doesn't depend on
 * `Documents.SaveAll`-style IDE normalization — i.e. the engine's
 * classification logic, conflict-marker handling, MERGE_HEAD state
 * machine, and `--continue` / `--abort` resumption. The live-bridge
 * end-to-end variant lives in `cli/full-cycle.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestBridge } from "../bridge/test-bridge.js";
import { listTree, readBlob } from "./git-cmds.js";
import {
	abortMerge,
	applyMerge,
	continueMerge,
	isMergingNow,
	MergeUnresolvedError,
	NotConflictedError,
	planMerge,
	resolveConflict,
} from "./merge.js";
import { syncFromBridge } from "./ops.js";
import {
	ensureSnapshotRepo,
	listWorkspaceFiles,
	loadState,
	writeTreeToWorkspace,
} from "./snapshot.js";

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

/** Initial pull: bridge → snapshot → workspace. The "base" of the 3-way merge. */
async function setupBaseline(
	bridge: TestBridge,
	snapshotPath: string,
	workspaceRoot: string,
): Promise<void> {
	ensureSnapshotRepo(snapshotPath);
	const commit = await syncFromBridge(snapshotPath, bridge);
	const entries = listTree(snapshotPath, commit);
	writeTreeToWorkspace(
		workspaceRoot,
		entries.map((e) => ({ path: e.path, content: readBlob(snapshotPath, e.sha) })),
	);
}

describe("merge engine", () => {
	let tmp: string;
	let snapshotPath: string;
	let workspaceRoot: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "volt-merge-"));
		snapshotPath = join(tmp, "snapshot");
		workspaceRoot = join(tmp, "workspace");
	});
	afterEach(() => {
		try {
			rmSync(tmp, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	// ─── Auto-merge cases ────────────────────────────────────────────

	it("auto-merges when ours and theirs touch different POUs", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", sourceText: fbSource("FB_A") },
				{ name: "FB_B", folder: "POUs", sourceText: fbSource("FB_B") },
			],
		});
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		// Workspace edits FB_A.
		const fbAPath = join(workspaceRoot, "POUs/FB_A.st");
		writeFileSync(fbAPath, fbSource("FB_A", "(* ours edited A *)"));

		// Bridge edits FB_B (engineer-side).
		const stored = bridge.items.get("FB_B");
		stored!.sourceText = fbSource("FB_B", "(* theirs edited B *)");

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		expect(plan.conflicts).toEqual([]);
		const mergeState = applyMerge(snapshotPath, workspaceRoot, plan);
		expect(mergeState).toBeUndefined();

		// Both edits survived.
		expect(readFileSync(fbAPath, "utf-8")).toContain("ours edited A");
		expect(readFileSync(join(workspaceRoot, "POUs/FB_B.st"), "utf-8")).toContain(
			"theirs edited B",
		);
	});

	it("auto-merges when ours and theirs edit non-overlapping lines of the same POU", async () => {
		// Set up a multi-line FB so ours and theirs can edit different regions.
		const initial = [
			"FUNCTION_BLOCK FB_X",
			"VAR",
			"  a : INT;",
			"  b : INT;",
			"  c : INT;",
			"END_VAR",
			"",
			"a := 1;",
			"b := 2;",
			"c := 3;",
			"",
			"END_FUNCTION_BLOCK",
			"",
		].join("\n");
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_X", folder: "POUs", sourceText: initial }],
		});
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		// Ours edits the FIRST line of the body.
		const wsPath = join(workspaceRoot, "POUs/FB_X.st");
		writeFileSync(
			wsPath,
			initial.replace("a := 1;", "a := 100; // ours"),
		);

		// Theirs edits the LAST line of the body.
		const stored = bridge.items.get("FB_X");
		stored!.sourceText = initial.replace("c := 3;", "c := 300; // theirs");

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		expect(plan.conflicts).toEqual([]);
		applyMerge(snapshotPath, workspaceRoot, plan);
		const merged = readFileSync(wsPath, "utf-8");
		expect(merged).toContain("a := 100; // ours");
		expect(merged).toContain("c := 300; // theirs");
		expect(merged).not.toContain("<<<<<<<");
	});

	it("convergent: both sides identical edits → clean, no marker", async () => {
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_Y", folder: "POUs", sourceText: fbSource("FB_Y") }],
		});
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		const same = fbSource("FB_Y", "(* identical change on both sides *)");
		writeFileSync(join(workspaceRoot, "POUs/FB_Y.st"), same);
		bridge.items.get("FB_Y")!.sourceText = same;

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		expect(plan.conflicts).toEqual([]);
	});

	// ─── Text conflict cases ─────────────────────────────────────────

	it("writes conflict markers + MERGE_HEAD when both sides edit the same line", async () => {
		const initial = fbSource("FB_C", "(* base *)");
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_C", folder: "POUs", sourceText: initial }],
		});
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		const wsPath = join(workspaceRoot, "POUs/FB_C.st");
		writeFileSync(wsPath, fbSource("FB_C", "(* ours version *)"));
		bridge.items.get("FB_C")!.sourceText = fbSource("FB_C", "(* theirs version *)");

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		expect(plan.conflicts.length).toBe(1);
		expect(plan.conflicts[0]!.path).toBe("POUs/FB_C.st");
		expect(plan.conflicts[0]!.kind).toBe("text");
		expect(plan.conflicts[0]!.reason).toBe("both-modified");

		const mergeState = applyMerge(snapshotPath, workspaceRoot, plan);
		expect(mergeState).toBeDefined();

		const merged = readFileSync(wsPath, "utf-8");
		expect(merged).toContain("<<<<<<< WORKSPACE");
		expect(merged).toContain("=======");
		expect(merged).toMatch(/>>>>>>> IDE@/);
		expect(merged).toContain("ours version");
		expect(merged).toContain("theirs version");

		// MERGE_HEAD + friends written.
		expect(existsSync(join(snapshotPath, "MERGE_HEAD"))).toBe(true);
		expect(existsSync(join(snapshotPath, "ORIG_HEAD"))).toBe(true);
		expect(existsSync(join(snapshotPath, "MERGE_MSG"))).toBe(true);
		expect(existsSync(join(snapshotPath, "MERGE_CONFLICTS"))).toBe(true);

		const detected = isMergingNow(snapshotPath);
		expect(detected).toBeDefined();
		expect(detected!.conflicts).toHaveLength(1);
	});

	it("delete/modify: theirs deletes, ours modifies → conflict, ours content kept", async () => {
		const initial = fbSource("FB_DM", "(* base *)");
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_DM", folder: "POUs", sourceText: initial }],
		});
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		// Ours modifies.
		writeFileSync(join(workspaceRoot, "POUs/FB_DM.st"), fbSource("FB_DM", "(* ours touched *)"));
		// Theirs deletes.
		bridge.items.delete("FB_DM");

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		expect(plan.conflicts.length).toBe(1);
		expect(plan.conflicts[0]!.reason).toBe("modify-delete");
		applyMerge(snapshotPath, workspaceRoot, plan);

		// Workspace still has ours.
		expect(readFileSync(join(workspaceRoot, "POUs/FB_DM.st"), "utf-8")).toContain(
			"ours touched",
		);
	});

	it("modify/delete: ours deletes, theirs modifies → conflict, theirs content restored", async () => {
		const initial = fbSource("FB_MD", "(* base *)");
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_MD", folder: "POUs", sourceText: initial }],
		});
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		// Ours deletes.
		rmSync(join(workspaceRoot, "POUs/FB_MD.st"));
		// Theirs modifies.
		bridge.items.get("FB_MD")!.sourceText = fbSource("FB_MD", "(* theirs touched *)");

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		expect(plan.conflicts.length).toBe(1);
		expect(plan.conflicts[0]!.reason).toBe("delete-modify");
		applyMerge(snapshotPath, workspaceRoot, plan);

		// Workspace gets theirs's content back so the user can decide.
		expect(readFileSync(join(workspaceRoot, "POUs/FB_MD.st"), "utf-8")).toContain(
			"theirs touched",
		);
	});

	// ─── --continue ─────────────────────────────────────────────────

	it("continueMerge throws if markers remain", async () => {
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_R", folder: "POUs", sourceText: fbSource("FB_R") }],
		});
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		const wsPath = join(workspaceRoot, "POUs/FB_R.st");
		writeFileSync(wsPath, fbSource("FB_R", "(* ours *)"));
		bridge.items.get("FB_R")!.sourceText = fbSource("FB_R", "(* theirs *)");

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		applyMerge(snapshotPath, workspaceRoot, plan);

		expect(() => continueMerge(snapshotPath, workspaceRoot)).toThrow(MergeUnresolvedError);
	});

	it("continueMerge succeeds after markers are removed", async () => {
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_S", folder: "POUs", sourceText: fbSource("FB_S") }],
		});
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		const wsPath = join(workspaceRoot, "POUs/FB_S.st");
		writeFileSync(wsPath, fbSource("FB_S", "(* ours *)"));
		bridge.items.get("FB_S")!.sourceText = fbSource("FB_S", "(* theirs *)");

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		applyMerge(snapshotPath, workspaceRoot, plan);

		// User resolves: replaces markers with a chosen version.
		writeFileSync(wsPath, fbSource("FB_S", "(* RESOLVED — combined *)"));

		expect(() => continueMerge(snapshotPath, workspaceRoot)).not.toThrow();

		// MERGE_* files cleaned up.
		expect(existsSync(join(snapshotPath, "MERGE_HEAD"))).toBe(false);
		expect(existsSync(join(snapshotPath, "ORIG_HEAD"))).toBe(false);
		expect(existsSync(join(snapshotPath, "MERGE_MSG"))).toBe(false);
		expect(existsSync(join(snapshotPath, "MERGE_CONFLICTS"))).toBe(false);

		// State updated to the merge target projectVersion.
		const state = loadState(snapshotPath);
		expect(state).toBeDefined();
		const refs = await bridge.getRefs();
		expect(state!.projectVersion).toBe(refs.projectVersion);
	});

	// ─── resolveConflict (per-file pick-a-side) ─────────────────────

	it("resolveConflict --use-ours writes ORIG_HEAD content and clears the entry", async () => {
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_RO", folder: "POUs", sourceText: fbSource("FB_RO", "(* base *)") }],
		});
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		const wsPath = join(workspaceRoot, "POUs/FB_RO.st");
		const oursOriginal = fbSource("FB_RO", "(* ours pre-merge *)");
		writeFileSync(wsPath, oursOriginal);
		bridge.items.get("FB_RO")!.sourceText = fbSource("FB_RO", "(* theirs *)");

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		applyMerge(snapshotPath, workspaceRoot, plan);
		// Workspace currently has conflict markers, NOT ours bytes.
		expect(readFileSync(wsPath, "utf-8")).toContain("<<<<<<<");

		resolveConflict(snapshotPath, workspaceRoot, "POUs/FB_RO.st", "ours");

		// Workspace now matches what ours was BEFORE the merge started —
		// not the marker-laden content, not theirs.
		expect(readFileSync(wsPath, "utf-8")).toBe(oursOriginal);
		expect(isMergingNow(snapshotPath)!.conflicts).toHaveLength(0);
		// MERGE_HEAD/ORIG_HEAD still present — continue is a separate step.
		expect(existsSync(join(snapshotPath, "MERGE_HEAD"))).toBe(true);
	});

	it("resolveConflict --use-theirs writes MERGE_HEAD content and clears the entry", async () => {
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_RT", folder: "POUs", sourceText: fbSource("FB_RT", "(* base *)") }],
		});
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		const wsPath = join(workspaceRoot, "POUs/FB_RT.st");
		writeFileSync(wsPath, fbSource("FB_RT", "(* ours *)"));
		const theirsContent = fbSource("FB_RT", "(* theirs winning *)");
		bridge.items.get("FB_RT")!.sourceText = theirsContent;

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		applyMerge(snapshotPath, workspaceRoot, plan);

		resolveConflict(snapshotPath, workspaceRoot, "POUs/FB_RT.st", "theirs");

		expect(readFileSync(wsPath, "utf-8")).toBe(theirsContent);
		expect(isMergingNow(snapshotPath)!.conflicts).toHaveLength(0);
	});

	it("resolveConflict with no side marks resolved using current workspace bytes", async () => {
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_RM", folder: "POUs", sourceText: fbSource("FB_RM", "(* base *)") }],
		});
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		const wsPath = join(workspaceRoot, "POUs/FB_RM.st");
		writeFileSync(wsPath, fbSource("FB_RM", "(* ours *)"));
		bridge.items.get("FB_RM")!.sourceText = fbSource("FB_RM", "(* theirs *)");

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		applyMerge(snapshotPath, workspaceRoot, plan);
		// User manually edits the file (replaces markers with a chosen blend).
		const handResolved = fbSource("FB_RM", "(* hand-resolved blend *)");
		writeFileSync(wsPath, handResolved);

		resolveConflict(snapshotPath, workspaceRoot, "POUs/FB_RM.st", undefined);

		// Content untouched — only the conflict entry was cleared.
		expect(readFileSync(wsPath, "utf-8")).toBe(handResolved);
		expect(isMergingNow(snapshotPath)!.conflicts).toHaveLength(0);
	});

	it("after resolving all conflicts, continueMerge succeeds with the chosen content", async () => {
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_RC", folder: "POUs", sourceText: fbSource("FB_RC", "(* base *)") }],
		});
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		const wsPath = join(workspaceRoot, "POUs/FB_RC.st");
		writeFileSync(wsPath, fbSource("FB_RC", "(* ours *)"));
		const theirsContent = fbSource("FB_RC", "(* theirs final *)");
		bridge.items.get("FB_RC")!.sourceText = theirsContent;

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		applyMerge(snapshotPath, workspaceRoot, plan);

		resolveConflict(snapshotPath, workspaceRoot, "POUs/FB_RC.st", "theirs");
		expect(() => continueMerge(snapshotPath, workspaceRoot)).not.toThrow();

		// Merge committed; workspace has theirs; MERGE_* gone.
		expect(readFileSync(wsPath, "utf-8")).toBe(theirsContent);
		expect(isMergingNow(snapshotPath)).toBeUndefined();
	});

	it("resolveConflict throws NotConflictedError for unknown paths", async () => {
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_RX", folder: "POUs", sourceText: fbSource("FB_RX", "(* base *)") }],
		});
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		writeFileSync(join(workspaceRoot, "POUs/FB_RX.st"), fbSource("FB_RX", "(* ours *)"));
		bridge.items.get("FB_RX")!.sourceText = fbSource("FB_RX", "(* theirs *)");

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		applyMerge(snapshotPath, workspaceRoot, plan);

		expect(() =>
			resolveConflict(snapshotPath, workspaceRoot, "POUs/NOT_A_CONFLICT.st", "ours"),
		).toThrow(NotConflictedError);
	});

	// ─── --abort ─────────────────────────────────────────────────────

	it("abortMerge restores workspace to ORIG_HEAD and clears MERGE_*", async () => {
		const initial = fbSource("FB_AB", "(* base *)");
		const bridge = new TestBridge({
			initialItems: [{ name: "FB_AB", folder: "POUs", sourceText: initial }],
		});
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		const wsPath = join(workspaceRoot, "POUs/FB_AB.st");
		const oursContent = fbSource("FB_AB", "(* ours edit *)");
		writeFileSync(wsPath, oursContent);
		bridge.items.get("FB_AB")!.sourceText = fbSource("FB_AB", "(* theirs edit *)");

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		applyMerge(snapshotPath, workspaceRoot, plan);
		expect(isMergingNow(snapshotPath)).toBeDefined();

		abortMerge(snapshotPath, workspaceRoot);

		// ORIG_HEAD restored — workspace matches the BASE (pre-merge snapshot),
		// not the ours-edited content. That's git --abort's contract.
		const after = readFileSync(wsPath, "utf-8");
		expect(after).toContain("(* base *)");
		expect(after).not.toContain("ours edit");
		expect(after).not.toContain("theirs edit");

		expect(isMergingNow(snapshotPath)).toBeUndefined();
	});

	// ─── isMergingNow ────────────────────────────────────────────────

	it("isMergingNow returns undefined on a clean snapshot", () => {
		ensureSnapshotRepo(snapshotPath);
		expect(isMergingNow(snapshotPath)).toBeUndefined();
	});

	// ─── Add/add ─────────────────────────────────────────────────────

	it("add/add identical content → no conflict", async () => {
		// Start with an empty bridge.
		const bridge = new TestBridge({ initialItems: [] });
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		const same = fbSource("FB_New", "(* same *)");
		writeFileSync(join(workspaceRoot, "FB_New.st"), same);
		bridge.items.set("FB_New", {
			name: "FB_New",
			kind: "function_block",
			folder: undefined,
			sourceText: same,
		});

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		expect(plan.conflicts).toEqual([]);
	});

	it("add/add differing content → conflict with add-add-differ reason", async () => {
		const bridge = new TestBridge({ initialItems: [] });
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		writeFileSync(join(workspaceRoot, "FB_New.st"), fbSource("FB_New", "(* ours new *)"));
		bridge.items.set("FB_New", {
			name: "FB_New",
			kind: "function_block",
			folder: undefined,
			sourceText: fbSource("FB_New", "(* theirs new *)"),
		});

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		expect(plan.conflicts.length).toBe(1);
		expect(plan.conflicts[0]!.reason).toBe("add-add-differ");
	});

	// ─── End-to-end-ish: workspace count sanity ──────────────────────

	it("auto-merged workspace contains exactly the union of paths", async () => {
		const bridge = new TestBridge({
			initialItems: [
				{ name: "FB_A", folder: "POUs", sourceText: fbSource("FB_A") },
				{ name: "FB_B", folder: "POUs", sourceText: fbSource("FB_B") },
			],
		});
		await setupBaseline(bridge, snapshotPath, workspaceRoot);

		// Workspace adds C; bridge adds D.
		writeFileSync(join(workspaceRoot, "POUs/FB_C.st"), fbSource("FB_C"));
		bridge.items.set("FB_D", {
			name: "FB_D",
			kind: "function_block",
			folder: "POUs",
			sourceText: fbSource("FB_D"),
		});

		const plan = await planMerge(snapshotPath, workspaceRoot, bridge);
		expect(plan.conflicts).toEqual([]);
		applyMerge(snapshotPath, workspaceRoot, plan);

		const paths = new Set(listWorkspaceFiles(workspaceRoot).map((f) => f.path));
		expect(paths.has("POUs/FB_A.st")).toBe(true);
		expect(paths.has("POUs/FB_B.st")).toBe(true);
		expect(paths.has("POUs/FB_C.st")).toBe(true);
		expect(paths.has("POUs/FB_D.st")).toBe(true);
	});
});
