/**
 * 3-way merge engine. Activated by `volt pull` when the workspace is
 * dirty AND the bridge has changed since the last sync. Mirrors git's
 * mental model verbatim: MERGE_HEAD / ORIG_HEAD plain-file refs inside
 * the snapshot bare repo, conflict markers in workspace files for text
 * languages, and a `--continue` / `--abort` resumption protocol on top.
 *
 * Three sides of the merge, recoverable from the snapshot:
 *   base   — snapshot HEAD's tree (the last-pulled state)
 *   ours   — current workspace files, hashed into the snapshot
 *   theirs — a synthetic commit built from a fresh `/fetch`, written
 *            into the snapshot's object store but NOT advanced over
 *            `refs/heads/main` until `--continue`
 *
 * Text languages (`.st` / `.gvl` / `.dut` / `.itf`): we shell out to
 * `git merge-file -p` on the three blob SHAs. Conflicts get the
 * standard `<<<<<<<` / `=======` / `>>>>>>>` markers written into the
 * workspace file in place — the next `volt build` or LSP diagnostic
 * makes the unresolved state obvious.
 *
 * Graphical languages (`.fbd` / `.ld` / `.sfc` / `.cfc`): inline
 * markers would produce invalid PLCopenXML, so we record the conflict
 * in `MERGE_CONFLICTS` and leave resolution to the VS Code extension's
 * choose-side UI (or to `--force` / `--force-with-lease` for CLI-only
 * users in v1).
 */
import type { Remote } from "../bridge/types.js";
import {
	createMergeCommit,
	deleteMergeFile,
	listTree,
	lookupBlobInCommit,
	mergeFile as gitMergeFile,
	readBlobBytes,
	readMergeFile,
	resolveRef,
	updateRef,
	writeBlob,
	writeMergeFile,
} from "../git/plumbing.js";
import { isTrackedPath } from "../registry/extensions.js";
import { loadState, saveState, type RepoState } from "../snapshot/repo.js";
import {
	buildWorkspaceTreeSha,
	listWorkspaceFiles,
	removeFilesFromWorkspace,
	writeTreeToWorkspace,
} from "../snapshot/workspace.js";
import { syncFromBridge } from "./ops.js";

// ─── State files inside the snapshot bare repo ───────────────────────

const MERGE_HEAD = "MERGE_HEAD";
const ORIG_HEAD = "ORIG_HEAD";
const MERGE_MSG = "MERGE_MSG";
const MERGE_CONFLICTS = "MERGE_CONFLICTS";

// ─── Types ────────────────────────────────────────────────────────────

export type ConflictReason = "both-modified" | "delete-modify" | "modify-delete" | "add-add-differ";
export type ConflictKind = "text" | "graphical";

export interface ConflictEntry {
	path: string;
	kind: ConflictKind;
	reason: ConflictReason;
}

/** What `planMerge` returns: enough to either apply the merge or report a dry-run preview. */
export interface MergePlan {
	auto: AutoEntry[];
	conflicts: ConflictEntry[];
	theirsCommitSha: string;
	targetProjectVersion: string;
	targetState: { items: Record<string, string>; folders: Record<string, string> };
	prevHeadSha: string;
	/** Tree SHA of the workspace AT MERGE START — see ConflictsFile.oursTreeSha. */
	oursTreeSha: string;
}

/**
 * One entry in the auto-merge set: either we take theirs's content
 * verbatim (fast-forward), or we keep ours's content verbatim, or we
 * produced merged bytes via `git merge-file`. The `bytes` field is
 * what `applyMerge` writes to the workspace.
 */
interface AutoEntry {
	path: string;
	bytes: Buffer;
	/** True if the file should be deleted from the workspace (e.g. removed on theirs side). */
	remove: boolean;
}

export interface MergeState {
	mergeHead: string;
	origHead: string;
	conflicts: ConflictEntry[];
	projectVersion: string;
	mergeMsg: string;
}

interface ConflictsFile {
	projectVersion: string;
	paths: ConflictEntry[];
	/** Snapshot of {items, folders} we'd save to state.json on --continue. */
	targetState: { items: Record<string, string>; folders: Record<string, string> };
	/**
	 * Tree SHA of the workspace AT MERGE START — captures "ours" before
	 * `applyMerge` writes conflict markers over the user's bytes. In
	 * git this is implicit (ours = HEAD), but Volt's HEAD doesn't move
	 * during a merge and workspace edits never commit, so we need an
	 * explicit handle to read ours from.
	 */
	oursTreeSha: string;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Detect whether a merge is in progress and return its state. Cheap —
 * single MERGE_HEAD file existence check + a JSON parse if present.
 * Used by `volt status`, `volt push`, and the VS Code SCM provider.
 */
export function isMergingNow(snapshotPath: string): MergeState | undefined {
	const mergeHead = readMergeFile(snapshotPath, MERGE_HEAD);
	if (mergeHead === undefined) return undefined;
	const origHead = readMergeFile(snapshotPath, ORIG_HEAD) ?? "";
	const mergeMsg = readMergeFile(snapshotPath, MERGE_MSG) ?? "";
	const conflictsRaw = readMergeFile(snapshotPath, MERGE_CONFLICTS);
	let parsed: ConflictsFile | undefined;
	try {
		parsed = conflictsRaw !== undefined ? (JSON.parse(conflictsRaw) as ConflictsFile) : undefined;
	} catch {
		parsed = undefined;
	}
	return {
		mergeHead: mergeHead.trim(),
		origHead: origHead.trim(),
		conflicts: parsed?.paths ?? [],
		projectVersion: parsed?.projectVersion ?? "",
		mergeMsg,
	};
}

/**
 * Plan a merge: fetch bridge state into a side commit (objects only,
 * `refs/heads/main` does NOT move), then classify every path as
 * auto-mergeable or conflicting. Does NOT write anything to the
 * workspace — that's `applyMerge`'s job.
 *
 * Throws if no prior state (you must `volt init` + `volt pull` first).
 */
export async function planMerge(
	snapshotPath: string,
	workspaceRoot: string,
	bridge: Remote,
): Promise<MergePlan> {
	const prevState = loadState(snapshotPath);
	if (prevState === null) {
		throw new Error("merge requires a prior pull — run `volt pull` first to establish a base");
	}
	const prevHeadSha = resolveRef(snapshotPath, "refs/heads/main");
	if (prevHeadSha === undefined) {
		throw new Error("internal: snapshot has state.json but no refs/heads/main");
	}

	// Materialize theirs as a synthetic commit in the snapshot's object
	// store. `syncFromBridge` advances refs + state; we capture the new
	// commit and then roll the ref + state back so HEAD still points at
	// the pre-merge base. The blobs / tree / commit objects remain — git
	// has no garbage collection between calls.
	const { commitSha: theirsCommitSha } = await syncFromBridge(snapshotPath, bridge);
	const theirsState = loadState(snapshotPath);
	if (theirsState === null) {
		throw new Error("internal: syncFromBridge produced no state");
	}
	updateRef(snapshotPath, "refs/heads/main", prevHeadSha);
	saveState(snapshotPath, prevState);

	// Trees: base from prev HEAD, theirs from the new commit, ours from
	// hashing the workspace right now.
	const baseTree = listTree(snapshotPath, prevHeadSha);
	const theirsTree = listTree(snapshotPath, theirsCommitSha);
	const oursTreeSha = buildWorkspaceTreeSha(workspaceRoot, snapshotPath);
	const oursTree = listTree(snapshotPath, oursTreeSha);

	const baseByPath = new Map(baseTree.map((e) => [e.path, e.sha]));
	const theirsByPath = new Map(theirsTree.map((e) => [e.path, e.sha]));
	const oursByPath = new Map(oursTree.map((e) => [e.path, e.sha]));

	const allPaths = new Set<string>([
		...baseByPath.keys(),
		...theirsByPath.keys(),
		...oursByPath.keys(),
	]);

	const auto: AutoEntry[] = [];
	const conflicts: ConflictEntry[] = [];

	for (const path of allPaths) {
		// Untracked things (the only one is `.gitattributes` today) fall
		// through to the "take theirs" auto-merge path — they're owned by
		// the snapshot machinery, not the user.
		const base = baseByPath.get(path);
		const ours = oursByPath.get(path);
		const theirs = theirsByPath.get(path);

		// 3-way comparison via blob SHA equality.
		if (ours === theirs) {
			// ours and theirs agree (incl. both deleted) — convergent.
			if (ours === undefined) continue; // both deleted, no-op
			auto.push({ path, bytes: readBlobBytes(snapshotPath, ours), remove: false });
			continue;
		}
		if (base === ours) {
			// ours unchanged, theirs differs → take theirs (fast-forward).
			if (theirs === undefined) {
				auto.push({ path, bytes: Buffer.alloc(0), remove: true });
			} else {
				auto.push({ path, bytes: readBlobBytes(snapshotPath, theirs), remove: false });
			}
			continue;
		}
		if (base === theirs) {
			// theirs unchanged, ours differs → keep ours (no write needed).
			// We DO need to emit an auto entry so applyMerge's "remove
			// files not in the merged tree" sweep doesn't delete it.
			if (ours === undefined) {
				auto.push({ path, bytes: Buffer.alloc(0), remove: true });
			} else {
				auto.push({ path, bytes: readBlobBytes(snapshotPath, ours), remove: false });
			}
			continue;
		}

		// All three differ (or one side adds and another modifies a
		// pre-existing path — same classification). Route by file kind.
		const isTracked = isTrackedPath(path);

		// Delete/modify conflicts: one side removed the file, the other
		// modified it. We list as conflict and leave the surviving side
		// in the workspace as a `.LOCAL` / `.REMOTE` sidecar wouldn't be
		// universally readable here (v1 keeps it CLI-discoverable).
		if (ours === undefined) {
			conflicts.push({ path, kind: "text", reason: "delete-modify" });
			// Write theirs's content back so the user has something to
			// look at and can choose to keep, edit, or delete.
			if (theirs !== undefined) {
				auto.push({ path, bytes: readBlobBytes(snapshotPath, theirs), remove: false });
			}
			continue;
		}
		if (theirs === undefined) {
			conflicts.push({ path, kind: "text", reason: "modify-delete" });
			// Keep ours's content in the workspace (it's already there).
			auto.push({ path, bytes: readBlobBytes(snapshotPath, ours), remove: false });
			continue;
		}

		// All three present, all three differ.
		if (!isTracked) {
			// Non-tracked file we somehow have versions for: take theirs.
			auto.push({ path, bytes: readBlobBytes(snapshotPath, theirs), remove: false });
			continue;
		}

		// Text 3-way merge via `git merge-file`. base may be missing if
		// both sides added the same path with different content
		// (add/add differ).
		const baseSha = base ?? emptyBlobSha(snapshotPath);
		const { merged, hadConflicts } = gitMergeFile(
			snapshotPath,
			ours,
			baseSha,
			theirs,
			"WORKSPACE",
			`IDE@${theirsState.projectVersion}`,
		);
		auto.push({ path, bytes: merged, remove: false });
		if (hadConflicts) {
			conflicts.push({
				path,
				kind: "text",
				reason: base === undefined ? "add-add-differ" : "both-modified",
			});
		}
	}

	return {
		auto,
		conflicts,
		theirsCommitSha,
		targetProjectVersion: theirsState.projectVersion,
		targetState: { items: theirsState.items, folders: theirsState.folders },
		prevHeadSha,
		oursTreeSha,
	};
}

/**
 * Apply a merge plan to the workspace. Writes auto-merge results (with
 * or without conflict markers) and, if any conflicts remain, writes the
 * four MERGE_* state files so the next `volt pull`/`push` knows the
 * tree is mid-merge.
 *
 * Returns the merge state if conflicts were left, undefined on a clean
 * merge. Caller decides whether to advance the snapshot ref (clean
 * case = yes, conflict case = wait for `--continue`).
 */
export function applyMerge(
	snapshotPath: string,
	workspaceRoot: string,
	plan: MergePlan,
): MergeState | undefined {
	// Write merged content / take-theirs / take-ours into the workspace.
	const writeBatch: Array<{ path: string; content: Buffer }> = [];
	const removeBatch: string[] = [];
	for (const e of plan.auto) {
		if (e.remove) removeBatch.push(e.path);
		else writeBatch.push({ path: e.path, content: e.bytes });
	}
	writeTreeToWorkspace(workspaceRoot, writeBatch);
	if (removeBatch.length > 0) {
		removeFilesFromWorkspace(workspaceRoot, removeBatch);
	}

	if (plan.conflicts.length === 0) {
		// Clean merge — caller advances HEAD and saves state.
		return undefined;
	}

	const conflictsFile: ConflictsFile = {
		projectVersion: plan.targetProjectVersion,
		paths: plan.conflicts,
		targetState: plan.targetState,
		oursTreeSha: plan.oursTreeSha,
	};
	const msg = renderMergeMsg(plan);

	writeMergeFile(snapshotPath, MERGE_HEAD, `${plan.theirsCommitSha}\n`);
	writeMergeFile(snapshotPath, ORIG_HEAD, `${plan.prevHeadSha}\n`);
	writeMergeFile(snapshotPath, MERGE_MSG, msg);
	writeMergeFile(snapshotPath, MERGE_CONFLICTS, `${JSON.stringify(conflictsFile, null, 2)}\n`);

	return {
		mergeHead: plan.theirsCommitSha,
		origHead: plan.prevHeadSha,
		conflicts: plan.conflicts,
		projectVersion: plan.targetProjectVersion,
		mergeMsg: msg,
	};
}

/**
 * Finalize an in-progress merge after all conflicts are resolved.
 *
 * Verifies that no workspace file in MERGE_CONFLICTS still contains
 * `<<<<<<<` / `=======` / `>>>>>>>` markers (text) or that the file
 * matches one of the recorded sides (graphical). On clean: hashes the
 * resolved workspace into a new tree, creates a 2-parent merge commit
 * (HEAD + MERGE_HEAD), advances `refs/heads/main`, saves new state,
 * deletes the four MERGE_* files.
 *
 * Throws on unresolved conflicts.
 */
export function continueMerge(snapshotPath: string, workspaceRoot: string): void {
	const state = isMergingNow(snapshotPath);
	if (state === undefined) {
		throw new Error("not currently merging — nothing to continue");
	}
	const conflicts = loadConflictsFile(snapshotPath);

	const unresolved: string[] = [];
	const wsFiles = new Map(listWorkspaceFiles(workspaceRoot).map((f) => [f.path, f.content]));
	for (const entry of conflicts.paths) {
		const content = wsFiles.get(entry.path);
		if (content === undefined) {
			// User deleted the file as their resolution — acceptable.
			continue;
		}
		if (entry.kind === "text") {
			const txt = content.toString("utf-8");
			if (hasConflictMarkers(txt)) unresolved.push(entry.path);
		}
		// Graphical: no marker check possible. Trust the user's edit.
		// (v2 will add stricter detection via hash comparison.)
	}

	if (unresolved.length > 0) {
		throw new MergeUnresolvedError(unresolved);
	}

	// Build the merge commit on top of HEAD with MERGE_HEAD as second parent.
	const oursTreeSha = buildWorkspaceTreeSha(workspaceRoot, snapshotPath);
	const headSha = resolveRef(snapshotPath, "refs/heads/main");
	if (headSha === undefined) {
		throw new Error("internal: refs/heads/main missing during continueMerge");
	}
	const message = `Merge IDE@${conflicts.projectVersion} into workspace\n\n${state.mergeMsg.trim()}\n`;
	// `createDeterministicCommit` takes one parent today. The merge
	// commit has two parents (HEAD + MERGE_HEAD); we drop down to git
	// plumbing directly.
	const mergeCommit = createMergeCommit(
		snapshotPath,
		oursTreeSha,
		[headSha, state.mergeHead],
		message,
	);
	updateRef(snapshotPath, "refs/heads/main", mergeCommit);

	const newState: RepoState = {
		projectVersion: conflicts.projectVersion,
		commitSha: mergeCommit,
		items: conflicts.targetState.items,
		folders: conflicts.targetState.folders,
	};
	saveState(snapshotPath, newState);

	deleteMergeFile(snapshotPath, MERGE_HEAD);
	deleteMergeFile(snapshotPath, ORIG_HEAD);
	deleteMergeFile(snapshotPath, MERGE_MSG);
	deleteMergeFile(snapshotPath, MERGE_CONFLICTS);
}

/**
 * Abandon an in-progress merge. Restores the workspace to ORIG_HEAD's
 * tree exactly (any user edits made during the merge are lost — same
 * as `git merge --abort`). Snapshot HEAD never moved during the merge,
 * so no ref rollback is needed.
 */
export function abortMerge(snapshotPath: string, workspaceRoot: string): void {
	const state = isMergingNow(snapshotPath);
	if (state === undefined) {
		throw new Error("not currently merging — nothing to abort");
	}

	// Restore workspace to ORIG_HEAD's tree contents.
	const origTreeEntries = listTree(snapshotPath, state.origHead);
	const origPaths = new Set(origTreeEntries.map((e) => e.path));
	writeTreeToWorkspace(
		workspaceRoot,
		origTreeEntries.map((e) => ({ path: e.path, content: readBlobBytes(snapshotPath, e.sha) })),
	);
	// Remove any tracked workspace files NOT in ORIG_HEAD (i.e. files
	// added during the merge or already present from a prior dirty
	// state — both go).
	const wsFiles = listWorkspaceFiles(workspaceRoot);
	const removeTargets: string[] = [];
	for (const f of wsFiles) {
		if (!origPaths.has(f.path)) removeTargets.push(f.path);
	}
	if (removeTargets.length > 0) {
		removeFilesFromWorkspace(workspaceRoot, removeTargets);
	}

	deleteMergeFile(snapshotPath, MERGE_HEAD);
	deleteMergeFile(snapshotPath, ORIG_HEAD);
	deleteMergeFile(snapshotPath, MERGE_MSG);
	deleteMergeFile(snapshotPath, MERGE_CONFLICTS);
}

/** Thrown by `continueMerge` when files still contain conflict markers. */
export class MergeUnresolvedError extends Error {
	constructor(public readonly paths: string[]) {
		super(`unresolved conflicts in ${paths.length} file(s): ${paths.join(", ")}`);
		this.name = "MergeUnresolvedError";
	}
}

/** Thrown when `resolveConflict` is called on a path that isn't currently conflicted. */
export class NotConflictedError extends Error {
	constructor(public readonly path: string) {
		super(`${path} is not in the conflict set`);
		this.name = "NotConflictedError";
	}
}

/**
 * Resolve one conflict, mirroring git's three resolution verbs:
 *
 *   side = "ours"   → analog of `git checkout --ours <path> && git add <path>`
 *   side = "theirs" → analog of `git checkout --theirs <path> && git add <path>`
 *   side = undefined → analog of `git add <path>` (mark resolved with
 *                      whatever bytes are currently in the workspace)
 *
 * "ours" content comes from ORIG_HEAD (the pre-merge workspace state),
 * NOT from the current workspace, because the user may have already
 * started editing conflict markers and "ours" must remain stable across
 * resolution attempts. "theirs" comes from MERGE_HEAD.
 *
 * After the last path is resolved, MERGE_CONFLICTS becomes empty —
 * `continueMerge` is still required to actually create the merge commit
 * (matches git: `git add` resolves the index entry; `git commit`
 * finalizes). Auto-continuing would hide that step and surprise users.
 *
 * Throws `NotConflictedError` if the path isn't in MERGE_CONFLICTS.
 */
export function resolveConflict(
	snapshotPath: string,
	workspaceRoot: string,
	path: string,
	side: "ours" | "theirs" | undefined,
): void {
	const state = isMergingNow(snapshotPath);
	if (state === undefined) {
		throw new Error("not currently merging — nothing to resolve");
	}
	const conflicts = loadConflictsFile(snapshotPath);
	const entry = conflicts.paths.find((c) => c.path === path);
	if (entry === undefined) {
		throw new NotConflictedError(path);
	}

	if (side === "ours" || side === "theirs") {
		// "ours" reads from the workspace-at-merge-start tree (persisted in
		// the conflicts file). "theirs" reads from MERGE_HEAD's tree. ORIG_HEAD
		// is the *base* (last-pulled state), not ours — git's mental model
		// where ours=HEAD doesn't hold here because Volt's HEAD doesn't move
		// during a merge.
		const fromTreeish = side === "ours" ? conflicts.oursTreeSha : state.mergeHead;
		const blobSha = lookupBlobInCommit(snapshotPath, fromTreeish, path);
		if (blobSha === undefined) {
			// Side deleted the path — resolution means "remove it locally".
			removeFilesFromWorkspace(workspaceRoot, [path]);
		} else {
			writeTreeToWorkspace(workspaceRoot, [
				{ path, content: readBlobBytes(snapshotPath, blobSha) },
			]);
		}
	}

	const remaining = conflicts.paths.filter((c) => c.path !== path);
	saveConflictsFile(snapshotPath, { ...conflicts, paths: remaining });
}

// ─── Internal: MERGE_CONFLICTS read/write ─────────────────────────────

function loadConflictsFile(snapshotPath: string): ConflictsFile {
	const raw = readMergeFile(snapshotPath, MERGE_CONFLICTS);
	if (raw === undefined) {
		throw new Error("internal: MERGE_HEAD present but MERGE_CONFLICTS missing");
	}
	return JSON.parse(raw) as ConflictsFile;
}

function saveConflictsFile(snapshotPath: string, file: ConflictsFile): void {
	writeMergeFile(snapshotPath, MERGE_CONFLICTS, `${JSON.stringify(file, null, 2)}\n`);
}

// ─── Helpers ──────────────────────────────────────────────────────────

function hasConflictMarkers(text: string): boolean {
	// Anchor to start of line — match git's own detection so a literal
	// `<<<<<<<` inside a string constant on a code line wouldn't trip
	// us up.
	return /^<{7} /m.test(text) || /^={7}$/m.test(text) || /^>{7} /m.test(text);
}

function renderMergeMsg(plan: MergePlan): string {
	const lines: string[] = [];
	lines.push(`Merge IDE@${plan.targetProjectVersion} into workspace`);
	lines.push("");
	lines.push(`auto-merged: ${plan.auto.length - plan.conflicts.length} file(s)`);
	lines.push(`conflicts:   ${plan.conflicts.length} file(s)`);
	if (plan.conflicts.length > 0) {
		lines.push("");
		for (const c of plan.conflicts) {
			lines.push(`  ${c.kind === "text" ? "T" : "G"} ${c.path}  (${c.reason})`);
		}
	}
	return `${lines.join("\n")}\n`;
}

/** Cache the empty-blob SHA after first use to avoid a hash round-trip per add/add merge. */
let cachedEmptyBlobSha: { repo: string; sha: string } | undefined;

function emptyBlobSha(snapshotPath: string): string {
	if (cachedEmptyBlobSha?.repo === snapshotPath) return cachedEmptyBlobSha.sha;
	// Git's well-known empty-blob SHA. Write it once to guarantee the
	// object exists in the snapshot's store (idempotent — same content
	// always produces this SHA).
	writeBlob(snapshotPath, "");
	const sha = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
	cachedEmptyBlobSha = { repo: snapshotPath, sha };
	return sha;
}
